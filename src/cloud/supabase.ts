import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Remote, RemoteRecord } from '../sync/engine';

/** Where the SDK keeps the session (and PKCE verifiers, under keys with this prefix). */
export const AUTH_STORAGE_KEY = 'macros-auth';

/** Requests give up after this long, so a network that never answers looks offline instead of hanging. */
const REQUEST_TIMEOUT_MS = 30_000;

/** fetch with a timeout (AbortController + setTimeout: AbortSignal.any is too new for older iPhones). */
export const timedFetch: typeof fetch = (input, init = {}) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new TypeError('Failed to fetch (timeout)')), REQUEST_TIMEOUT_MS);
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) ctl.abort(outer.reason);
    else outer.addEventListener('abort', () => ctl.abort(outer.reason), { once: true });
  }
  return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
};

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * The Supabase client, or null when the build has no project configured (the
 * app then works on this device only, as before accounts existed).
 */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        global: { fetch: timedFetch },
        auth: {
          // PKCE puts the email-link result in `?code=`, leaving our `#/…` routes alone.
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: AUTH_STORAGE_KEY,
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
      // Keyset paging: each page continues from the last timestamp seen, so a
      // row changing mid-download (it moves to the end) can't shift a row past
      // us, as offsets would. Rows sharing that exact timestamp are de-duplicated.
      let at: string | null = null;
      const seenAt = new Set<string>();
      for (;;) {
        let q = client
          .from('records')
          .select(COLUMNS)
          .order('server_updated_at', { ascending: true })
          .order('kind', { ascending: true })
          .order('key', { ascending: true })
          .limit(PAGE);
        if (at) q = q.gte('server_updated_at', at);
        else if (since) q = q.gt('server_updated_at', since);
        const { data, error } = await q;
        if (error) throw new RemoteError(error.message);
        const page = (data ?? []) as RemoteRecord[];
        const fresh = page.filter((r) => !(r.server_updated_at === at && seenAt.has(`${r.kind}:${r.key}`)));
        out.push(...fresh);
        if (page.length < PAGE || fresh.length === 0) break;
        const last = page[page.length - 1].server_updated_at!;
        if (last !== at) {
          at = last;
          seenAt.clear();
        }
        for (const r of page) if (r.server_updated_at === at) seenAt.add(`${r.kind}:${r.key}`);
      }
      return { records: out, cursor: out.at(-1)?.server_updated_at ?? null };
    },
  };
}
