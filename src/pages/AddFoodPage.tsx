import { useEffect, useState } from 'react';
import { db, rememberFood } from '../db';
import { useSettings } from '../hooks';
import { goBack, navigate } from '../router';
import type { Food, MealId, Nutrients } from '../types';
import { relativeLabel } from '../lib/dates';
import { scale, snapshotOf } from '../lib/nutrition';
import { mealLabel } from '../lib/meals';
import { FoodPicker, takePendingPick } from '../components/FoodPicker';
import { FoodDetailSheet } from '../components/FoodDetailSheet';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';

export function AddFoodPage({ date, meal }: { date: string; meal: MealId }) {
  const settings = useSettings();
  const [selected, setSelected] = useState<Food | null>(null);
  const [quick, setQuick] = useState(false);

  // Coming back from "Crear alimento": open the new food right away.
  useEffect(() => {
    const id = takePendingPick();
    if (id !== undefined) void db.foods.get(id).then((f) => f && setSelected(f));
  }, []);

  const back = () => goBack(`/?d=${date}`);

  const add = async (food: Food, amount: number, toMeal: MealId) => {
    const id = await rememberFood(food);
    await db.entries.add({
      date,
      meal: toMeal,
      food: { ...snapshotOf(food), foodId: id },
      amount,
      name: food.name,
      nutrients: scale(food.per100, amount),
      createdAt: Date.now(),
    });
    toast(`Añadido a ${mealLabel(toMeal).toLowerCase()}`);
    back();
  };

  const addQuick = async (name: string, n: Nutrients, toMeal: MealId) => {
    await db.entries.add({ date, meal: toMeal, name, amount: 0, nutrients: n, createdAt: Date.now() });
    toast(`Añadido a ${mealLabel(toMeal).toLowerCase()}`);
    back();
  };

  const toggleFavorite = async (food: Food) => {
    const favorite = !food.favorite;
    if (food.id !== undefined) await db.foods.update(food.id, { favorite });
    else {
      // Remote result: store it so the favourite sticks (without counting as a use).
      const { id: _id, ...rest } = food;
      const existing = food.barcode ? await db.foods.where('barcode').equals(food.barcode).first() : undefined;
      const id = existing?.id ?? ((await db.foods.add({ ...rest, favorite })) as number);
      if (existing) await db.foods.update(id, { favorite });
      food = { ...food, id };
    }
    setSelected({ ...food, favorite });
  };

  return (
    <div className="page">
      <header className="page-head">
        <button className="icon-btn" onClick={back} aria-label="Volver">
          <Icon name="left" />
        </button>
        <div>
          <h1>Añadir a {mealLabel(meal).toLowerCase()}</h1>
          <p className="muted small">{relativeLabel(date)}</p>
        </div>
      </header>

      <FoodPicker
        country={settings.offCountry}
        onPick={setSelected}
        actions={
          <>
            <button className="chip" onClick={() => setQuick(true)}>
              <Icon name="bolt" size={16} /> Añadido rápido
            </button>
            <button className="chip" onClick={() => navigate('/food/new?pick=1')}>
              <Icon name="plus" size={16} /> Crear alimento
            </button>
            <button className="chip" onClick={() => navigate('/recipe/new')}>
              <Icon name="pot" size={16} /> Crear receta
            </button>
          </>
        }
      />

      {selected && (
        <FoodDetailSheet
          key={selected.id ?? selected.barcode ?? selected.name}
          food={selected}
          initialMeal={meal}
          showMeal
          confirmLabel="Añadir"
          favorite={selected.favorite}
          onToggleFavorite={() => void toggleFavorite(selected)}
          onClose={() => setSelected(null)}
          onConfirm={(amount, toMeal) => void add(selected, amount, toMeal)}
        />
      )}
      {quick && <QuickAddSheet initialMeal={meal} onClose={() => setQuick(false)} onConfirm={(n, v, m) => void addQuick(n, v, m)} />}
    </div>
  );
}
