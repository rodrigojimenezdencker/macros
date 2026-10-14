import { useSyncExternalStore } from 'react';
import { db } from './db';

/**
 * Safari (above all on iPhone, and in installed web apps) can lose its
 * connection to IndexedDB while the page sits in the background. Every query
 * then fails until the page is reloaded ("Connection to Indexed Database
 * server lost. Refresh the page to try again"). Screens already on display
 * keep their data, but any screen opened afterwards cannot read anything.
 *
 * We treat those failures as "storage unavailable": queries fall back to
 * empty results, the app reloads itself once to reconnect, and if that does
 * not help a banner explains the problem instead of a blank screen.
 */

const STORAGE_ERRORS = new Set([
  'UnknownError',
  'InvalidStateError',
  'OpenFailedError',
  'DatabaseClosedError',
  'MissingAPIError',
  'TransactionInactiveError',
  'InvalidAccessError',
]);

export function isStorageError(err: unknown): boolean {
  const e = err as { name?: unknown; inner?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  if (typeof e.name === 'string' && STORAGE_ERRORS.has(e.name)) return true;
  // Dexie wraps the browser's error in `inner`.
  return e.inner !== undefined && e.inner !== err && isStorageError(e.inner);
}

const RELOAD_KEY = 'macros:storage-reload';
const RELOAD_COOLDOWN_MS = 60_000;

let failure: string | null = null;
const listeners = new Set<() => void>();

function readReloadStamp(): number {
  try {
    return Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeReloadStamp(now: number) {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    // Without sessionStorage we cannot guard against reload loops, so don't reload.
    return false;
  }
}

/** Records a storage failure: reloads once to reconnect, otherwise shows the banner. */
export function reportStorageError(err: unknown, now = Date.now()) {
  console.error('Storage error', err);
  const last = readReloadStamp();
  if (now - last > RELOAD_COOLDOWN_MS && writeReloadStamp(now)) {
    window.location.reload();
    return;
  }
  const e = err as { name?: string; message?: string };
  const message = `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`;
  if (failure !== message) {
    failure = message;
    listeners.forEach((l) => l());
  }
}

export function useStorageFailure(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => failure,
  );
}

/** When the app comes back to the foreground, check the database still answers. */
export function watchStorageHealth() {
  const probe = () => {
    if (document.visibilityState !== 'visible') return;
    db.settings.get('settings').catch((err) => {
      if (isStorageError(err)) reportStorageError(err);
    });
  };
  document.addEventListener('visibilitychange', probe);
  window.addEventListener('pageshow', (e) => e.persisted && probe());
}
