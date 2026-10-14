import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Remote, RemoteRecord } from '../sync/engine';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * The Supabase client, or null when the build has no project configured (the
 * app then works on this device only, as before accounts existed).
 */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          // PKCE puts the email-link result in `?code=`, leaving our `#/…` routes alone.
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'macros-auth',
        },
      })
    : null;

export const cloudEnabled = supabase !== null;

/** Where email links (confirm account, reset password) should come back to. */
export function appUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

const PAGE = 1000;
const COLUMNS = 'kind,key,data,deleted,client_updated_at,server_updated_at';

class RemoteError extends Error {}

/** The sync engine's server side, backed by the `records` table and `push_records` function (supabase/schema.sql). */
export function supabaseRemote(client: SupabaseClient): Remote {
  return {
    async push(records) {
      const { error } = await client.rpc('push_records', { records });
      if (error) throw new RemoteError(error.message);
    },
    async pull(since) {
      const out: RemoteRecord[] = [];
      // Offset paging over a stable order: many rows can share one timestamp.
      for (let from = 0; ; from += PAGE) {
        let q = client
          .from('records')
          .select(COLUMNS)
          .order('server_updated_at', { ascending: true })
          .order('kind', { ascending: true })
          .order('key', { ascending: true })
          .range(from, from + PAGE - 1);
        if (since) q = q.gt('server_updated_at', since);
        const { data, error } = await q;
        if (error) throw new RemoteError(error.message);
        out.push(...((data ?? []) as RemoteRecord[]));
        if (!data || data.length < PAGE) break;
      }
      return { records: out, cursor: out.at(-1)?.server_updated_at ?? null };
    },
  };
}
