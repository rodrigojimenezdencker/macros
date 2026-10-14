import type { Table, Transaction } from 'dexie';

/**
 * Local change tracking for sync. Every write made by the app (not by the
 * sync engine applying server data) stamps the row with `updatedAt`, gives
 * it a global `uid` if it has none, and marks it `dirty` so the engine knows
 * to upload it. Deletions leave a tombstone so they can be uploaded too.
 */

export type Kind = 'food' | 'entry' | 'weight' | 'settings';

export interface Tombstone {
  kind: Kind;
  key: string;
  at: number;
}

/** Rows written by the app carry these; `dirty` is 1 until uploaded (0 is a valid index key, booleans are not). */
export interface Tracked {
  uid?: string;
  updatedAt?: number;
  dirty?: 0 | 1;
}

let lastStamp = 0;

/** Strictly increasing timestamps, so two edits in the same millisecond still order correctly. */
export function stamp(): number {
  const now = Date.now();
  lastStamp = now > lastStamp ? now : lastStamp + 1;
  return lastStamp;
}

export function newUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const REMOTE = Symbol('macros:remote');

/** Marks a transaction as applying server data: tracking hooks leave it alone. */
export function markRemote(tx: Transaction | null | undefined) {
  if (tx) (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;
}

function isRemote(tx: Transaction | null | undefined) {
  return !!tx && !!(tx as unknown as Record<symbol, boolean>)[REMOTE];
}

/** Whether deletions should leave tombstones (only while signed in to sync). */
let recordDeletes = false;
export function setRecordDeletes(on: boolean) {
  recordDeletes = on;
}
export function recordsDeletes() {
  return recordDeletes;
}

const listeners = new Set<(dbName: string) => void>();
/** Notified (with the database name) after a local change commits; the engine schedules an upload. */
export function onLocalChange(cb: (dbName: string) => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}
function notify(dbName: string) {
  listeners.forEach((l) => l(dbName));
}

interface TrackOptions<T> {
  kind: Kind;
  withUid: boolean;
  keyOf: (row: T) => string | undefined;
  tombstones: () => Table<Tombstone, [Kind, string]>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTable = Table<any, any, any>;

export function track<T extends Tracked>(table: AnyTable, opts: TrackOptions<T>) {
  const changed = () => notify(table.db.name);
  table.hook('creating', function (_key, obj: T, tx) {
    if (isRemote(tx)) return;
    if (opts.withUid && !obj.uid) obj.uid = newUid();
    obj.updatedAt = stamp();
    obj.dirty = 1;
    this.onsuccess = () => tx.on('complete', changed);
  });

  table.hook('updating', function (mods, _key, obj: T, tx) {
    if (isRemote(tx)) return;
    this.onsuccess = () => tx.on('complete', changed);
    const extra: Partial<Tracked> = { updatedAt: stamp(), dirty: 1 };
    // A whole-object replace that drops the uid must not cut the row loose from its server copy.
    if (opts.withUid && 'uid' in (mods as object) && !(mods as Tracked).uid) extra.uid = obj.uid ?? newUid();
    return extra;
  });

  table.hook('deleting', function (_key, obj: T, tx) {
    if (isRemote(tx) || !recordDeletes) return;
    const key = opts.keyOf(obj);
    if (!key) return;
    const at = stamp();
    tx.on('complete', () => {
      void opts
        .tombstones()
        .put({ kind: opts.kind, key, at })
        .then(changed, () => {});
    });
  });
}
