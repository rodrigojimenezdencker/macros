-- Macros: cloud storage for each user's diary, foods, weights and settings.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- It is idempotent: running it again is harmless.

-- One row per record: kind ('food' | 'entry' | 'weight' | 'settings') + key
-- (a uuid, a date or 'settings'), the record itself as JSON, and the device
-- timestamp of its last change, which decides conflicts (newest wins).
create table if not exists public.records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('food', 'entry', 'weight', 'settings')),
  key text not null check (char_length(key) between 1 and 100),
  data jsonb check (data is null or pg_column_size(data) <= 65536),
  deleted boolean not null default false,
  client_updated_at bigint not null,
  -- When the server last stored a change to this row: devices download "everything since X".
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, kind, key)
);

create index if not exists records_user_server_updated_idx
  on public.records (user_id, server_updated_at);

-- Every user can only ever see and change their own rows.
alter table public.records enable row level security;

drop policy if exists "Own records: read" on public.records;
create policy "Own records: read" on public.records
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Own records: insert" on public.records;
create policy "Own records: insert" on public.records
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "Own records: update" on public.records;
create policy "Own records: update" on public.records
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Own records: delete" on public.records;
create policy "Own records: delete" on public.records
  for delete to authenticated using (user_id = (select auth.uid()));

-- Stamp each stored change with the server clock.
create or replace function public.records_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists records_touch on public.records;
create trigger records_touch
  before insert or update on public.records
  for each row execute function public.records_touch();

-- Upload a batch from a device. A row is only replaced by a strictly newer
-- change, so an old offline device can never overwrite newer data, and
-- re-sending the same change is a no-op.
create or replace function public.push_records(records jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.records as r (user_id, kind, key, data, deleted, client_updated_at)
  select (select auth.uid()),
         x.kind,
         x.key,
         case when coalesce(x.deleted, false) then null else x.data end,
         coalesce(x.deleted, false),
         x.client_updated_at
  from jsonb_to_recordset(records) as x(kind text, key text, data jsonb, deleted boolean, client_updated_at bigint)
  on conflict (user_id, kind, key) do update
    set data = excluded.data,
        deleted = excluded.deleted,
        client_updated_at = excluded.client_updated_at
    where r.client_updated_at < excluded.client_updated_at;
$$;

revoke execute on function public.push_records(jsonb) from public, anon;
grant execute on function public.push_records(jsonb) to authenticated;

-- Let open devices hear about changes from other devices right away.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records'
  ) then
    alter publication supabase_realtime add table public.records;
  end if;
end;
$$;
