import { useId, useMemo, useState } from 'react';
import type { FoodSnapshot, MealId, MeasureId, Nutrients, Portion } from '../types';
import { fmt, fmtKcal, scale } from '../lib/nutrition';
import { MEALS } from '../lib/meals';
import { amountOf, defaultPortion, isApprox, measureGroups, measureOf, portionFor, qtyIn } from '../lib/units';
import { MacroSplitBar } from './Macros';
import { NumberField, Segmented } from './Field';
import { Sheet } from './Sheet';
import { Icon } from './Icon';

const EXTRA: { key: keyof Nutrients; label: string }[] = [
  { key: 'fiber', label: 'Fibra' },
  { key: 'sugar', label: 'Azúcares' },
  { key: 'saturatedFat', label: 'Grasas saturadas' },
  { key: 'salt', label: 'Sal' },
];

export function FoodDetailSheet({
  food,
  initialAmount,
  initialPortion,
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
  food: FoodSnapshot & { lastPortion?: Portion };
  /** Editing: the amount already logged, and how it was entered. */
  initialAmount?: number;
  initialPortion?: Portion;
  initialMeal?: MealId;
  showMeal: boolean;
  confirmLabel: string;
  onConfirm: (amount: number, meal: MealId, portion: Portion) => void;
  onClose: () => void;
  onDelete?: () => void;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  onEdit?: () => void;
}) {
  const [start] = useState(() =>
    initialAmount !== undefined ? portionFor(food, initialAmount, initialPortion) : defaultPortion(food),
  );
  const [measure, setMeasure] = useState<MeasureId>(start.measure);
  const [qty, setQty] = useState<number | undefined>(start.qty);
  const [meal, setMeal] = useState<MealId>(initialMeal ?? 'breakfast');
  const unitId = useId();

  const m = measureOf(food, measure)!;
  const amount = amountOf(food, { measure, qty });
  const n = useMemo(() => scale(food.per100, amount), [food.per100, amount]);
  const u = food.unit;
  const approx = isApprox(food, measure);

  const switchMeasure = (next: MeasureId) => {
    if (next === measure || !measureOf(food, next)) return;
    // Keep the same amount when it reads well in the new unit.
    if (qty !== undefined) setQty(qtyIn(food, next, amount));
    setMeasure(next);
  };
  const step = (dir: 1 | -1) =>
    setQty((q) => {
      const f = 10 ** m.decimals;
      return Math.max(0, Math.round(((q ?? 0) + dir * m.step) * f) / f);
    });

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
          <button className="btn btn-primary btn-grow" disabled={!(amount > 0)} onClick={() => onConfirm(amount, meal, { measure, qty: qty! })}>
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

      <label className="field">
        <span className="field-label" id={unitId}>
          Unidad
        </span>
        <span className="field-input">
          <select aria-labelledby={unitId} value={measure} onChange={(e) => switchMeasure(e.target.value as MeasureId)}>
            {measureGroups(food).map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.measures.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.option}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </span>
      </label>

      <div className="qty-row">
        <button className="icon-btn round" aria-label="Menos" onClick={() => step(-1)}>
          <Icon name="minus" />
        </button>
        <NumberField label="Cantidad" value={qty} onChange={setQty} decimals={Math.max(2, m.decimals)} />
        <button className="icon-btn round" aria-label="Más" onClick={() => step(1)}>
          <Icon name="plus" />
        </button>
      </div>
      {measure === 'serving' && food.servingLabel && <p className="muted small center">1 porción = {food.servingLabel}</p>}
      {approx && (
        <p className="muted small center">
          {u === 'g'
            ? 'Aproximado: se cuenta 1 ml como 1 g. Vale para líquidos; la harina, la avena o los cereales pesan bastante menos, mejor en gramos.'
            : 'Aproximado: se cuenta 1 g como 1 ml.'}
        </p>
      )}

      <div className="detail-kcal">
        <span className="hero-figure">{fmtKcal(n.kcal)}</span>
        <span className="muted">
          kcal en {approx && '≈'}
          {fmt(amount)} {u}
        </span>
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
