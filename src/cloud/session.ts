import { useSyncExternalStore } from 'react';
import type { Session } from '@supabase/supabase-js';
import { db } from '../db';
import { SyncEngine, type SyncState } from '../sync/engine';
import { supabase, supabaseRemote } from './supabase';

/**
 * Account session and sync lifecycle. When a user is signed in, one
 * SyncEngine keeps this device and the account in step: on sign-in, after
 * local changes, when the app returns to the foreground or goes online, and
 * when another device changes something (realtime).
 */

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  session: Session | null;
  /** Opened from a password-reset email: the user must choose a new password. */
  recovery: boolean;
}

let auth: AuthState = { status: supabase ? 'loading' : 'signedOut', session: null, recovery: false };
let engine: SyncEngine | null = null;
let engineUser: string | null = null;
let stopEngine: () => void = () => {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function setAuth(next: AuthState) {
  auth = next;
  emit();
}

async function startEngine(userId: string) {
  if (!supabase || engineUser === userId) return;
  stopEngine();
  engineUser = userId;
  const e = new SyncEngine(db, supabaseRemote(supabase), userId);
  await e.start();
  if (engineUser !== userId) return e.dispose(); // signed out meanwhile
  engine = e;
  const unsub = e.subscribe(emit);

  const syncSoon = () => void e.sync();
  const onVisible = () => document.visibilityState === 'visible' && syncSoon();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', syncSoon);
  const channel = supabase
    .channel(`records:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `user_id=eq.${userId}` }, () =>
      e.schedule(400),
    )
    .subscribe();

  stopEngine = () => {
    unsub();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', syncSoon);
    void supabase?.removeChannel(channel);
    e.dispose();
    engine = null;
    engineUser = null;
    stopEngine = () => {};
    emit();
  };
  emit();
  void e.sync();
}

if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    const recovery = event === 'PASSWORD_RECOVERY' ? true : event === 'SIGNED_OUT' ? false : auth.recovery;
    setAuth({ status: session ? 'signedIn' : 'signedOut', session, recovery });
    // Don't call Supabase from inside this callback (it holds the auth lock).
    setTimeout(() => {
      if (session?.user) void startEngine(session.user.id);
      else stopEngine();
    }, 0);
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, () => auth);
}

export function useSyncState(): SyncState | null {
  return useSyncExternalStore(subscribe, () => engine?.getState() ?? null);
}

export function syncNow() {
  return engine?.sync();
}

export function finishRecovery() {
  setAuth({ ...auth, recovery: false });
}

/**
 * Signs out on this device. Pending changes are uploaded first; if that is
 * impossible (offline) the caller is told so it can ask before discarding.
 * Local data is then cleared: it belongs to the account and will come back
 * on the next sign-in.
 */
export async function signOut(opts: { discardPending?: boolean } = {}): Promise<'done' | 'pending'> {
  if (!supabase) return 'done';
  const e = engine;
  if (e) {
    await e.sync();
    if (e.getState().pending > 0 && !opts.discardPending) return 'pending';
  }
  await supabase.auth.signOut({ scope: 'local' });
  stopEngine();
  if (e) await e.clearLocal();
  return 'done';
}
