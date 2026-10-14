import Dexie, { type EntityTable, type Table } from 'dexie';
import type { DiaryEntry, Food, MealId, Settings, WeightEntry } from './types';
import { DEFAULT_GOALS } from './lib/goals';
import { addDays } from './lib/dates';
import { newUid, recordsDeletes, stamp, track, type Kind, type Tombstone, type Tracked } from './sync/tracking';

export interface SettingsRow extends Settings, Tracked {
  key: 'settings';
}

/** Sync bookkeeping for the signed-in account on this device. */
export interface SyncMeta {
  key: 'sync';
  userId: string;
  /** Highest server timestamp already applied (ISO string), null before the first download. */
  pullCursor: string | null;
  lastSyncedAt?: number;
}

type FoodRow = Food & Tracked;
type EntryRow = DiaryEntry & Tracked;
type WeightRow = WeightEntry & Tracked;

export class MacrosDB extends Dexie {
  foods!: EntityTable<FoodRow, 'id'>;
  entries!: EntityTable<EntryRow, 'id'>;
  weights!: EntityTable<WeightRow, 'date'>;
  settings!: EntityTable<SettingsRow, 'key'>;
  tombstones!: Table<Tombstone, [Kind, string]>;
  meta!: EntityTable<SyncMeta, 'key'>;

  constructor(name = 'macros') {
    super(name);
    this.version(1).stores({
      // Booleans are not valid IndexedDB keys, so favourites are filtered in memory.
      foods: '++id, name, barcode, source, lastUsedAt',
      entries: '++id, date, [date+meal]',
      weights: 'date',
      settings: 'key',
    });
    // v2: cloud sync. Rows get a global uid (local ids differ per device), a
    // change stamp and a dirty flag; deletions leave tombstones.
    this.version(2)
      .stores({
        foods: '++id, &uid, name, barcode, source, lastUsedAt, dirty',
        entries: '++id, &uid, date, [date+meal], dirty',
        weights: 'date, dirty',
        settings: 'key',
        tombstones: '[kind+key]',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const at = stamp();
        const mark = (row: Tracked, withUid: boolean) => {
          if (withUid && !row.uid) row.uid = newUid();
          row.updatedAt ??= at;
          row.dirty = 1;
        };
        await tx.table('foods').toCollection().modify((r: Tracked) => mark(r, true));
        await tx.table('entries').toCollection().modify((r: Tracked) => mark(r, true));
        await tx.table('weights').toCollection().modify((r: Tracked) => mark(r, false));
        await tx.table('settings').toCollection().modify((r: Tracked) => mark(r, false));
      });

    const tombstones = () => this.tombstones;
    track<FoodRow>(this.foods, { kind: 'food', withUid: true, keyOf: (r) => r.uid, tombstones });
    track<EntryRow>(this.entries, { kind: 'entry', withUid: true, keyOf: (r) => r.uid, tombstones });
    track<WeightRow>(this.weights, { kind: 'weight', withUid: false, keyOf: (r) => r.date, tombstones });
    track<SettingsRow>(this.settings, { kind: 'settings', withUid: false, keyOf: () => 'settings', tombstones });
  }
}

export const db = new MacrosDB();

export const DEFAULT_SETTINGS: Settings = { goals: DEFAULT_GOALS, offCountry: 'world' };

export async function getSettings(database = db): Promise<Settings> {
  const row = await database.settings.get('settings');
  if (!row) return DEFAULT_SETTINGS;
  const { key: _key, ...rest } = row;
  return { ...DEFAULT_SETTINGS, ...rest };
}

export async function saveSettings(patch: Partial<Settings>, database = db): Promise<void> {
  const current = await getSettings(database);
  await database.settings.put({ ...current, ...patch, key: 'settings' });
}

/**
 * Stores a food the user picked so it shows up in "Recientes". Foods from
 * Open Food Facts are de-duplicated by barcode.
 */
