export interface Nutrients {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  saturatedFat?: number;
  salt?: number;
}

export type Unit = 'g' | 'ml';

/** How an amount was entered: a metric unit, a household measure, or the food's own serving. */
export type MeasureId = 'serving' | 'g' | 'kg' | 'ml' | 'l' | 'glass' | 'cup' | 'tbsp' | 'tsp';

/** The quantity as the user typed it ("2 vasos"); `amount` keeps the grams/ml it works out to. */
export interface Portion {
  measure: MeasureId;
  qty: number;
}

export type FoodSource = 'off' | 'custom' | 'recipe';

export interface RecipeIngredient {
  name: string;
  brand?: string;
  amount: number;
  unit: Unit;
  per100: Nutrients;
  servingSize?: number;
  servingLabel?: string;
  portion?: Portion;
}

/** Fields every synced row carries. */
export interface SyncFields {
  /** Global id, the same on every device (local `id`s are per device). */
  uid?: string;
  /** Last local change, ms since epoch: drives sync and last-writer-wins. */
  updatedAt?: number;
}

export interface Food extends SyncFields {
  id?: number;
  name: string;
  brand?: string;
  barcode?: string;
  source: FoodSource;
  unit: Unit;
  /** Nutrients per 100 g (or 100 ml). */
  per100: Nutrients;
  /** Grams (or ml) in one serving, when the food has a natural serving. */
  servingSize?: number;
  servingLabel?: string;
  imageUrl?: string;
  favorite?: boolean;
  lastUsedAt?: number;
  useCount?: number;
  /** What the user logged last time, offered again next time. */
  lastPortion?: Portion;
  /** Recipes only: the ingredients and how many servings the batch makes. */
  ingredients?: RecipeIngredient[];
  servings?: number;
  /** Recipes only: weight of the cooked batch, if the user weighed it. */
  cookedWeight?: number;
  createdAt: number;
}

export type MealId = 'breakfast' | 'lunch' | 'dinner' | 'snacks';

/** The part of a food an entry keeps, so editing or deleting the food later never rewrites history. */
export type FoodSnapshot = Pick<Food, 'name' | 'brand' | 'unit' | 'per100' | 'servingSize' | 'servingLabel' | 'imageUrl'> & {
  foodId?: number;
};

export interface DiaryEntry extends SyncFields {
  id?: number;
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  meal: MealId;
  /** Absent for quick-add entries, which only carry totals. */
  food?: FoodSnapshot;
  /** Grams (or ml) eaten; meaningful only when `food` is set. */
  amount: number;
  /** How the amount was entered, for showing "1 vaso" instead of "250 ml". */
  portion?: Portion;
  /** Totals for this entry, computed when saved. */
  nutrients: Nutrients;
  name: string;
  createdAt: number;
}

export interface WeightEntry {
  date: string;
  kg: number;
  updatedAt?: number;
}

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type GoalType = 'lose_fast' | 'lose' | 'maintain' | 'gain' | 'gain_fast';

export interface Profile {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  goal: GoalType;
}

export interface Goals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
}

export interface Settings {
  updatedAt?: number;
  goals: Goals;
  profile?: Profile;
  /** Open Food Facts country subdomain ('world', 'es', 'mx', ...). */
  offCountry: string;
}
