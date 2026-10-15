import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs supabase/schema.sql in a real Postgres (PGlite) with a minimal stand-in
 * for Supabase's auth schema and roles, and checks the guarantees the app
 * relies on: per-user isolation and "strictly newer change wins".
 */

const SQL = readFileSync(fileURLToPath(new URL('../../supabase/schema.sql', import.meta.url)), 'utf8');
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';

let db: PGlite;

async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${user ?? ''}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role;');
  }
}

const push = (records: object[]) => db.query('select public.push_records($1::jsonb)', [JSON.stringify(records)]);
const rows = () =>
  db
    .query<{ kind: string; key: string; data: Record<string, unknown> | null; deleted: boolean; server_updated_at: Date }>(
      'select kind, key, data, deleted, server_updated_at from public.records order by kind, key',
    )
    .then((r) => r.rows);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create role anon nologin;
    create role authenticated nologin;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    create publication supabase_realtime;
    insert into auth.users values ('${A}'), ('${B}');
  `);
  await db.exec(SQL);
  await db.exec(SQL); // safe to run twice
  // Supabase grants table privileges to these roles by default; RLS does the restricting.
  await db.exec('grant select, insert, update, delete on public.records to anon, authenticated;');
}, 30_000);

describe('supabase/schema.sql', () => {
  it('keeps the newest change per record and ignores older or repeated ones', async () => {
    await as(A, () =>
      push([
        { kind: 'food', key: 'f1', data: { name: 'Arroz' }, deleted: false, client_updated_at: 100 },
        { kind: 'entry', key: 'e1', data: { amount: 100 }, deleted: false, client_updated_at: 100 },
      ]),
    );
    const before = (await as(A, rows)).find((r) => r.key === 'f1')!.server_updated_at;
    await as(A, () => push([{ kind: 'entry', key: 'e1', data: { amount: 50 }, deleted: false, client_updated_at: 90 }]));
    await as(A, () => push([{ kind: 'food', key: 'f1', data: { name: 'Arroz' }, deleted: false, client_updated_at: 100 }]));
    const after = await as(A, rows);
    expect(after.find((r) => r.key === 'e1')!.data).toEqual({ amount: 100 });
    // A repeated upload is a no-op: other devices are not told to download it again.
    expect(after.find((r) => r.key === 'f1')!.server_updated_at).toEqual(before);

    await as(A, () => push([{ kind: 'entry', key: 'e1', data: { amount: 1 }, deleted: true, client_updated_at: 200 }]));
    expect((await as(A, rows)).find((r) => r.key === 'e1')).toMatchObject({ deleted: true, data: null });
  });

  it("isolates users: nobody can read or change another user's rows", async () => {
    expect(await as(B, rows)).toEqual([]);
    await as(B, () => push([{ kind: 'food', key: 'f1', data: { name: 'Otro' }, deleted: false, client_updated_at: 10_000 }]));
    await as(B, () => db.query(`update public.records set data = '{"name":"x"}' where user_id = $1`, [A]));
    await as(B, () => db.query('delete from public.records where user_id = $1', [A]));
    expect((await as(A, rows)).find((r) => r.key === 'f1')!.data).toEqual({ name: 'Arroz' });
    expect(await as(B, rows)).toHaveLength(1); // B has its own f1
  });

  it('rejects anonymous callers and malformed records', async () => {
    await expect(as(null, () => push([{ kind: 'food', key: 'z', data: {}, deleted: false, client_updated_at: 1 }]))).rejects.toThrow();
    await expect(as(A, () => push([{ kind: 'hack', key: 'z', data: {}, deleted: false, client_updated_at: 1 }]))).rejects.toThrow();
    await expect(as(A, () => push([{ kind: 'food', key: 'x'.repeat(101), data: {}, deleted: false, client_updated_at: 1 }]))).rejects.toThrow();
  });

  it('caps how many records one account can store', async () => {
    await db.exec("select set_config('macros.max_records', '3', false);");
    try {
      await expect(
        as(A, () => push([1, 2].map((i) => ({ kind: 'weight', key: `2026-01-0${i}`, data: { kg: 80 }, deleted: false, client_updated_at: 1 })))),
      ).rejects.toThrow(/quota/);
    } finally {
      await db.exec("select set_config('macros.max_records', '', false);");
    }
  });

  it('publishes changes for realtime and deletes a user’s data with the user', async () => {
    const pub = await db.query<{ tablename: string }>(`select tablename from pg_publication_tables where pubname = 'supabase_realtime'`);
    expect(pub.rows.map((r) => r.tablename)).toEqual(['records']);
    await db.exec(`delete from auth.users where id = '${B}'`);
    const left = await db.query<{ n: number }>(`select count(*)::int as n from public.records where user_id = '${B}'`);
    expect(left.rows[0].n).toBe(0);
  });
});
