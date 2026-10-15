import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { MacrosDB, copyFromYesterday, exportAll, getSettings, importAll, rememberFood, saveSettings } from './db';
import type { Food } from './types';

let database: MacrosDB;

beforeEach(async () => {
  database = new MacrosDB(`test-${Math.random()}`);
  await database.open();
});

const yogurt: Food = {
  name: 'Yogur griego',
  barcode: '8480000123456',
  source: 'off',
  unit: 'g',
  per100: { kcal: 120, protein: 4, carbs: 4, fat: 10 },
  createdAt: 1,
};

describe('rememberFood', () => {
  it('de-duplicates Open Food Facts products by barcode and counts uses', async () => {
    const a = await rememberFood(yogurt, database);
    await database.foods.update(a, { favorite: true });
    const b = await rememberFood({ ...yogurt, per100: { ...yogurt.per100, kcal: 125 } }, database);
    expect(b).toBe(a);
    const stored = await database.foods.get(a);
    expect(stored).toMatchObject({ useCount: 2, favorite: true, per100: { kcal: 125 } });
  });
});

describe('rememberFood portions', () => {
  it('remembers the last portion, also on products found again by barcode', async () => {
    const id = await rememberFood(yogurt, database, { measure: 'tbsp', qty: 2 });
    expect((await database.foods.get(id))!.lastPortion).toEqual({ measure: 'tbsp', qty: 2 });
    await rememberFood({ ...yogurt, per100: { ...yogurt.per100, kcal: 125 } }, database, { measure: 'cup', qty: 1 });
    expect((await database.foods.get(id))!.lastPortion).toEqual({ measure: 'cup', qty: 1 });
    await rememberFood({ ...yogurt, id }, database, { measure: 'g', qty: 125 });
    expect((await database.foods.get(id))!.lastPortion).toEqual({ measure: 'g', qty: 125 });
    // A pick from a search result carries no portion of its own: keep the remembered one.
    await rememberFood(yogurt, database);
    expect((await database.foods.get(id))!).toMatchObject({ lastPortion: { measure: 'g', qty: 125 }, useCount: 4 });
  });
});

describe('copyFromYesterday', () => {
  it('copies a meal from the previous day', async () => {
    await database.entries.add({
      date: '2026-10-13',
      meal: 'breakfast',
      name: 'Avena',
      amount: 50,
      nutrients: { kcal: 190, protein: 7, carbs: 33, fat: 3 },
      createdAt: 1,
    });
    expect(await copyFromYesterday('2026-10-14', 'breakfast', database)).toBe(1);
    const copied = await database.entries.where('[date+meal]').equals(['2026-10-14', 'breakfast']).toArray();
    expect(copied).toHaveLength(1);
    expect(copied[0].name).toBe('Avena');
  });
});

describe('settings and backup', () => {
  it('merges settings over defaults', async () => {
    expect((await getSettings(database)).offCountry).toBe('world');
    await saveSettings({ offCountry: 'es' }, database);
    expect(await getSettings(database)).toMatchObject({ offCountry: 'es', goals: { kcal: 2000 } });
  });

  it('round-trips an export through import', async () => {
    await rememberFood(yogurt, database);
    await database.weights.put({ date: '2026-10-14', kg: 80 });
    const backup = await exportAll(database);
    const other = new MacrosDB(`test-${Math.random()}`);
    await importAll(JSON.parse(JSON.stringify(backup)), other);
    expect(await other.foods.count()).toBe(1);
    expect(await other.weights.get('2026-10-14')).toMatchObject({ date: '2026-10-14', kg: 80 });
  });
});

describe('rememberFood with user edits', () => {
  it('does not overwrite a custom food that shares a barcode', async () => {
    const id = await rememberFood({ ...yogurt, source: 'custom', per100: { ...yogurt.per100, kcal: 99 } }, database);
    expect(await rememberFood(yogurt, database)).toBe(id);
    expect((await database.foods.get(id))?.per100.kcal).toBe(99);
  });
});
