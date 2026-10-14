import { describe, expect, it } from 'vitest';
import { sanitizeBackup } from './backup';

const goodFood = { id: 1, name: 'Avena', source: 'off', unit: 'g', per100: { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 }, createdAt: 1 };
const goodEntry = { id: 1, date: '2026-10-14', meal: 'breakfast', name: 'Avena', amount: 50, nutrients: { kcal: 186, protein: 6.8, carbs: 29, fat: 3.5 }, createdAt: 2 };

describe('sanitizeBackup', () => {
  it('keeps valid rows as they are', () => {
    const clean = sanitizeBackup({
      foods: [goodFood],
      entries: [goodEntry],
      weights: [{ date: '2026-10-14', kg: 80.2 }],
      settings: { goals: { kcal: 2400, protein: 160, carbs: 260, fat: 75 }, offCountry: 'es' },
    });
    expect(clean.skipped).toBe(0);
    expect(clean.foods[0]).toMatchObject(goodFood);
    expect(clean.entries[0]).toMatchObject(goodEntry);
    expect(clean.weights).toEqual([{ date: '2026-10-14', kg: 80.2 }]);
    expect(clean.settings).toMatchObject({ offCountry: 'es', goals: { kcal: 2400 } });
  });

  it('skips rows that would break the app and counts them', () => {
    const clean = sanitizeBackup({
      foods: [goodFood, { name: null, per100: {} }, { name: 'Sin datos' }, 42],
      entries: [goodEntry, { date: 'abc', meal: 'lunch', nutrients: {} }, { date: '2026-10-14', meal: 'brunch', nutrients: {} }, { date: '2026-10-14', meal: 'lunch' }],
      weights: [{ date: '2026-10-14', kg: null }, { date: 'ayer', kg: 80 }, { date: '2026-10-13', kg: 2 ** 51 }],
    });
    expect(clean.foods).toHaveLength(1);
    expect(clean.entries).toHaveLength(1);
    expect(clean.weights).toHaveLength(0);
    expect(clean.skipped).toBe(3 + 3 + 3);
  });

  it('repairs what it can', () => {
    const clean = sanitizeBackup({
      foods: [{ name: '  Pan ', source: 'weird', unit: 'kg', per100: { kcal: '250', protein: -1, carbs: 50, fat: NaN }, imageUrl: 'javascript:alert(1)' }],
      entries: [{ date: '2026-10-14', meal: 'snacks', nutrients: { kcal: 100 }, food: { name: null } }],
      weights: [],
      settings: { goals: { kcal: -5 }, profile: { sex: 'male', age: 30, heightCm: 180, weightKg: 80, activity: 'couch', goal: 'maintain' }, offCountry: 'zz' },
    });
    expect(clean.foods[0]).toMatchObject({ name: 'Pan', source: 'custom', unit: 'g', per100: { kcal: 0, protein: 0, carbs: 50, fat: 0 } });
    expect(clean.foods[0]).not.toHaveProperty('imageUrl');
    expect(clean.foods[0]).not.toHaveProperty('id');
    expect(clean.entries[0]).toMatchObject({ name: 'Sin nombre', amount: 0, nutrients: { kcal: 100, protein: 0 } });
    expect(clean.entries[0]).not.toHaveProperty('food');
    expect(clean.settings.goals.kcal).toBe(2000);
    expect(clean.settings.profile).toBeUndefined();
    expect(clean.settings.offCountry).toBe('world');
  });

  it('drops duplicate ids so the import cannot fail half-way', () => {
    const clean = sanitizeBackup({ foods: [goodFood, { ...goodFood, name: 'Copia' }], entries: [], weights: [] });
    expect(clean.foods.map((f) => f.name)).toEqual(['Avena']);
  });
});
