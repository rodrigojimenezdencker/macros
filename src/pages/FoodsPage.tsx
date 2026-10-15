import { useMemo, useState } from 'react';
import { db, rememberFood } from '../db';
import { NO_FOODS, useDbQuery } from '../hooks';
import { navigate } from '../router';
import type { Food, MealId, Portion } from '../types';
import { today } from '../lib/dates';
import { scale, snapshotOf } from '../lib/nutrition';
import { mealForHour, mealLabel } from '../lib/meals';
import { FoodRow } from '../components/FoodPicker';
import { FoodDetailSheet } from '../components/FoodDetailSheet';
import { Segmented } from '../components/Field';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';

type Tab = 'favorites' | 'mine' | 'recipes' | 'recent';
const TABS: { value: Tab; label: string }[] = [
  { value: 'favorites', label: 'Favoritos' },
  { value: 'mine', label: 'Míos' },
  { value: 'recipes', label: 'Recetas' },
  { value: 'recent', label: 'Recientes' },
];

const isTab = (s: string | null): s is Tab => TABS.some((t) => t.value === s);

export function FoodsPage({ initialTab }: { initialTab: string | null }) {
  const [tab, setTab] = useState<Tab>(isTab(initialTab) ? initialTab : 'favorites');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Food | null>(null);
  const all = useDbQuery(() => db.foods.toArray(), [], NO_FOODS);

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const byName = (a: Food, b: Food) => String(a.name).localeCompare(String(b.name), 'es');
    let out: Food[];
    if (tab === 'favorites') out = all.filter((f) => f.favorite).sort(byName);
    else if (tab === 'mine') out = all.filter((f) => f.source === 'custom').sort(byName);
    else if (tab === 'recipes') out = all.filter((f) => f.source === 'recipe').sort(byName);
    else out = all.filter((f) => f.lastUsedAt).sort((a, b) => b.lastUsedAt! - a.lastUsedAt!);
    return q ? out.filter((f) => `${f.name} ${f.brand ?? ''}`.toLowerCase().includes(q)) : out;
  }, [all, tab, filter]);

  const changeTab = (t: Tab) => {
    setTab(t);
    navigate(`/foods?tab=${t}`, { replace: true });
  };

  const addToToday = async (food: Food, amount: number, meal: MealId, portion: Portion) => {
    const id = await rememberFood(food, db, portion);
    await db.entries.add({
      date: today(),
      meal,
      food: { ...snapshotOf(food), foodId: id },
      amount,
      portion,
      name: food.name,
      nutrients: scale(food.per100, amount),
      createdAt: Date.now(),
    });
    setSelected(null);
    toast(`Añadido a ${mealLabel(meal).toLowerCase()} de hoy`);
  };

  const edit = (food: Food) => navigate(food.source === 'recipe' ? `/recipe/${food.id}` : `/food/${food.id}`);

  const empty: Record<Tab, string> = {
    favorites: 'Aún no tienes favoritos. Toca la estrella al ver un alimento.',
    mine: 'Crea alimentos con los datos de su etiqueta, o los que no encuentres en la búsqueda.',
    recipes: 'Las recetas calculan los macros por porción a partir de sus ingredientes.',
    recent: 'Aquí verás lo último que has registrado.',
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Alimentos</h1>
      </header>
      <div className="picker-actions">
        <button className="chip" onClick={() => navigate('/food/new')}>
          <Icon name="plus" size={16} /> Crear alimento
        </button>
        <button className="chip" onClick={() => navigate('/recipe/new')}>
          <Icon name="pot" size={16} /> Crear receta
        </button>
      </div>
      <Segmented label="Listas" value={tab} onChange={changeTab} options={TABS} />
      {all.length > 0 && (
        <span className="search-input filter">
          <Icon name="search" size={18} />
          <input type="search" placeholder="Filtrar" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar" />
        </span>
      )}
      {list.length === 0 ? (
        <p className="muted center pad">{filter ? 'Nada coincide con el filtro.' : empty[tab]}</p>
      ) : (
        <ul className="food-list">
          {list.map((f) => (
            <FoodRow key={f.id} food={f} onClick={() => setSelected(f)} />
          ))}
        </ul>
      )}

      {selected && (
        <FoodDetailSheet
          key={selected.id}
          food={selected}
          initialMeal={mealForHour()}
          showMeal
          confirmLabel="Añadir a hoy"
          favorite={selected.favorite}
          onToggleFavorite={async () => {
            await db.foods.update(selected.id!, { favorite: !selected.favorite });
            setSelected({ ...selected, favorite: !selected.favorite });
          }}
          onEdit={() => edit(selected)}
          onClose={() => setSelected(null)}
          onConfirm={(amount, meal, portion) => void addToToday(selected, amount, meal, portion)}
        />
      )}
    </div>
  );
}
