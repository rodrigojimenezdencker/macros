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

/**
 * Change stamps: wall-clock milliseconds, but always later than any stamp
 * this device has seen (a Lamport clock). So an edit always beats the version
 * it edits, even if this device's clock runs behind the one that wrote it.
 */
export function stamp(): number {
  const now = Date.now();
  lastStamp = now > lastStamp ? now : lastStamp + 1;
  return lastStamp;
}

/** Moves the clock past a stamp seen on a row or from the server. */
export function observe(ts: number | undefined) {
  if (typeof ts === 'number' && Number.isFinite(ts) && ts > lastStamp) lastStamp = ts;
}

export function newUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * A stable uid for a row that predates sync, derived from its content, so
 * the same old row on two devices maps to the same server record.
 */
export function legacyUid(kind: string, row: Record<string, unknown>): string {
  const parts =
    kind === 'entry'
      ? [row.date, row.meal, row.name, row.amount, row.createdAt]
      : [row.name, row.brand, row.barcode, row.source, row.createdAt];
  const text = `${kind}|${JSON.stringify(parts)}`;
  // Two independent 53-bit hashes (cyrb53) → 106 bits, formatted like a uuid.
  const hash = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  };
  const h = hash(1) + hash(2);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(16, 28).padEnd(12, '0')}`;
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
    observe(obj.updatedAt); // re-adding a row (undo) must still count as newer
    obj.updatedAt = stamp();
    obj.dirty = 1;
    this.onsuccess = () => tx.on('complete', changed);
  });

  table.hook('updating', function (mods, _key, obj: T, tx) {
    if (isRemote(tx)) return;
    observe(obj.updatedAt);
    this.onsuccess = () => tx.on('complete', changed);
    const extra: Partial<Tracked> = { updatedAt: stamp(), dirty: 1 };
    // A whole-object replace that drops the uid must not cut the row loose from its server copy.
    if (opts.withUid && 'uid' in (mods as object) && !(mods as Tracked).uid) extra.uid = obj.uid ?? newUid();
    return extra;
  });

  table.hook('deleting', function (_key, obj: T | undefined, tx) {
    // Deleting a key that isn't there (double tap, already removed by sync) is a no-op.
    if (isRemote(tx) || !recordDeletes || !obj) return;
    const key = opts.keyOf(obj);
    if (!key) return;
    observe(obj.updatedAt);
    const at = stamp();
    tx.on('complete', () => {
      void opts
        .tombstones()
        .put({ kind: opts.kind, key, at })
        .then(changed, () => {});
    });
  });
}
