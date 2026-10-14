import type { ActivityLevel, Goals, GoalType, Profile } from '../types';

export const ACTIVITY: Record<ActivityLevel, { label: string; hint: string; factor: number }> = {
  sedentary: { label: 'Sedentario', hint: 'Trabajo de oficina, poco o nada de ejercicio', factor: 1.2 },
  light: { label: 'Ligero', hint: 'Ejercicio 1–3 días por semana', factor: 1.375 },
  moderate: { label: 'Moderado', hint: 'Ejercicio 3–5 días por semana', factor: 1.55 },
  active: { label: 'Activo', hint: 'Ejercicio intenso 6–7 días por semana', factor: 1.725 },
  very_active: { label: 'Muy activo', hint: 'Trabajo físico o doble sesión diaria', factor: 1.9 },
};

export const GOAL: Record<GoalType, { label: string; delta: number }> = {
  lose_fast: { label: 'Perder 0,5 kg/semana', delta: -500 },
  lose: { label: 'Perder 0,25 kg/semana', delta: -250 },
  maintain: { label: 'Mantener peso', delta: 0 },
  gain: { label: 'Ganar 0,25 kg/semana', delta: 250 },
  gain_fast: { label: 'Ganar 0,5 kg/semana', delta: 500 },
};

/** Basal metabolic rate, Mifflin–St Jeor. */
export function bmr(p: Pick<Profile, 'sex' | 'age' | 'heightCm' | 'weightKg'>): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return p.sex === 'male' ? base + 5 : base - 161;
}

/** Total daily energy expenditure. */
export function tdee(p: Profile): number {
  return bmr(p) * ACTIVITY[p.activity].factor;
}

/** Floor below which we warn: very low intakes need medical supervision. */
export function minimumKcal(sex: Profile['sex']): number {
  return sex === 'male' ? 1500 : 1200;
}

/**
 * Suggested goals: calories from TDEE plus the goal's surplus/deficit,
 * protein by body weight (more when cutting to protect muscle), fat at 25 %
 * of calories, and carbohydrates filling the rest.
 */
export function suggestGoals(p: Profile): Goals {
  const kcal = Math.round((tdee(p) + GOAL[p.goal].delta) / 10) * 10;
  const proteinPerKg = p.goal.startsWith('lose') ? 2.0 : 1.8;
  const protein = Math.round(p.weightKg * proteinPerKg);
  const fat = Math.round((kcal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat, fiber: Math.round((kcal / 1000) * 14) };
}

/** Grams for each macro from a calorie target and a percentage split. */
export function gramsFromPercent(kcal: number, pct: { protein: number; carbs: number; fat: number }) {
  return {
    protein: Math.round((kcal * pct.protein) / 100 / 4),
    carbs: Math.round((kcal * pct.carbs) / 100 / 4),
    fat: Math.round((kcal * pct.fat) / 100 / 9),
  };
}

export const DEFAULT_GOALS: Goals = { kcal: 2000, protein: 150, carbs: 200, fat: 67, fiber: 28 };
