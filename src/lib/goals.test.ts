import { describe, expect, it } from 'vitest';
import { bmr, gramsFromPercent, profileProblem, suggestGoals, tdee } from './goals';
import type { Profile } from '../types';

const profile: Profile = { sex: 'male', age: 30, heightCm: 180, weightKg: 80, activity: 'moderate', goal: 'maintain' };

describe('energy', () => {
  it('computes Mifflin–St Jeor BMR', () => {
    expect(bmr(profile)).toBe(1780);
    expect(bmr({ ...profile, sex: 'female' })).toBe(1614);
  });

  it('applies the activity factor', () => {
    expect(tdee(profile)).toBeCloseTo(1780 * 1.55);
  });
});

describe('suggestGoals', () => {
  it('fills calories with protein, 25 % fat and carbs', () => {
    const g = suggestGoals(profile);
    expect(g.kcal).toBe(2760);
    expect(g.protein).toBe(144);
    expect(g.fat).toBe(77);
    // Macros add back up to the calorie target (within rounding).
    expect(Math.abs(g.protein * 4 + g.carbs * 4 + g.fat * 9 - g.kcal)).toBeLessThan(10);
  });

  it('subtracts the deficit and raises protein when cutting', () => {
    const g = suggestGoals({ ...profile, goal: 'lose_fast' });
    expect(g.kcal).toBe(2260);
    expect(g.protein).toBe(160);
  });
});

describe('gramsFromPercent', () => {
  it('converts a percentage split into grams', () => {
    expect(gramsFromPercent(2000, { protein: 30, carbs: 40, fat: 30 })).toEqual({ protein: 150, carbs: 200, fat: 67 });
  });
});

describe('robustness', () => {
  it('falls back instead of throwing on an unknown activity or goal', () => {
    const odd = { ...profile, activity: 'couch', goal: 'bulk' } as unknown as Profile;
    expect(tdee(odd)).toBeCloseTo(1780 * 1.2);
    expect(suggestGoals(odd).kcal).toBe(2140);
  });

  it('flags implausible calculator input', () => {
    expect(profileProblem(profile)).toBeNull();
    expect(profileProblem({ ...profile, weightKg: 8000 })).toMatch(/peso/);
    expect(profileProblem({ ...profile, heightCm: 18 })).toMatch(/altura/);
    expect(profileProblem({ ...profile, age: 3 })).toMatch(/edad/);
  });
});
