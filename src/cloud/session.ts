import { useSyncExternalStore } from 'react';
import type { Session } from '@supabase/supabase-js';
import { db } from '../db';
import { SyncEngine, type SyncState } from '../sync/engine';
import { AUTH_STORAGE_KEY, supabase, supabaseRemote } from './supabase';

/**
 * Account session and sync lifecycle. When a user is signed in, one
 * SyncEngine keeps this device and the account in step: on sign-in, after
 * local changes, when the app returns to the foreground or goes online, and
 * when another device changes something (realtime).
 *
 * Offline matters: the access token lasts an hour, and refreshing it needs
 * the network. The SDK keeps the stored session when a refresh fails for lack
 * of network, so a stored session means "signed in" until the server says
 * otherwise; the app opens offline with its local data and syncs later.
 */

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  session: Session | null;
  /** Opened from a password-reset link or code: the user must choose a new password. */
  recovery: boolean;
}

/** A message about an email link the app was opened with (expired, other browser…). */
export interface LinkNotice {
  kind: 'error' | 'info';
  text: string;
}

function storedSession(): Session | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    const s = raw ? (JSON.parse(raw) as Session) : null;
    return s?.user?.id && s.refresh_token ? s : null;
  } catch {
    return null;
  }
}

/** Removes the SDK's stored session and PKCE verifiers from this device. */
function forgetStoredSession() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(AUTH_STORAGE_KEY)) localStorage.removeItem(k);
    }
  } catch {
    // Storage unavailable: nothing to forget.
  }
}

const initialStored = supabase ? storedSession() : null;
let auth: AuthState = initialStored
  ? { status: 'signedIn', session: initialStored, recovery: false }
  : { status: supabase ? 'loading' : 'signedOut', session: null, recovery: false };
let linkNotice: LinkNotice | null = null;
let engine: SyncEngine | null = null;
let engineUser: string | null = null;
let generation = 0;
let teardown: () => Promise<void> = async () => {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function setAuth(next: AuthState) {
  auth = next;
  emit();
}

async function stopEngine() {
  generation++;
  const t = teardown;
  teardown = async () => {};
  engineUser = null;
  await t();
}

async function startEngine(userId: string) {
  if (!supabase || engineUser === userId) return;
  await stopEngine();
  const gen = ++generation;
  engineUser = userId;
  const e = new SyncEngine(db, supabaseRemote(supabase), userId);
  await e.start();
  if (gen !== generation) return e.stop(); // signed out (or switched) meanwhile

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

  teardown = async () => {
    unsub();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', syncSoon);
    void supabase?.removeChannel(channel);
    if (engine === e) engine = null;
    emit();
    await e.stop();
  };
  emit();
  void e.sync();
}

/** Reads what an email link left in the URL, then tidies the URL (keeping the `#/…` route). */
function takeLinkParams() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error_code') ?? params.get('error');
  const description = params.get('error_description');
  const hadCode = params.has('code');
  if (error || description || hadCode) {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.hash}`);
  }
  return { error, description, hadCode };
}

if (supabase) {
  const link = new URLSearchParams(window.location.search);
  const linkError = link.get('error_code') ?? link.get('error') ?? link.get('error_description');

  supabase.auth.onAuthStateChange((event, session) => {
    const recovery = event === 'PASSWORD_RECOVERY' ? true : event === 'SIGNED_OUT' ? false : auth.recovery;
    if (session) {
      setAuth({ status: 'signedIn', session, recovery });
    } else if (event !== 'SIGNED_OUT' && storedSession()) {
      // Refresh failed for lack of network: stay signed in with the stored session.
      setAuth({ status: 'signedIn', session: storedSession(), recovery });
    } else {
      setAuth({ status: 'signedOut', session: null, recovery: false });
    }

    if (event === 'INITIAL_SESSION') {
      const { error, description, hadCode } = takeLinkParams();
      if (error || linkError) {
        linkNotice = {
          kind: 'error',
          text:
            error === 'otp_expired' || /expired|invalid/i.test(description ?? '')
              ? 'El enlace ha caducado o ya se usó. Pide uno nuevo.'
              : `El enlace no ha funcionado${description ? `: ${description}` : '.'}`,
        };
      } else if (hadCode && !session) {
        // The link was opened in a browser other than the one that asked for it.
        linkNotice = {
          kind: 'info',
          text: 'Si acabas de confirmar tu cuenta, ya puedes entrar con tu correo y contraseña. Para cambiar la contraseña, usa el código del correo.',
        };
      }
      emit();
    }

    // Don't call Supabase from inside this callback (it holds the auth lock).
    const userId = auth.session?.user.id;
    setTimeout(() => void (userId ? startEngine(userId) : stopEngine()), 0);
  });

  if (initialStored) setTimeout(() => void startEngine(initialStored.user.id), 0);
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

export function useLinkNotice(): LinkNotice | null {
  return useSyncExternalStore(subscribe, () => linkNotice);
}

export function dismissLinkNotice() {
  if (!linkNotice) return;
  linkNotice = null;
  emit();
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
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) {
    // E.g. offline with an expired token: the SDK keeps the session. Drop it here.
    forgetStoredSession();
    setAuth({ status: 'signedOut', session: null, recovery: false });
  }
  await stopEngine();
  if (e) await e.clearLocal();
  return 'done';
}
