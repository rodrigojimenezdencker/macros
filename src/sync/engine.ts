import type { MacrosDB, SettingsRow, SyncMeta } from '../db';
import type { DiaryEntry, Food, WeightEntry } from '../types';
import { markRemote, onLocalChange, setRecordDeletes, type Kind, type Tombstone, type Tracked } from './tracking';

/**
 * Two-way sync between this device's IndexedDB and the account's rows on the
 * server. The server keeps one row per (kind, key) holding the record as
 * JSON plus the device timestamp of its last change; the newest change wins
 * everywhere (last writer wins), deletions included.
 *
 *  - Upload: rows marked dirty and tombstones are sent; once the server has
 *    them, rows still unchanged are marked clean and tombstones dropped.
 *  - Download: rows the server changed since our cursor are applied, unless
 *    this device has a newer change of its own waiting to go up.
 */

export interface RemoteRecord {
  kind: Kind;
  key: string;
  data: Record<string, unknown> | null;
  deleted: boolean;
  client_updated_at: number;
  server_updated_at?: string;
}

export interface Remote {
  /** Stores records, keeping the newer of server and incoming per key. */
  push(records: RemoteRecord[]): Promise<void>;
  /** Records changed after `since` (server time), in order, with the newest server time seen. */
  pull(since: string | null): Promise<{ records: RemoteRecord[]; cursor: string | null }>;
}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  error: string | null;
  /** True once this device has downloaded the account's data at least once. */
  hasPulled: boolean;
  /** Local changes not yet uploaded. */
  pending: number;
}

const PUSH_BATCH = 500;
/** Re-read a little before the cursor: rows committed out of order are not missed (re-applying is a no-op). */
const PULL_OVERLAP_MS = 2 * 60 * 1000;

type Row = Tracked & Record<string, unknown>;

function strip(kind: Kind, input: object): Record<string, unknown> {
  // Local-only fields never leave the device.
  const { id: _id, dirty: _dirty, updatedAt: _u, key: _key, ...data } = input as Row;
  if (kind === 'entry' && data.food && typeof data.food === 'object') {
    const { foodId: _f, ...food } = data.food as Record<string, unknown>;
    data.food = food;
  }
  return data;
}

function isOffline(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String((err as Error)?.message ?? err);
  return /Failed to fetch|NetworkError|Load failed|network/i.test(msg);
}

export class SyncEngine {
  private state: SyncState = { status: 'idle', lastSyncedAt: null, error: null, hasPulled: false, pending: 0 };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopTracking: () => void = () => {};
  private disposed = false;

  constructor(
    private readonly db: MacrosDB,
    private readonly remote: Remote,
    private readonly userId: string,
  ) {}

