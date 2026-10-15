import { useEffect, useMemo, useState } from 'react';
import { catchStorage } from '../storage';
import { db, rememberFood } from '../db';
import { useSettings } from '../hooks';
import { goBack } from '../router';
import type { Food, RecipeIngredient } from '../types';
import { computeRecipe, fmt, fmtKcal, scale } from '../lib/nutrition';
import { NumberField, TextField } from '../components/Field';
import { FoodPicker } from '../components/FoodPicker';
import { FoodDetailSheet } from '../components/FoodDetailSheet';
import { MacroLine, MacroSplitBar } from '../components/Macros';
import { portionLabel } from '../lib/units';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';

type Editing = { kind: 'new'; food: Food } | { kind: 'existing'; index: number } | null;

/** Build a recipe from ingredients; it is saved as a food you log by servings. */
export function RecipePage({ id }: { id?: number }) {
  const settings = useSettings();
  const [loaded, setLoaded] = useState(id === undefined);
  const [original, setOriginal] = useState<Food | null>(null);
  const [name, setName] = useState('');
  const [servings, setServings] = useState<number | undefined>(4);
  const [cookedWeight, setCookedWeight] = useState<number | undefined>();
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);

  useEffect(() => {
    if (id === undefined) return;
    void db.foods.get(id).then((f) => {
      if (f) {
        setOriginal(f);
        setName(f.name);
        setServings(f.servings ?? 1);
        setCookedWeight(f.cookedWeight);
        setIngredients(f.ingredients ?? []);
      }
      setLoaded(true);
    }).catch(catchStorage);
  }, [id]);

  const result = useMemo(() => computeRecipe(ingredients, servings ?? 1, cookedWeight), [ingredients, servings, cookedWeight]);
  const valid = name.trim() !== '' && ingredients.length > 0 && (servings ?? 0) > 0;

  const save = async () => {
    const food: Food = {
      ...(original ?? { createdAt: Date.now() }),
      name: name.trim(),
      source: 'recipe',
      unit: 'g',
      per100: result.per100,
      servingSize: Math.round(result.servingSize * 10) / 10,
      servingLabel: `1 porción (${fmt(result.servingSize)} g)`,
      ingredients,
      servings,
      cookedWeight: cookedWeight && cookedWeight > 0 ? cookedWeight : undefined,
    };
    if (id !== undefined) await db.foods.put({ ...food, id });
    else await db.foods.add(food);
    toast(id !== undefined ? 'Receta guardada' : 'Receta creada');
    goBack('/foods?tab=recipes');
  };

  const remove = async () => {
    if (!original || id === undefined) return;
    if (!confirm(`¿Eliminar la receta «${original.name}»? Lo que ya registraste en el diario no cambia.`)) return;
    await db.foods.delete(id);
    toast('Receta eliminada');
    goBack('/foods?tab=recipes');
  };

  if (!loaded) return null;

  const editingFood: Food | null =
    editing?.kind === 'new'
      ? editing.food
      : editing?.kind === 'existing'
        ? { ...ingredients[editing.index], source: 'custom', createdAt: 0 }
        : null;

  return (
    <div className="page">
      <header className="page-head">
        <button className="icon-btn" onClick={() => goBack('/foods?tab=recipes')} aria-label="Volver">
          <Icon name="left" />
        </button>
        <h1>{id !== undefined ? 'Editar receta' : 'Nueva receta'}</h1>
      </header>

      <section className="card form">
        <TextField label="Nombre" value={name} onChange={setName} placeholder="Lentejas de la abuela" autoFocus={id === undefined} />
        <div className="grid-2">
          <NumberField label="Porciones" value={servings} onChange={setServings} decimals={1} />
          <NumberField
            label="Peso cocinado"
            value={cookedWeight}
            onChange={setCookedWeight}
            suffix="g"
            decimals={0}
            hint="Opcional: pesa la olla sin tara"
          />
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Ingredientes</h2>
        {ingredients.length === 0 ? (
          <p className="muted small">Añade los ingredientes en crudo con su peso.</p>
        ) : (
          <ul className="entries">
            {ingredients.map((ing, i) => {
              const n = scale(ing.per100, ing.amount);
              return (
                <li key={i}>
                  <button className="entry" onClick={() => setEditing({ kind: 'existing', index: i })}>
                    <span className="entry-main">
                      <span className="entry-name">{ing.name}</span>
                      <span className="entry-sub">
                        {ing.brand && <>{ing.brand} · </>}
                        {portionLabel(ing, ing.amount, ing.portion)}
                      </span>
                      <MacroLine n={n} />
                    </span>
                    <span className="entry-kcal">{fmtKcal(n.kcal)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button className="add-food" onClick={() => setPicking(true)}>
          <Icon name="plus" size={18} /> Añadir ingrediente
        </button>
      </section>

      {ingredients.length > 0 && (
        <section className="card">
          <h2 className="card-title">Por porción</h2>
          <div className="detail-kcal">
            <span className="hero-figure">{fmtKcal(result.perServing.kcal)}</span>
            <span className="muted">kcal · {fmt(result.servingSize)} g</span>
          </div>
          <MacroSplitBar n={result.perServing} />
          <p className="muted small">
            Receta completa: {fmtKcal(result.total.kcal)} kcal en {fmt(result.totalWeight)} g
            {cookedWeight ? ' (peso cocinado)' : ' (peso en crudo)'}.
          </p>
        </section>
      )}

      <div className="form-actions">
        {original && (
          <button className="btn btn-danger-ghost" onClick={() => void remove()}>
            <Icon name="trash" size={18} /> Eliminar
          </button>
        )}
        <button className="btn btn-primary btn-grow" disabled={!valid} onClick={() => void save()}>
          Guardar receta
        </button>
      </div>

      {picking && (
        <Sheet title="Añadir ingrediente" onClose={() => setPicking(false)} full>
          <FoodPicker
            country={settings.offCountry}
            hideRecipes
            onPick={(food) => {
              setPicking(false);
              setEditing({ kind: 'new', food });
            }}
          />
        </Sheet>
      )}

      {editingFood && (
        <FoodDetailSheet
          food={editingFood}
          initialAmount={editing?.kind === 'existing' ? ingredients[editing.index].amount : undefined}
          initialPortion={editing?.kind === 'existing' ? ingredients[editing.index].portion : undefined}
          showMeal={false}
          confirmLabel={editing?.kind === 'existing' ? 'Guardar' : 'Añadir ingrediente'}
          onClose={() => setEditing(null)}
          onDelete={
            editing?.kind === 'existing'
              ? () => {
                  setIngredients((list) => list.filter((_, i) => i !== editing.index));
                  setEditing(null);
                }
              : undefined
          }
          onConfirm={(amount, _meal, portion) => {
            if (editing?.kind === 'existing') {
              setIngredients((list) => list.map((ing, i) => (i === editing.index ? { ...ing, amount, portion } : ing)));
            } else if (editing?.kind === 'new') {
              const f = editing.food;
              void rememberFood(f, db, portion);
              setIngredients((list) => [
                ...list,
                {
                  name: f.name,
                  brand: f.brand,
                  amount,
                  portion,
                  unit: f.unit,
                  per100: f.per100,
                  servingSize: f.servingSize,
                  servingLabel: f.servingLabel,
                },
              ]);
            }
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
