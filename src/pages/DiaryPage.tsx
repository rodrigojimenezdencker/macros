import { useRef, useState } from 'react';
import { copyFromYesterday, db } from '../db';
import { NO_ENTRIES, useDbQuery, useSettings } from '../hooks';
import { navigate } from '../router';
import type { DiaryEntry, MealId, Nutrients } from '../types';
import { addDays, relativeLabel, today } from '../lib/dates';
import { fmt, fmtKcal, scale, totals, ZERO } from '../lib/nutrition';
import { MEALS, mealLabel } from '../lib/meals';
import { CalorieSummary, MacroLine, MacroMeters } from '../components/Macros';
import { FoodDetailSheet } from '../components/FoodDetailSheet';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { Menu } from '../components/Menu';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';

type Editing = { kind: 'entry'; entry: DiaryEntry } | { kind: 'quick'; meal: MealId } | null;

function amountLabel(e: DiaryEntry): string {
  if (!e.food) return '';
  const { servingSize, unit } = e.food;
  if (servingSize) {
    const servings = e.amount / servingSize;
    if (Math.abs(servings * 4 - Math.round(servings * 4)) < 0.01) {
      return `${fmt(servings)} ${servings === 1 ? 'porción' : 'porciones'} · ${fmt(e.amount)} ${unit}`;
    }
  }
  return `${fmt(e.amount)} ${unit}`;
}

async function deleteWithUndo(entry: DiaryEntry) {
  await db.entries.delete(entry.id!);
  toast(`${entry.name} eliminado`, { label: 'Deshacer', run: () => void db.entries.add(entry) });
}

