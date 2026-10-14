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
  // Dexie wraps the browser's error in `inner`; follow a few levels at most.
  let e = err as { name?: unknown; inner?: unknown } | null;
  for (let depth = 0; depth < 5 && e && typeof e === 'object'; depth++) {
    if (typeof e.name === 'string' && STORAGE_ERRORS.has(e.name)) return true;
    e = e.inner as typeof e;
  }
  return false;
}

/**
 * A reload only helps when storage worked before and then broke. So we
 * auto-reload once, mark it pending, and allow another only after a query
 * has succeeded since (plus a minimum gap, in case storage keeps flapping).
 * If storage is simply unusable, the user gets one reload and then the banner.
 */
const PENDING_KEY = 'macros:storage-reload-pending';
const LAST_KEY = 'macros:storage-reload-at';
const MIN_GAP_MS = 30_000;

let failure: string | null = null;
let workedThisLoad = false;
const listeners = new Set<() => void>();

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Called after a successful query: a later failure is a new loss worth one reload. */
export function noteStorageWorks() {
  if (workedThisLoad) return;
  workedThisLoad = true;
  try {
    session()?.removeItem(PENDING_KEY);
  } catch {
    // Nothing to clear.
  }
}

function claimReload(now: number): boolean {
  const s = session();
  if (!s) return false; // Can't remember reloading, so never risk a loop.
  try {
    if (s.getItem(PENDING_KEY)) return false;
    if (now - (Number(s.getItem(LAST_KEY)) || 0) < MIN_GAP_MS) return false;
    s.setItem(PENDING_KEY, '1');
    s.setItem(LAST_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** Records a storage failure: reloads once to reconnect, otherwise shows the banner. */
export function reportStorageError(err: unknown, now = Date.now()) {
  console.error('Storage error', err);
  if (claimReload(now)) {
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

/** For one-off reads and writes: reports storage failures, logs anything else. */
export function catchStorage(err: unknown) {
  if (isStorageError(err)) reportStorageError(err);
  else console.error(err);
}

/** When the app comes back to the foreground, check the database still answers. */
export function watchStorageHealth() {
  // Writes in event handlers use native async/await; their failures end up here.
  window.addEventListener('unhandledrejection', (e) => {
    if (isStorageError(e.reason)) {
      e.preventDefault();
      reportStorageError(e.reason);
    }
  });
  const probe = () => {
    if (document.visibilityState !== 'visible') return;
    db.settings
      .get('settings')
      .then(noteStorageWorks)
      .catch((err) => {
        if (isStorageError(err)) reportStorageError(err);
      });
  };
  document.addEventListener('visibilitychange', probe);
  window.addEventListener('pageshow', (e) => e.persisted && probe());
}