  getState(): SyncState {
    return this.state;
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /**
   * Ties this device's local data to the signed-in account. If another
   * account's data is here, it is cleared first; data from before the first
   * sign-in stays and is uploaded to the account.
   */
  async start(): Promise<void> {
    const meta = await this.db.meta.get('sync');
    if (meta && meta.userId !== this.userId) await this.clearLocal();
    if (!meta || meta.userId !== this.userId) {
      await this.db.meta.put({ key: 'sync', userId: this.userId, pullCursor: null });
    }
    const current = await this.db.meta.get('sync');
    this.set({ hasPulled: !!current?.pullCursor, lastSyncedAt: current?.lastSyncedAt ?? null });
    setRecordDeletes(true);
    this.stopTracking = onLocalChange((name) => name === this.db.name && this.schedule());
    await this.refreshPending();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.stopTracking();
    setRecordDeletes(false);
    this.listeners.clear();
  }

  /** Runs a sync soon, coalescing bursts of changes. */
  schedule(delayMs = 1200) {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), delayMs);
    void this.refreshPending();
  }

  /** Uploads then downloads. Concurrent calls share one run (plus one follow-up). */
  sync(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        this.set({ status: 'syncing', error: null });
        try {
          await this.push();
          await this.pull();
          const lastSyncedAt = Date.now();
          await this.db.meta.update('sync', { lastSyncedAt });
          this.set({ status: 'idle', lastSyncedAt, hasPulled: true });
        } catch (err) {
          this.set({
            status: isOffline(err) ? 'offline' : 'error',
            error: isOffline(err) ? null : String((err as Error)?.message ?? err),
          });
          break;
        } finally {
          await this.refreshPending();
        }
      } while (this.again && !this.disposed);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async refreshPending() {
    try {
      const [f, e, w, s, t] = await Promise.all([
        this.db.foods.where('dirty').equals(1).count(),
        this.db.entries.where('dirty').equals(1).count(),
        this.db.weights.where('dirty').equals(1).count(),
        this.db.settings.get('settings'),
        this.db.tombstones.count(),
      ]);
      const pending = f + e + w + (s?.dirty ? 1 : 0) + t;
      if (pending !== this.state.pending) this.set({ pending });
    } catch {
      // Counting is informative only.
    }
  }

  private async push(): Promise<void> {
    const db = this.db;
    const [foods, entries, weights, settings, tombstones] = await db.transaction(
      'r',
      [db.foods, db.entries, db.weights, db.settings, db.tombstones],
      () =>
        Promise.all([
          db.foods.where('dirty').equals(1).toArray(),
          db.entries.where('dirty').equals(1).toArray(),
          db.weights.where('dirty').equals(1).toArray(),
          db.settings.get('settings'),
          db.tombstones.toArray(),
        ]),
    );

    const byKey = new Map<string, RemoteRecord>();
    const put = (r: RemoteRecord) => {
      const k = `${r.kind}:${r.key}`;
      const prev = byKey.get(k);
      if (!prev || prev.client_updated_at < r.client_updated_at) byKey.set(k, r);
    };
    for (const f of foods) if (f.uid) put({ kind: 'food', key: f.uid, data: strip('food', f), deleted: false, client_updated_at: f.updatedAt ?? 0 });
    for (const e of entries) if (e.uid) put({ kind: 'entry', key: e.uid, data: strip('entry', e), deleted: false, client_updated_at: e.updatedAt ?? 0 });
    for (const w of weights) put({ kind: 'weight', key: w.date, data: strip('weight', w), deleted: false, client_updated_at: w.updatedAt ?? 0 });
    if (settings?.dirty) put({ kind: 'settings', key: 'settings', data: strip('settings', settings), deleted: false, client_updated_at: settings.updatedAt ?? 0 });
    for (const t of tombstones) put({ kind: t.kind, key: t.key, data: null, deleted: true, client_updated_at: t.at });

    const records = [...byKey.values()];
    for (let i = 0; i < records.length; i += PUSH_BATCH) {
      await this.remote.push(records.slice(i, i + PUSH_BATCH));
    }
    if (records.length === 0 && tombstones.length === 0) return;

    // Mark uploaded rows clean, unless they changed again while we were uploading.
    await db.transaction('rw', [db.foods, db.entries, db.weights, db.settings, db.tombstones], async (tx) => {
      markRemote(tx);
      for (const f of foods) {
        if ((await db.foods.get(f.id!))?.updatedAt === f.updatedAt) await db.foods.update(f.id!, { dirty: 0 });
      }
      for (const e of entries) {
        if ((await db.entries.get(e.id!))?.updatedAt === e.updatedAt) await db.entries.update(e.id!, { dirty: 0 });
      }
      for (const w of weights) {
        if ((await db.weights.get(w.date))?.updatedAt === w.updatedAt) await db.weights.update(w.date, { dirty: 0 });
      }
      if (settings?.dirty && (await db.settings.get('settings'))?.updatedAt === settings.updatedAt) {
        await db.settings.update('settings', { dirty: 0 });
      }
      for (const t of tombstones) {
        const now = await db.tombstones.get([t.kind, t.key]);
        if (now && now.at === t.at) await db.tombstones.delete([t.kind, t.key]);
      }
    });
  }

  private async pull(): Promise<void> {
    const db = this.db;
    const meta = await db.meta.get('sync');
    let since: string | null = meta?.pullCursor ?? null;
    if (since) since = new Date(new Date(since).getTime() - PULL_OVERLAP_MS).toISOString();

    const { records, cursor } = await this.remote.pull(since);
    if (records.length > 0) {
      await db.transaction('rw', [db.foods, db.entries, db.weights, db.settings, db.tombstones], async (tx) => {
        markRemote(tx);
        for (const rec of records) await this.apply(rec);
      });
    }
    // Server timestamps come with microseconds and an offset; compare as instants, store as ISO.
    const seen = cursor ? Date.parse(cursor) : NaN;
    const had = meta?.pullCursor ? Date.parse(meta.pullCursor) : 0;
    const next = Number.isFinite(seen) && seen > had ? seen : had;
    await db.meta.update('sync', { pullCursor: new Date(next).toISOString() } satisfies Partial<SyncMeta>);
  }

  /** Applies one server record inside a remote-marked transaction. */
  private async apply(rec: RemoteRecord) {
    const db = this.db;
    const tomb = await db.tombstones.get([rec.kind, rec.key]);
    if (tomb && tomb.at >= rec.client_updated_at) return; // our deletion is newer

    let local: (Tracked & { id?: number }) | undefined;
    if (rec.kind === 'food') local = await db.foods.where('uid').equals(rec.key).first();
    else if (rec.kind === 'entry') local = await db.entries.where('uid').equals(rec.key).first();
    else if (rec.kind === 'weight') local = await db.weights.get(rec.key);
    else local = await db.settings.get('settings');

    // We already have this version, or a newer one of our own waiting to go up.
    if (local && (local.updatedAt ?? 0) >= rec.client_updated_at) return;
    if (tomb) await db.tombstones.delete([rec.kind, rec.key]);

    const synced = { updatedAt: rec.client_updated_at, dirty: 0 as const };
    if (rec.deleted || !rec.data) {
      if (!local) return;
      if (rec.kind === 'food') await db.foods.delete(local.id!);
      else if (rec.kind === 'entry') await db.entries.delete(local.id!);
      else if (rec.kind === 'weight') await db.weights.delete(rec.key);
      else await db.settings.delete('settings');
      return;
    }

    const data = rec.data;
    if (rec.kind === 'food') {
      await db.foods.put({ ...(data as unknown as Food), uid: rec.key, ...synced, ...(local?.id !== undefined ? { id: local.id } : {}) });
    } else if (rec.kind === 'entry') {
      await db.entries.put({ ...(data as unknown as DiaryEntry), uid: rec.key, ...synced, ...(local?.id !== undefined ? { id: local.id } : {}) });
    } else if (rec.kind === 'weight') {
      await db.weights.put({ ...(data as unknown as WeightEntry), date: rec.key, ...synced });
    } else {
      await db.settings.put({ ...(data as unknown as SettingsRow), key: 'settings', ...synced });
    }
  }

  /** Removes this device's copy of the account's data (used on sign-out or account switch). */
  async clearLocal() {
    const db = this.db;
    await db.transaction('rw', [db.foods, db.entries, db.weights, db.settings, db.tombstones, db.meta], async (tx) => {
      markRemote(tx);
      await Promise.all([
        db.foods.clear(),
        db.entries.clear(),
        db.weights.clear(),
        db.settings.clear(),
        db.tombstones.clear(),
        db.meta.clear(),
      ]);
    });
  }
}

export type { Tombstone };
