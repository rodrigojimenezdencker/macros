import type { DiaryEntry, Food, FoodSnapshot, Nutrients, Profile, RecipeIngredient, Settings, Unit, WeightEntry } from '../types';
import { ACTIVITY, DEFAULT_GOALS, GOAL, isPlausibleWeight } from './goals';
import { isISODate } from './dates';
import { isMealId } from './meals';
import { OFF_COUNTRIES } from './openfoodfacts';

/**
 * Backups are plain JSON files people can edit or that other versions may
 * have written, so nothing in them is trusted: every row is checked and
 * normalised, and rows that can't be repaired are skipped (and counted).
 */

type Raw = Record<string, unknown>;

const isObj = (x: unknown): x is Raw => !!x && typeof x === 'object' && !Array.isArray(x);
const nonNeg = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : undefined);
const positive = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : undefined);
const text = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x.trim() : undefined);
const unit = (x: unknown): Unit => (x === 'ml' ? 'ml' : 'g');
// Ids far below 2^53: a huge explicit id would exhaust IndexedDB's key generator for good.
const MAX_ID = 2 ** 31;
const id = (x: unknown): number | undefined =>
  Number.isSafeInteger(x) && (x as number) > 0 && (x as number) < MAX_ID ? (x as number) : undefined;

function nutrients(x: unknown): Nutrients | null {
  if (!isObj(x)) return null;
  const out: Nutrients = {
    kcal: nonNeg(x.kcal) ?? 0,
    protein: nonNeg(x.protein) ?? 0,
    carbs: nonNeg(x.carbs) ?? 0,
    fat: nonNeg(x.fat) ?? 0,
  };
  for (const k of ['fiber', 'sugar', 'saturatedFat', 'salt'] as const) {
    const v = nonNeg(x[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function ingredient(x: unknown): RecipeIngredient | null {
  if (!isObj(x)) return null;
  const name = text(x.name);
  const amount = positive(x.amount);
  const per100 = nutrients(x.per100);
  if (!name || !amount || !per100) return null;
  return {
    name,
    brand: text(x.brand),
    amount,
    unit: unit(x.unit),
    per100,
    servingSize: positive(x.servingSize),
    servingLabel: text(x.servingLabel),
  };
}

function food(x: unknown): Food | null {
  if (!isObj(x)) return null;
  const name = text(x.name);
  const per100 = nutrients(x.per100);
  if (!name || !per100) return null;
  const source = x.source === 'off' || x.source === 'recipe' ? x.source : 'custom';
  const out: Food = {
    id: id(x.id),
    name,
    brand: text(x.brand),
    barcode: text(x.barcode),
    source,
    unit: unit(x.unit),
    per100,
    servingSize: positive(x.servingSize),
    servingLabel: text(x.servingLabel),
    imageUrl: typeof x.imageUrl === 'string' && /^https:\/\//.test(x.imageUrl) ? x.imageUrl : undefined,
    favorite: x.favorite === true || undefined,
    lastUsedAt: positive(x.lastUsedAt),
    useCount: nonNeg(x.useCount),
    createdAt: positive(x.createdAt) ?? Date.now(),
  };
  if (source === 'recipe') {
    out.ingredients = Array.isArray(x.ingredients) ? x.ingredients.map(ingredient).filter((i): i is RecipeIngredient => !!i) : [];
    out.servings = positive(x.servings) ?? 1;
    out.cookedWeight = positive(x.cookedWeight);
  }
  return out;
}

function snapshot(x: unknown): FoodSnapshot | undefined {
  if (!isObj(x)) return undefined;
  const name = text(x.name);
  const per100 = nutrients(x.per100);
  if (!name || !per100) return undefined;
  return {
    foodId: id(x.foodId),
    name,
    brand: text(x.brand),
    unit: unit(x.unit),
    per100,
    servingSize: positive(x.servingSize),
    servingLabel: text(x.servingLabel),
    imageUrl: typeof x.imageUrl === 'string' && /^https:\/\//.test(x.imageUrl) ? x.imageUrl : undefined,
  };
}

function entry(x: unknown): DiaryEntry | null {
  if (!isObj(x)) return null;
  const n = nutrients(x.nutrients);
  if (!isISODate(x.date) || !isMealId(typeof x.meal === 'string' ? x.meal : null) || !n) return null;
  const snap = snapshot(x.food);
  return {
    id: id(x.id),
    date: x.date,
    meal: x.meal as DiaryEntry['meal'],
    food: snap,
    amount: nonNeg(x.amount) ?? 0,
    nutrients: n,
    name: text(x.name) ?? snap?.name ?? 'Sin nombre',
    createdAt: positive(x.createdAt) ?? Date.now(),
  };
}

function weight(x: unknown): WeightEntry | null {
  if (!isObj(x) || !isISODate(x.date) || typeof x.kg !== 'number' || !isPlausibleWeight(x.kg)) return null;
  return { date: x.date, kg: x.kg };
}

function profile(x: unknown): Profile | undefined {
  if (!isObj(x)) return undefined;
  const { sex, activity, goal } = x;
  if (sex !== 'male' && sex !== 'female') return undefined;
  if (typeof activity !== 'string' || !Object.hasOwn(ACTIVITY, activity)) return undefined;
  if (typeof goal !== 'string' || !Object.hasOwn(GOAL, goal)) return undefined;
  const age = positive(x.age);
  const heightCm = positive(x.heightCm);
  // Out-of-range values are kept: the calculator flags them when it loads the profile.
  const weightKg = positive(x.weightKg);
  if (!age || !heightCm || !weightKg) return undefined;
  return { sex, activity: activity as Profile['activity'], goal: goal as Profile['goal'], age, heightCm, weightKg };
}

function settings(x: unknown): Settings {
  const s = isObj(x) ? x : {};
  const g = isObj(s.goals) ? s.goals : {};
  const kcal = positive(g.kcal);
  return {
    goals: kcal
      ? {
          kcal,
          protein: nonNeg(g.protein) ?? 0,
          carbs: nonNeg(g.carbs) ?? 0,
          fat: nonNeg(g.fat) ?? 0,
          fiber: nonNeg(g.fiber),
        }
      : DEFAULT_GOALS,
    profile: profile(s.profile),
    offCountry: OFF_COUNTRIES.some((c) => c.id === s.offCountry) ? (s.offCountry as string) : 'world',
  };
}

/** Drops undefined fields (an explicit `id: undefined` can upset IndexedDB key generation). */
function compact<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Keeps the first row for each id, and puts rows with an id before rows
 * without one: auto-generated keys could otherwise collide with an explicit
 * id later in the list and abort the whole import.
 */
function uniqueIds<T extends { id?: number }>(rows: T[]): T[] {
  const seen = new Set<number>();
  const withId = rows.filter((r) => r.id !== undefined && !seen.has(r.id) && !!seen.add(r.id));
  return [...withId, ...rows.filter((r) => r.id === undefined)];
}

export interface CleanBackup {
  foods: Food[];
  entries: DiaryEntry[];
  weights: WeightEntry[];
  settings: Settings;
  /** Rows dropped because they could not be repaired. */
  skipped: number;
}

export function sanitizeBackup(raw: { foods: unknown[]; entries: unknown[]; weights: unknown[]; settings?: unknown }): CleanBackup {
  const foods = uniqueIds(raw.foods.map(food).filter((f): f is Food => !!f)).map(compact);
  const entries = uniqueIds(raw.entries.map(entry).filter((e): e is DiaryEntry => !!e)).map((e) =>
    compact({ ...e, food: e.food && compact(e.food) }),
  );
  const weights = raw.weights.map(weight).filter((w): w is WeightEntry => !!w);
  const skipped =
    raw.foods.length - foods.length + (raw.entries.length - entries.length) + (raw.weights.length - weights.length);
  return { foods, entries, weights, settings: settings(raw.settings), skipped };
}
