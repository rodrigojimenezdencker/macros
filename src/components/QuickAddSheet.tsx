import { useState } from 'react';
import type { MealId, Nutrients } from '../types';
import { fmtKcal, kcalFromMacros } from '../lib/nutrition';
import { MEALS } from '../lib/meals';
import { NumberField, Segmented, TextField } from './Field';
import { Sheet } from './Sheet';
import { Icon } from './Icon';

export const QUICK_ADD_NAME = 'Añadido rápido';

/** Log calories/macros directly, without a food (e.g. a restaurant meal you estimated). */
export function QuickAddSheet({
  initial,
  initialName,
  initialMeal,
  onConfirm,
  onClose,
  onDelete,
}: {
  initial?: Nutrients;
  initialName?: string;
  initialMeal: MealId;
  onConfirm: (name: string, n: Nutrients, meal: MealId) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initialName && initialName !== QUICK_ADD_NAME ? initialName : '');
  const [kcal, setKcal] = useState<number | undefined>(initial?.kcal);
  const [protein, setProtein] = useState<number | undefined>(initial?.protein || undefined);
  const [carbs, setCarbs] = useState<number | undefined>(initial?.carbs || undefined);
  const [fat, setFat] = useState<number | undefined>(initial?.fat || undefined);
  const [meal, setMeal] = useState<MealId>(initialMeal);

  const fromMacros = kcalFromMacros(protein ?? 0, carbs ?? 0, fat ?? 0);
  const finalKcal = kcal ?? fromMacros;

  return (
    <Sheet
      title={onDelete ? 'Editar añadido rápido' : 'Añadido rápido'}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button className="btn btn-danger-ghost" onClick={onDelete}>
              <Icon name="trash" size={18} /> Eliminar
            </button>
          )}
          <button
            className="btn btn-primary btn-grow"
            disabled={!(finalKcal > 0)}
            onClick={() =>
              onConfirm(name.trim() || QUICK_ADD_NAME, { kcal: finalKcal, protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 }, meal)
            }
          >
            {onDelete ? 'Guardar' : 'Añadir'}
          </button>
        </>
      }
    >
      <p className="muted small">Para cuando no tienes el alimento a mano: apunta las calorías y, si las sabes, los macros.</p>
      <TextField label="Descripción (opcional)" value={name} onChange={setName} placeholder="Menú del día, tapa…" />
      <NumberField
        label="Calorías"
        value={kcal}
        onChange={setKcal}
        suffix="kcal"
        decimals={0}
        autoFocus={!initial}
        placeholder={fromMacros > 0 ? fmtKcal(fromMacros) : undefined}
        hint={kcal === undefined && fromMacros > 0 ? 'Calculadas a partir de los macros' : undefined}
      />
      <div className="grid-3">
        <NumberField label="Proteína" value={protein} onChange={setProtein} suffix="g" />
        <NumberField label="Carbohidratos" value={carbs} onChange={setCarbs} suffix="g" />
        <NumberField label="Grasas" value={fat} onChange={setFat} suffix="g" />
      </div>
      <div className="meal-pick">
        <span className="field-label">Comida</span>
        <Segmented label="Comida" value={meal} onChange={setMeal} options={MEALS.map((m) => ({ value: m.id, label: m.label }))} />
      </div>
    </Sheet>
  );
}