export async function rememberFood(food: Food, database = db): Promise<number> {
  const now = Date.now();
  if (food.id !== undefined) {
    const existing = await database.foods.get(food.id);
    if (existing) {
      await database.foods.update(food.id, { lastUsedAt: now, useCount: (existing.useCount ?? 0) + 1 });
      return food.id;
    }
  }
  if (food.barcode) {
    const existing = await database.foods.where('barcode').equals(food.barcode).first();
    if (existing?.id !== undefined) {
      const usage = { lastUsedAt: now, useCount: (existing.useCount ?? 0) + 1 };
      // Never overwrite a food the user created or edited.
      if (existing.source !== 'off' || food.source !== 'off') {
        await database.foods.update(existing.id, usage);
        return existing.id;
      }
      // Refresh nutrition from the source but keep the user's favourite flag.
      await database.foods.update(existing.id, {
        ...food,
        id: existing.id,
        favorite: existing.favorite,
        createdAt: existing.createdAt,
        ...usage,
      });
      return existing.id;
    }
  }
  const { id: _id, uid: _uid, ...rest } = food as Food & Tracked;
  return (await database.foods.add({ ...rest, lastUsedAt: now, useCount: 1, createdAt: food.createdAt ?? now })) as number;
}

export async function copyMeal(fromDate: string, toDate: string, meal: MealId, database = db): Promise<number> {
  const source = await database.entries.where('[date+meal]').equals([fromDate, meal]).toArray();
  const now = Date.now();
  await database.entries.bulkAdd(
    source.map(({ id: _id, uid: _uid, ...e }, i) => ({ ...e, date: toDate, createdAt: now + i })),
  );
  return source.length;
}

export async function copyFromYesterday(date: string, meal: MealId, database = db) {
  return copyMeal(addDays(date, -1), date, meal, database);
}

export interface Backup {
  app: 'macros';
  version: 1;
  exportedAt: string;
  foods: Food[];
  entries: DiaryEntry[];
  weights: WeightEntry[];
  settings: Settings;
}

export async function exportAll(database = db): Promise<Backup> {
  return {
    app: 'macros',
    version: 1,
    exportedAt: new Date().toISOString(),
    foods: (await database.foods.toArray()).map(({ dirty: _d, ...f }) => f),
    entries: (await database.entries.toArray()).map(({ dirty: _d, ...e }) => e),
    weights: (await database.weights.toArray()).map(({ dirty: _d, ...w }) => w),
    settings: await getSettings(database),
  };
}

export function isBackup(x: unknown): x is Backup {
  const b = x as Backup;
  return (
    !!b && b.app === 'macros' && Array.isArray(b.foods) && Array.isArray(b.entries) && Array.isArray(b.weights)
  );
}

/** Tombstones for every synced row, so clearing local data also clears it on the server. */
async function tombstoneEverything(database: MacrosDB) {
  const at = stamp();
  const [foods, entries, weights, settings] = await Promise.all([
    database.foods.toArray(),
    database.entries.toArray(),
    database.weights.toArray(),
    database.settings.get('settings'),
  ]);
  const stones: Tombstone[] = [
    ...foods.filter((f) => f.uid).map((f) => ({ kind: 'food' as const, key: f.uid!, at })),
    ...entries.filter((e) => e.uid).map((e) => ({ kind: 'entry' as const, key: e.uid!, at })),
    ...weights.map((w) => ({ kind: 'weight' as const, key: w.date, at })),
    ...(settings ? [{ kind: 'settings' as const, key: 'settings', at }] : []),
  ];
  await database.tombstones.bulkPut(stones);
}

const DATA_TABLES = (d: MacrosDB) => [d.foods, d.entries, d.weights, d.settings, d.tombstones];

/** Replaces all data with the (already validated) backup's contents. */
export async function importAll(backup: Pick<Backup, 'foods' | 'entries' | 'weights' | 'settings'>, database = db): Promise<void> {
  await database.transaction('rw', DATA_TABLES(database), async () => {
    if (recordsDeletes()) await tombstoneEverything(database);
    await Promise.all([database.foods.clear(), database.entries.clear(), database.weights.clear(), database.settings.clear()]);
    // Imported rows are new local changes: they get fresh stamps and win over the tombstones above.
    await database.foods.bulkAdd(backup.foods);
    await database.entries.bulkAdd(backup.entries);
    await database.weights.bulkPut(backup.weights);
    await database.settings.put({ ...DEFAULT_SETTINGS, ...backup.settings, key: 'settings' });
  });
}

/** Deletes every diary entry, food, weight and setting (also from the account when synced). */
export async function wipeData(database = db): Promise<void> {
  await database.transaction('rw', DATA_TABLES(database), async () => {
    if (recordsDeletes()) await tombstoneEverything(database);
    await Promise.all([database.foods.clear(), database.entries.clear(), database.weights.clear(), database.settings.clear()]);
  });
}
