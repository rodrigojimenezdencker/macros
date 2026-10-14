import { useMemo, useState } from 'react';
import type { FoodSnapshot, MealId, Nutrients } from '../types';
import { fmt, fmtKcal, scale } from '../lib/nutrition';
import { MEALS } from '../lib/meals';
import { MacroSplitBar } from './Macros';
import { NumberField, Segmented } from './Field';
import { Sheet } from './Sheet';
import { Icon } from './Icon';

type Mode = 'serving' | 'unit';

const EXTRA: { key: keyof Nutrients; label: string }[] = [
  { key: 'fiber', label: 'Fibra' },
  { key: 'sugar', label: 'Azúcares' },
  { key: 'saturatedFat', label: 'Grasas saturadas' },
  { key: 'salt', label: 'Sal' },
];

function initialMode(food: FoodSnapshot, amount?: number): Mode {
  if (!food.servingSize) return 'unit';
  if (amount === undefined) return 'serving';
  const servings = amount / food.servingSize;
  // Show servings only when the amount is a tidy multiple (¼ steps).
  return Math.abs(servings * 4 - Math.round(servings * 4)) < 0.01 ? 'serving' : 'unit';
}

export function FoodDetailSheet({
  food,
  initialAmount,
  initialMeal,
  showMeal,
  confirmLabel,
  onConfirm,
  onClose,
  onDelete,
  favorite,
  onToggleFavorite,
  onEdit,
}: {
  food: FoodSnapshot;
  initialAmount?: number;
  initialMeal?: MealId;
  showMeal: boolean;
  confirmLabel: string;
  onConfirm: (amount: number, meal: MealId) => void;
  onClose: () => void;
  onDelete?: () => void;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  onEdit?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(() => initialMode(food, initialAmount));
  const [qty, setQty] = useState<number | undefined>(() => {
    const m = initialMode(food, initialAmount);
    if (m === 'serving') return initialAmount !== undefined ? initialAmount / food.servingSize! : 1;
    return initialAmount ?? 100;
  });
  const [meal, setMeal] = useState<MealId>(initialMeal ?? 'breakfast');

  const amount = qty === undefined ? 0 : mode === 'serving' ? qty * (food.servingSize ?? 0) : qty;
  const n = useMemo(() => scale(food.per100, amount), [food.per100, amount]);
  const u = food.unit;

  const switchMode = (m: Mode) => {
    if (m === mode || !food.servingSize) return;
    // Keep the same amount when switching between grams and servings.
    if (qty !== undefined) setQty(m === 'serving' ? Math.round((amount / food.servingSize) * 100) / 100 : Math.round(amount));
    setMode(m);
  };

  return (
    <Sheet
      title={food.name}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button className="btn btn-danger-ghost" onClick={onDelete}>
              <Icon name="trash" size={18} /> Eliminar
            </button>
          )}
          <button className="btn btn-primary btn-grow" disabled={!(amount > 0)} onClick={() => onConfirm(amount, meal)}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="food-head">
        {food.imageUrl && <img className="food-img" src={food.imageUrl} alt="" loading="lazy" />}
        <div className="food-head-text">
          {food.brand && <div className="muted">{food.brand}</div>}
          <div className="muted small">
            Por 100 {u}: {fmtKcal(food.per100.kcal)} kcal
          </div>
        </div>
        {onEdit && (
          <button className="icon-btn" onClick={onEdit} aria-label="Editar alimento">
            <Icon name="edit" />
          </button>
        )}
        {onToggleFavorite && (
          <button
            className={`icon-btn star${favorite ? ' on' : ''}`}
            onClick={onToggleFavorite}
            aria-pressed={!!favorite}
            aria-label={favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
          >
            <Icon name="star" filled={favorite} />
          </button>
        )}
      </div>

      {food.servingSize ? (
        <Segmented
          label="Unidad"
          value={mode}
          onChange={switchMode}
          options={[
            { value: 'serving', label: `Porciones (${fmt(food.servingSize)} ${u})` },
            { value: 'unit', label: u === 'ml' ? 'Mililitros' : 'Gramos' },
          ]}
        />
      ) : null}

      <div className="qty-row">
        <button
          className="icon-btn round"
          aria-label="Menos"
          onClick={() => setQty((q) => Math.max(0, (q ?? 0) - (mode === 'serving' ? 0.5 : 10)))}
        >
          <Icon name="minus" />
        </button>
        <NumberField
          label={mode === 'serving' ? 'Número de porciones' : `Cantidad (${u})`}
          value={qty}
          onChange={setQty}
          suffix={mode === 'serving' ? undefined : u}
          decimals={2}
        />
        <button
          className="icon-btn round"
          aria-label="Más"
          onClick={() => setQty((q) => (q ?? 0) + (mode === 'serving' ? 0.5 : 10))}
        >
          <Icon name="plus" />
        </button>
      </div>
      {mode === 'serving' && food.servingLabel && (
        <p className="muted small center">1 porción = {food.servingLabel}</p>
      )}

      <div className="detail-kcal">
        <span className="hero-figure">{fmtKcal(n.kcal)}</span>
        <span className="muted">kcal en {fmt(amount)} {u}</span>
      </div>
      <MacroSplitBar n={n} />

      {EXTRA.some((x) => n[x.key] !== undefined) && (
        <dl className="extras">
          {EXTRA.filter((x) => n[x.key] !== undefined).map((x) => (
            <div key={x.key}>
              <dt>{x.label}</dt>
              <dd>{fmt(n[x.key] as number)} g</dd>
            </div>
          ))}
        </dl>
      )}

      {showMeal && (
        <div className="meal-pick">
          <span className="field-label">Comida</span>
          <Segmented label="Comida" value={meal} onChange={setMeal} options={MEALS.map((m) => ({ value: m.id, label: m.label }))} />
        </div>
      )}
    </Sheet>
  );
}
