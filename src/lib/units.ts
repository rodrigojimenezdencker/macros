import type { FoodSnapshot, MeasureId, Portion, Unit } from '../types';
import { fmt } from './nutrition';

/**
 * Units for entering an amount. Everything is stored in the food's own unit
 * (g or ml, the unit its per-100 values use); a measure only says how many of
 * those one unit holds. Weight and volume are bridged at 1 ml ≈ 1 g, close
 * enough for milk, juice or oil, and flagged as approximate in the UI.
 */

export interface Measure {
  id: MeasureId;
  /** Grams or millilitres in one. */
  base: Unit;
  size: number;
  /** "1 vaso" / "2 vasos"; metric units use their symbol for both. */
  one: string;
  many: string;
  /** Name in the unit picker. */
  option: string;
  /** Step of the − / + buttons. */
  step: number;
  /** Decimals kept when an amount is converted into this measure. */
  decimals: number;
  /** Counted in whole or partial units ("1 vaso") rather than measured ("250 ml"). */
  household: boolean;
}

type Sized = Pick<FoodSnapshot, 'unit' | 'servingSize'>;

const metric = (id: MeasureId, base: Unit, size: number, name: string, step: number, decimals: number): Measure => ({
  id,
  base,
  size,
  one: id,
  many: id,
  option: `${name} (${id})`,
  step,
  decimals,
  household: false,
});

const household = (id: MeasureId, size: number, one: string, many: string): Measure => ({
  id,
  base: 'ml',
  size,
  one,
  many,
  option: `${one[0].toUpperCase()}${one.slice(1)} (${size} ml)`,
  step: 0.5,
  decimals: 2,
  household: true,
});

const WEIGHT: Measure[] = [metric('g', 'g', 1, 'Gramos', 10, 1), metric('kg', 'g', 1000, 'Kilos', 0.1, 3)];

const VOLUME: Measure[] = [
  metric('ml', 'ml', 1, 'Mililitros', 10, 1),
  metric('l', 'ml', 1000, 'Litros', 0.1, 3),
  household('glass', 250, 'vaso', 'vasos'),
  household('cup', 240, 'taza', 'tazas'),
  household('tbsp', 15, 'cucharada', 'cucharadas'),
  household('tsp', 5, 'cucharadita', 'cucharaditas'),
];

const FIXED = new Map([...WEIGHT, ...VOLUME].map((m) => [m.id, m]));

export function isMeasureId(x: unknown): x is MeasureId {
  return x === 'serving' || FIXED.has(x as MeasureId);
}

function serving(food: Sized): Measure | undefined {
  const size = food.servingSize;
  if (!size || !(size > 0)) return undefined;
  return {
    id: 'serving',
    base: food.unit,
    size,
    one: 'porción',
    many: 'porciones',
    option: `Porción (${fmt(size)} ${food.unit})`,
    step: 0.5,
    decimals: 2,
    household: true,
  };
}

/** The measure, or undefined when this food can't use it (a serving on a food without one). */
export function measureOf(food: Sized, id: MeasureId): Measure | undefined {
  return id === 'serving' ? serving(food) : FIXED.get(id);
}

/** Picker options: the serving, then the food's own kind of unit (weight or volume), then the other. */
export function measureGroups(food: Sized): { label: string; measures: Measure[] }[] {
  const weight = { label: 'Peso', measures: WEIGHT };
  const volume = { label: 'Volumen', measures: VOLUME };
  const s = serving(food);
  return [
    ...(s ? [{ label: 'Porción', measures: [s] }] : []),
    ...(food.unit === 'ml' ? [volume, weight] : [weight, volume]),
  ];
}

const round = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/** Grams (or ml) of the food that `qty` of a measure holds. */
export function amountOf(food: Sized, portion: { measure: MeasureId; qty: number | undefined }): number {
  const m = measureOf(food, portion.measure);
  if (!m || portion.qty === undefined || !(portion.qty > 0)) return 0;
  return round(portion.qty * m.size, 2);
}

/** True when the measure is volume and the food is counted by weight, or the other way round. */
export function isApprox(food: Sized, measure: MeasureId): boolean {
  const m = measureOf(food, measure);
  return !!m && m.base !== food.unit;
}

/** A household quantity reads well in quarters (½ vaso, 1¾ tazas); anything else is a converted leftover. */
const tidy = (qty: number) => Math.abs(qty * 4 - Math.round(qty * 4)) < 0.01;

/**
 * The quantity to show after switching to another measure: the same amount
 * when it reads well ("250 ml" → "1 vaso", "500 g" → "0,5 kg"), otherwise
 * one of the new unit ("100 ml" → "1 vaso", not "0,4 vasos").
 */
export function qtyIn(food: Sized, measure: MeasureId, amount: number): number {
  const m = measureOf(food, measure);
  if (!m) return 0;
  const qty = round(amount / m.size, m.decimals);
  if (!m.household) return qty;
  return tidy(qty) ? qty : 1;
}

/** What the sheet starts with for a new entry: the last portion used, one serving, or 100 g/ml. */
export function defaultPortion(food: Sized & { lastPortion?: Portion }): Portion {
  const last = food.lastPortion;
  if (last && isMeasureId(last.measure) && measureOf(food, last.measure) && last.qty > 0) return { measure: last.measure, qty: last.qty };
  if (serving(food)) return { measure: 'serving', qty: 1 };
  return { measure: food.unit, qty: 100 };
}

/**
 * How an existing amount was entered. Uses the saved portion when it still
 * adds up to the amount (an older version of the app may have changed the
 * amount without it), else reads the amount as servings or plain g/ml.
 */
export function portionFor(food: Sized, amount: number, saved?: Portion): Portion {
  if (saved && isMeasureId(saved.measure) && saved.qty > 0) {
    const m = measureOf(food, saved.measure);
    if (m && Math.abs(saved.qty * m.size - amount) <= Math.max(0.01, amount * 0.005)) return { measure: saved.measure, qty: saved.qty };
  }
  const s = serving(food);
  if (s && amount > 0 && tidy(amount / s.size)) return { measure: 'serving', qty: amount / s.size };
  return { measure: food.unit, qty: amount };
}

function qtyText(qty: number, m: Measure): string {
  return m.id === 'g' || m.id === 'ml' ? fmt(qty) : qty.toLocaleString('es-ES', { maximumFractionDigits: m.decimals });
}

/** "1 vaso · 250 ml", "0,5 l", "2 porciones · 30 g", "80 g". */
export function portionLabel(food: Sized, amount: number, saved?: Portion): string {
  const p = portionFor(food, amount, saved);
  const m = measureOf(food, p.measure)!;
  const text = `${qtyText(p.qty, m)} ${p.qty === 1 ? m.one : m.many}`;
  return m.household ? `${text} · ${fmt(amount)} ${food.unit}` : text;
}
