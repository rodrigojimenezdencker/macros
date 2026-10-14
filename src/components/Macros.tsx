import type { Goals, Nutrients } from '../types';
import { fmt, fmtKcal, macroSplit } from '../lib/nutrition';

export const MACROS = [
  { key: 'protein', label: 'Proteína', short: 'P' },
  { key: 'carbs', label: 'Carbohidratos', short: 'C' },
  { key: 'fat', label: 'Grasas', short: 'G' },
] as const;

export type MacroKey = (typeof MACROS)[number]['key'];

/** Colour swatch that carries identity next to (never instead of) a text label. */
export function Swatch({ macro }: { macro: MacroKey | 'other' }) {
  return <span className={`swatch swatch-${macro}`} aria-hidden="true" />;
}

/** "P 12 · C 30 · G 8" with a swatch per macro. */
export function MacroLine({ n }: { n: Nutrients }) {
  return (
    <span className="macro-line">
      {MACROS.map((m) => (
        <span key={m.key} title={m.label}>
          <Swatch macro={m.key} />
          {m.short} {fmt(n[m.key])}
        </span>
      ))}
    </span>
  );
}

function Meter({ value, goal, macro }: { value: number; goal: number; macro: MacroKey | 'kcal' }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  return (
    <div className={`meter meter-${macro}`} role="presentation">
      <div className="meter-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function MacroMeters({ totals, goals }: { totals: Nutrients; goals: Goals }) {
  return (
    <div className="macro-meters">
      {MACROS.map((m) => {
        const value = totals[m.key];
        const goal = goals[m.key];
        const left = goal - value;
        return (
          <div className="macro-meter" key={m.key}>
            <div className="macro-meter-head">
              <span className="macro-name">
                <Swatch macro={m.key} />
                {m.label}
              </span>
              <span className="macro-value">
                <strong>{fmt(value)}</strong> / {fmt(goal)} g
              </span>
            </div>
            <Meter value={value} goal={goal} macro={m.key} />
            <div className="macro-left">{left >= 0 ? `Quedan ${fmt(left)} g` : `${fmt(-left)} g por encima`}</div>
          </div>
        );
      })}
    </div>
  );
}

/** MyFitnessPal's "Objetivo − Comida = Restantes" line plus a calorie meter. */
export function CalorieSummary({ eaten, goal }: { eaten: number; goal: number }) {
  const remaining = goal - eaten;
  const over = remaining < 0;
  return (
    <div className="calorie-summary">
      <div className="calorie-eq">
        <div>
          <span className="eq-value">{fmtKcal(goal)}</span>
          <span className="eq-label">Objetivo</span>
        </div>
        <span className="eq-op" aria-hidden="true">−</span>
        <div>
          <span className="eq-value">{fmtKcal(eaten)}</span>
          <span className="eq-label">Comida</span>
        </div>
        <span className="eq-op" aria-hidden="true">=</span>
        <div className={over ? 'eq-over' : 'eq-remaining'}>
          <span className="eq-value">{fmtKcal(Math.abs(remaining))}</span>
          <span className="eq-label">{over ? 'Excedidas' : 'Restantes'}</span>
        </div>
      </div>
      <Meter value={eaten} goal={goal} macro="kcal" />
    </div>
  );
}

/** Part-to-whole bar of where the calories come from, with a legend. */
export function MacroSplitBar({ n, compact = false }: { n: Nutrients; compact?: boolean }) {
  const split = macroSplit(n);
  const empty = split.protein + split.carbs + split.fat === 0;
  return (
    <div className="split">
      <div className="split-bar" aria-hidden="true">
        {empty ? (
          <span className="split-seg split-empty" style={{ flexBasis: '100%' }} />
        ) : (
          MACROS.map((m) =>
            split[m.key] > 0 ? (
              <span key={m.key} className={`split-seg split-${m.key}`} style={{ flexBasis: `${split[m.key]}%` }} />
            ) : null,
          )
        )}
      </div>
      <ul className={`legend${compact ? ' legend-compact' : ''}`}>
        {MACROS.map((m) => (
          <li key={m.key}>
            <Swatch macro={m.key} />
            <span>{m.label}</span>
            <strong>{fmt(n[m.key])} g</strong>
            <span className="muted">{Math.round(split[m.key])} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
