import { describe, expect, it } from 'vitest';
import { computeRecipe, fmt, kcalFromMacros, macroSplit, scale, sum } from './nutrition';

describe('scale', () => {
  it('scales per-100 g values to the amount eaten', () => {
    expect(scale({ kcal: 200, protein: 10, carbs: 20, fat: 8, fiber: 4 }, 150)).toEqual({
      kcal: 300,
      protein: 15,
      carbs: 30,
      fat: 12,
      fiber: 6,
    });
  });

  it('leaves optional nutrients out when the food lacks them', () => {
    expect(scale({ kcal: 100, protein: 1, carbs: 2, fat: 3 }, 50)).not.toHaveProperty('fiber');
  });
});

describe('sum', () => {
  it('adds macros and keeps an optional field if any item has it', () => {
    const total = sum([
      { kcal: 100, protein: 5, carbs: 10, fat: 2 },
      { kcal: 50, protein: 1, carbs: 5, fat: 1, fiber: 3 },
    ]);
    expect(total).toEqual({ kcal: 150, protein: 6, carbs: 15, fat: 3, fiber: 3 });
  });

  it('returns zeros for an empty day', () => {
    expect(sum([])).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });
});

describe('macros', () => {
  it('uses Atwater factors', () => {
    expect(kcalFromMacros(100, 200, 50)).toBe(1650);
  });

  it('splits calories by macro', () => {
    const split = macroSplit({ protein: 100, carbs: 100, fat: 0 });
    expect(split.protein).toBeCloseTo(50);
    expect(split.carbs).toBeCloseTo(50);
    expect(macroSplit({ protein: 0, carbs: 0, fat: 0 })).toEqual({ protein: 0, carbs: 0, fat: 0 });
  });
});

describe('computeRecipe', () => {
  const rice = { name: 'Arroz', amount: 200, unit: 'g' as const, per100: { kcal: 350, protein: 7, carbs: 78, fat: 1 } };
  const chicken = { name: 'Pollo', amount: 300, unit: 'g' as const, per100: { kcal: 110, protein: 23, carbs: 0, fat: 2 } };

  it('derives per-100 g and per-serving values from raw weight', () => {
    const r = computeRecipe([rice, chicken], 4);
    expect(r.total.kcal).toBe(700 + 330);
    expect(r.totalWeight).toBe(500);
    expect(r.per100.kcal).toBeCloseTo(206);
    expect(r.perServing.protein).toBeCloseTo((14 + 69) / 4);
    expect(r.servingSize).toBe(125);
  });

  it('uses the cooked weight when the user weighed the batch', () => {
    const r = computeRecipe([rice, chicken], 2, 800);
    expect(r.totalWeight).toBe(800);
    expect(r.per100.kcal).toBeCloseTo(1030 / 8);
    expect(r.servingSize).toBe(400);
  });

  it('survives an empty recipe', () => {
    const r = computeRecipe([], 0);
    expect(r.per100.kcal).toBe(0);
    expect(r.perServing.kcal).toBe(0);
  });
});

describe('fmt', () => {
  it('rounds for display', () => {
    expect(fmt(12.6)).toBe('13');
    expect(fmt(2.345)).toBe('2,3');
    expect(fmt(NaN)).toBe('0');
  });
});
