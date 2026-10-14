import Dexie, { type EntityTable } from 'dexie';
import type { DiaryEntry, Food, MealId, Settings, WeightEntry } from './types';
import { DEFAULT_GOALS } from './lib/goals';
import { addDays } from './lib/dates';

interface SettingsRow extends Settings {
  key: 'settings';
}

export class MacrosDB extends Dexie {
  foods!: EntityTable<Food, 'id'>;
  entries!: EntityTable<DiaryEntry, 'id'>;
  weights!: EntityTable<WeightEntry, 'date'>;
  settings!: EntityTable<SettingsRow, 'key'>;

  constructor(name = 'macros') {
    super(name);
    this.version(1).stores({
      // Booleans are not valid IndexedDB keys, so favourites are filtered in memory.
      foods: '++id, name, barcode, source, lastUsedAt',
      entries: '++id, date, [date+meal]',
      weights: 'date',
      settings: 'key',
    });
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
  const { id: _id, ...rest } = food;
  return (await database.foods.add({ ...rest, lastUsedAt: now, useCount: 1, createdAt: food.createdAt ?? now })) as number;
}

export async function copyMeal(fromDate: string, toDate: string, meal: MealId, database = db): Promise<number> {
  const source = await database.entries.where('[date+meal]').equals([fromDate, meal]).toArray();
  const now = Date.now();
  await database.entries.bulkAdd(
    source.map(({ id: _id, ...e }, i) => ({ ...e, date: toDate, createdAt: now + i })),
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
    foods: await database.foods.toArray(),
    entries: await database.entries.toArray(),
    weights: await database.weights.toArray(),
    settings: await getSettings(database),
  };
}

export function isBackup(x: unknown): x is Backup {
  const b = x as Backup;
  return (
    !!b && b.app === 'macros' && Array.isArray(b.foods) && Array.isArray(b.entries) && Array.isArray(b.weights)
  );
}

/** Replaces all data with the backup's contents. */
export async function importAll(backup: Backup, database = db): Promise<void> {
  await database.transaction('rw', [database.foods, database.entries, database.weights, database.settings], async () => {
    await Promise.all([database.foods.clear(), database.entries.clear(), database.weights.clear(), database.settings.clear()]);
    await database.foods.bulkAdd(backup.foods);
    await database.entries.bulkAdd(backup.entries);
    await database.weights.bulkPut(backup.weights);
    if (backup.settings) await database.settings.put({ ...DEFAULT_SETTINGS, ...backup.settings, key: 'settings' });
  });
}
