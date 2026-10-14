import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseRemote } from './supabase';

interface Row {
  kind: string;
  key: string;
  data: unknown;
  deleted: boolean;
  client_updated_at: number;
  server_updated_at: string;
}

/** Just enough of PostgREST's query builder for supabaseRemote().pull(). */
function fakeClient(rows: Row[], onPage: (page: number) => void) {
  let pages = 0;
  const from = () => {
    const filters: ((r: Row) => boolean)[] = [];
    let limit = Infinity;
    const q = {
      select: () => q,
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      gt: (_c: string, v: string) => (filters.push((r) => r.server_updated_at > v), q),
      gte: (_c: string, v: string) => (filters.push((r) => r.server_updated_at >= v), q),
      then: (resolve: (x: { data: Row[]; error: null }) => void) => {
        const data = rows
          .filter((r) => filters.every((f) => f(r)))
          .sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at) || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key))
          .slice(0, limit)
          .map((r) => ({ ...r }));
        onPage(++pages);
        resolve({ data, error: null });
      },
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

const ts = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString().replace('Z', '000+00:00');

describe('supabaseRemote().pull', () => {
  it('downloads every row even when one changes between pages', async () => {
    const rows: Row[] = Array.from({ length: 2500 }, (_, i) => ({
      kind: 'entry',
      key: `k${String(i).padStart(5, '0')}`,
      data: { i },
      deleted: false,
      client_updated_at: i,
      server_updated_at: ts(i),
    }));
    // After the first page, another device edits an early row: it moves to the end.
    const client = fakeClient(rows, (page) => {
      if (page === 1) rows[10] = { ...rows[10], data: { edited: true }, server_updated_at: ts(10_000) };
    });
    const { records, cursor } = await supabaseRemote(client).pull(null);
    const keys = new Set(records.map((r) => r.key));
    expect(keys.size).toBe(2500);
    expect(records.find((r) => r.key === 'k00010' && (r.data as { edited?: boolean }).edited)).toBeTruthy();
    expect(cursor).toBe(ts(10_000));
  });

  it('does not repeat rows that share a timestamp across a page boundary', async () => {
    const rows: Row[] = Array.from({ length: 1500 }, (_, i) => ({
      kind: 'food',
      key: `f${String(i).padStart(5, '0')}`,
      data: {},
      deleted: false,
      client_updated_at: 1,
      server_updated_at: ts(i < 990 ? i : 990), // rows 990..1499 share one timestamp
    }));
    const { records } = await supabaseRemote(fakeClient(rows, () => {})).pull(null);
    expect(records).toHaveLength(1500);
    expect(new Set(records.map((r) => r.key)).size).toBe(1500);
  });
});