export function DiaryPage({ date }: { date: string }) {
  const settings = useSettings();
  const entries = useDbQuery(() => db.entries.where('date').equals(date).sortBy('createdAt'), [date], NO_ENTRIES);
  const [editing, setEditing] = useState<Editing>(null);
  const dateInput = useRef<HTMLInputElement>(null);

  const goTo = (d: string) => navigate(d === today() ? '/' : `/?d=${d}`, { replace: true });
  const day = totals(entries ?? []);
  const goals = settings.goals;

  const copyYesterday = async (meal: MealId) => {
    const n = await copyFromYesterday(date, meal);
    toast(n ? `Copiados ${n} ${n === 1 ? 'alimento' : 'alimentos'} de ayer` : `Ayer no había nada en ${mealLabel(meal).toLowerCase()}`);
  };

  const saveQuick = async (name: string, n: Nutrients, meal: MealId, existing?: DiaryEntry) => {
    if (existing) await db.entries.update(existing.id!, { name, nutrients: n, meal });
    else await db.entries.add({ date, meal, name, amount: 0, nutrients: n, createdAt: Date.now() });
    setEditing(null);
  };

  return (
    <div className="page">
      <header className="date-nav">
        <button className="icon-btn" onClick={() => goTo(addDays(date, -1))} aria-label="Día anterior">
          <Icon name="left" />
        </button>
        <button
          className="date-label"
          onClick={() => {
            const el = dateInput.current;
            try {
              el?.showPicker();
            } catch {
              el?.click();
            }
          }}
        >
          <Icon name="calendar" size={18} />
          {relativeLabel(date)}
        </button>
        <input
          ref={dateInput}
          className="visually-hidden"
          type="date"
          tabIndex={-1}
          aria-label="Elegir fecha"
          value={date}
          onChange={(e) => e.target.value && goTo(e.target.value)}
        />
        <button className="icon-btn" onClick={() => goTo(addDays(date, 1))} aria-label="Día siguiente">
          <Icon name="right" />
        </button>
      </header>

      <section className="card summary">
        <h2 className="card-title">Calorías</h2>
        <CalorieSummary eaten={day.kcal} goal={goals.kcal} />
        <MacroMeters totals={day} goals={goals} />
      </section>

      {MEALS.map((meal) => {
        const list = (entries ?? []).filter((e) => e.meal === meal.id);
        const t = totals(list);
        return (
          <section className="card meal" key={meal.id} aria-labelledby={`meal-${meal.id}`}>
            <header className="meal-head">
              <h2 id={`meal-${meal.id}`}>{meal.label}</h2>
              <span className="meal-kcal">{list.length > 0 && `${fmtKcal(t.kcal)} kcal`}</span>
              <Menu
                label={`Opciones de ${meal.label}`}
                items={[
                  { label: 'Copiar de ayer', icon: 'copy', onSelect: () => void copyYesterday(meal.id) },
                  { label: 'Añadido rápido', icon: 'bolt', onSelect: () => setEditing({ kind: 'quick', meal: meal.id }) },
                ]}
              />
            </header>
            {list.length > 0 && (
              <ul className="entries">
                {list.map((e) => (
                  <li key={e.id}>
                    <button className="entry" onClick={() => setEditing({ kind: 'entry', entry: e })}>
                      <span className="entry-main">
                        <span className="entry-name">{e.name}</span>
                        <span className="entry-sub">
                          {e.food?.brand && <>{e.food.brand} · </>}
                          {e.food ? amountLabel(e) : 'Añadido rápido'}
                        </span>
                        <MacroLine n={e.nutrients ?? ZERO} />
                      </span>
                      <span className="entry-kcal">{fmtKcal(e.nutrients?.kcal ?? 0)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {list.length > 0 && (
              <div className="meal-total">
                <MacroLine n={t} />
              </div>
            )}
            <button className="add-food" onClick={() => navigate(`/add?d=${date}&meal=${meal.id}`)}>
              <Icon name="plus" size={18} /> Añadir alimento
            </button>
          </section>
        );
      })}

      <DayExtras n={day} fiberGoal={goals.fiber} />

      {editing?.kind === 'entry' && editing.entry.food && (
        <FoodDetailSheet
          food={editing.entry.food}
          initialAmount={editing.entry.amount}
          initialMeal={editing.entry.meal}
          showMeal
          confirmLabel="Guardar"
          onClose={() => setEditing(null)}
          onConfirm={async (amount, meal) => {
            const e = editing.entry;
            await db.entries.update(e.id!, { amount, meal, nutrients: scale(e.food!.per100, amount) });
            setEditing(null);
          }}
          onDelete={async () => {
            setEditing(null);
            await deleteWithUndo(editing.entry);
          }}
        />
      )}
      {editing?.kind === 'entry' && !editing.entry.food && (
        <QuickAddSheet
          initial={editing.entry.nutrients}
          initialName={editing.entry.name}
          initialMeal={editing.entry.meal}
          onClose={() => setEditing(null)}
          onConfirm={(name, n, meal) => saveQuick(name, n, meal, editing.entry)}
          onDelete={async () => {
            setEditing(null);
            await deleteWithUndo(editing.entry);
          }}
        />
      )}
      {editing?.kind === 'quick' && (
        <QuickAddSheet initialMeal={editing.meal} onClose={() => setEditing(null)} onConfirm={(name, n, meal) => saveQuick(name, n, meal)} />
      )}
    </div>
  );
}

function DayExtras({ n, fiberGoal }: { n: Nutrients; fiberGoal?: number }) {
  const rows: [string, number | undefined, string][] = [
    ['Fibra', n.fiber, fiberGoal ? ` / ${fiberGoal} g` : ' g'],
    ['Azúcares', n.sugar, ' g'],
    ['Grasas saturadas', n.saturatedFat, ' g'],
    ['Sal', n.salt, ' g'],
  ];
  return (
    <details className="card extras-card">
      <summary>Más nutrientes</summary>
      <dl className="extras">
        {rows.map(([label, v, unit]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {v === undefined ? '—' : fmt(v)}
              {v === undefined ? '' : unit}
            </dd>
          </div>
        ))}
      </dl>
      <p className="muted small">Solo cuentan los alimentos que traen estos datos.</p>
    </details>
  );
}
