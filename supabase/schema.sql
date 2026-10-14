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
-- re-sending the same change is a no-op. A per-user row limit keeps one
-- account from filling the database (tune with: alter database postgres set
-- macros.max_records = '...').
create or replace function public.push_records(records jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  quota bigint := coalesce(nullif(current_setting('macros.max_records', true), '')::bigint, 200000);
begin
  if me is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if jsonb_typeof(records) <> 'array' or jsonb_array_length(records) > 1000 then
    raise exception 'upload must be an array of at most 1000 records' using errcode = '22023';
  end if;
  if (select count(*) from public.records r where r.user_id = me) + jsonb_array_length(records) > quota then
    raise exception 'storage quota exceeded' using errcode = '53400';
  end if;

  insert into public.records as r (user_id, kind, key, data, deleted, client_updated_at)
  select me,
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
end;
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
