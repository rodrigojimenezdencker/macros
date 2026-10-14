import type { MealId } from '../types';

export const MEALS: { id: MealId; label: string }[] = [
  { id: 'breakfast', label: 'Desayuno' },
  { id: 'lunch', label: 'Comida' },
  { id: 'dinner', label: 'Cena' },
  { id: 'snacks', label: 'Snacks' },
];

export function mealLabel(id: MealId): string {
  return MEALS.find((m) => m.id === id)?.label ?? id;
}

export function isMealId(s: string | null): s is MealId {
  return MEALS.some((m) => m.id === s);
}

/** A sensible meal for "now", used when adding without picking a meal first. */
export function mealForHour(hour = new Date().getHours()): MealId {
  if (hour < 11) return 'breakfast';
  if (hour < 17) return 'lunch';
  if (hour >= 20) return 'dinner';
  return 'snacks';
}
