import type { DiaryEntry, Food, Nutrients, RecipeIngredient } from '../types';

export const ZERO: Nutrients = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

const OPTIONAL_KEYS = ['fiber', 'sugar', 'saturatedFat', 'salt'] as const;

/** Nutrients for `amount` grams of a food given its per-100 g values. */
export function scale(per100: Nutrients, amount: number): Nutrients {
  const f = amount / 100;
  const out: Nutrients = {
    kcal: per100.kcal * f,
    protein: per100.protein * f,
    carbs: per100.carbs * f,
    fat: per100.fat * f,
  };
  for (const k of OPTIONAL_KEYS) {
    const v = per100[k];
    if (v !== undefined) out[k] = v * f;
  }
  return out;
}

/** Adds nutrients; an optional field is present in the result if any input had it. */
export function sum(list: Nutrients[]): Nutrients {
  const out: Nutrients = { ...ZERO };
  for (const n of list) {
    out.kcal += n.kcal;
    out.protein += n.protein;
    out.carbs += n.carbs;
    out.fat += n.fat;
    for (const k of OPTIONAL_KEYS) {
      const v = n[k];
      if (v !== undefined) out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

export function totals(entries: DiaryEntry[]): Nutrients {
  return sum(entries.map((e) => e.nutrients));
}

/** Calories implied by the macros (Atwater factors 4/4/9). */
export function kcalFromMacros(protein: number, carbs: number, fat: number): number {
  return protein * 4 + carbs * 4 + fat * 9;
}

/** Share of calories coming from each macro, as 0–100 percentages. */
export function macroSplit(n: Pick<Nutrients, 'protein' | 'carbs' | 'fat'>) {
  const p = n.protein * 4;
  const c = n.carbs * 4;
  const f = n.fat * 9;
  const total = p + c + f;
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: (p / total) * 100, carbs: (c / total) * 100, fat: (f / total) * 100 };
}

export interface RecipeResult {
  total: Nutrients;
  /** Weight the per-100 g values refer to: the cooked weight if given, else raw ingredients. */
  totalWeight: number;
  per100: Nutrients;
  perServing: Nutrients;
  servingSize: number;
}

export function computeRecipe(
  ingredients: RecipeIngredient[],
  servings: number,
  cookedWeight?: number,
): RecipeResult {
  const total = sum(ingredients.map((i) => scale(i.per100, i.amount)));
  const rawWeight = ingredients.reduce((acc, i) => acc + i.amount, 0);
  const totalWeight = cookedWeight && cookedWeight > 0 ? cookedWeight : rawWeight;
  const safeServings = servings > 0 ? servings : 1;
  const per100 = totalWeight > 0 ? scale(total, 10000 / totalWeight) : { ...ZERO };
  return {
    total,
    totalWeight,
    per100,
    perServing: scale(total, 100 / safeServings),
    servingSize: totalWeight / safeServings,
  };
}

export function snapshotOf(food: Food) {
  return {
    foodId: food.id,
    name: food.name,
    brand: food.brand,
    unit: food.unit,
    per100: food.per100,
    servingSize: food.servingSize,
    servingLabel: food.servingLabel,
    imageUrl: food.imageUrl,
  };
}

/** Rounds for display: whole numbers from 10 up, one decimal below. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  const v = abs >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return v.toLocaleString('es-ES', { maximumFractionDigits: 1 });
}

/** Body weight always shows one decimal: 78,2 kg. */
export function fmtKg(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function fmtKcal(n: number): string {
  return Math.round(n).toLocaleString('es-ES');
}
