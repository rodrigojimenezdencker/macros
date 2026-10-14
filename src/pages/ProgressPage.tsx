import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useSettings } from '../hooks';
import { lastNDays, relativeLabel, shortLabel, today } from '../lib/dates';
import { fmt, fmtKcal, fmtKg } from '../lib/nutrition';
import { CaloriesChart, WeightChart, type DayStat } from '../components/charts';
import { MACROS, Swatch } from '../components/Macros';
import { NumberField, Segmented } from '../components/Field';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';

type Range = '7' | '30' | '90';

export function ProgressPage() {
  const settings = useSettings();
  const [range, setRange] = useState<Range>('7');
  const end = today();
  const days = useMemo(() => lastNDays(end, Number(range)), [end, range]);
  const from = days[0];

  const entries = useLiveQuery(() => db.entries.where('date').between(from, end, true, true).toArray(), [from, end]);
  const weights = useLiveQuery(() => db.weights.orderBy('date').toArray(), [], []);

  const stats: DayStat[] = useMemo(() => {
    const byDay = new Map(days.map((d) => [d, { date: d, kcal: 0, protein: 0, carbs: 0, fat: 0, unattributed: 0 }]));
    for (const e of entries ?? []) {
      const s = byDay.get(e.date);
      if (!s) continue;
      s.kcal += e.nutrients.kcal;
      if (e.nutrients.protein + e.nutrients.carbs + e.nutrients.fat === 0) s.unattributed += e.nutrients.kcal;
      s.protein += e.nutrients.protein;
      s.carbs += e.nutrients.carbs;
      s.fat += e.nutrients.fat;
    }
    return [...byDay.values()];
  }, [days, entries]);

  const logged = stats.filter((s) => s.kcal > 0);
  const avg = (k: 'kcal' | 'protein' | 'carbs' | 'fat') => (logged.length ? logged.reduce((a, s) => a + s[k], 0) / logged.length : 0);
  const goals = settings.goals;

  const inRange = weights.filter((w) => w.date >= from && w.date <= end);
  const latest = weights[weights.length - 1];
  const before = weights.filter((w) => w.date < from).pop();
  const baseline = before ?? inRange[0];
  const change = latest && baseline && latest.date !== baseline.date ? latest.kg - baseline.kg : undefined;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Progreso</h1>
      </header>

      <Segmented
        label="Periodo"
        value={range}
        onChange={setRange}
        options={[
          { value: '7', label: '7 días' },
          { value: '30', label: '30 días' },
          { value: '90', label: '90 días' },
        ]}
      />

      <section className="card">
        <h2 className="card-title">Calorías</h2>
        <div className="kpis">
          <div className="kpi">
            <span className="kpi-label">Media diaria</span>
            <span className="kpi-value">{fmtKcal(avg('kcal'))}</span>
            <span className="kpi-sub">objetivo {fmtKcal(goals.kcal)} kcal</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">Días registrados</span>
            <span className="kpi-value">
              {logged.length}
              <small> / {days.length}</small>
            </span>
            <span className="kpi-sub">la media solo cuenta estos días</span>
          </div>
        </div>
        <CaloriesChart days={stats} goal={goals.kcal} />
        <details className="table-view">
          <summary>Ver tabla</summary>
          <table>
            <thead>
              <tr>
                <th>Día</th>
                <th>kcal</th>
                <th>P</th>
                <th>C</th>
                <th>G</th>
              </tr>
            </thead>
            <tbody>
              {[...stats].reverse().map((s) => (
                <tr key={s.date}>
                  <td>{shortLabel(s.date)}</td>
                  <td>{s.kcal ? fmtKcal(s.kcal) : '—'}</td>
                  <td>{s.kcal ? fmt(s.protein) : '—'}</td>
                  <td>{s.kcal ? fmt(s.carbs) : '—'}</td>
                  <td>{s.kcal ? fmt(s.fat) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section className="card">
        <h2 className="card-title">Macros (media diaria)</h2>
        <ul className="avg-macros">
          {MACROS.map((m) => {
            const a = avg(m.key);
            const g = goals[m.key];
            return (
              <li key={m.key}>
                <span className="macro-name">
                  <Swatch macro={m.key} />
                  {m.label}
                </span>
                <span>
                  <strong>{fmt(a)} g</strong>
                  <span className="muted"> / {fmt(g)} g</span>
                </span>
                <span className="muted small">{g > 0 ? `${Math.round((a / g) * 100)} %` : ''}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <WeightCard
        latest={latest?.kg}
        change={change}
        changeSince={baseline?.date}
        inRange={inRange}
        from={from}
        to={end}
        recent={[...weights].reverse().slice(0, 10)}
      />
    </div>
  );
}

function WeightCard({
  latest,
  change,
  changeSince,
  inRange,
  from,
  to,
  recent,
}: {
  latest?: number;
  change?: number;
  changeSince?: string;
  inRange: { date: string; kg: number }[];
  from: string;
  to: string;
  recent: { date: string; kg: number }[];
}) {
  const [kg, setKg] = useState<number | undefined>();
  const [date, setDate] = useState(today());

  const save = async () => {
    if (!kg || kg <= 0) return;
    await db.weights.put({ date, kg });
    // Keep the profile's weight current so calculated goals stay sensible.
    const s = await db.settings.get('settings');
    if (s?.profile && date === today()) await db.settings.put({ ...s, profile: { ...s.profile, weightKg: kg } });
    setKg(undefined);
    toast('Peso guardado');
  };

  return (
    <section className="card">
      <h2 className="card-title">Peso</h2>
      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">Actual</span>
          <span className="kpi-value">{latest ? fmtKg(latest) : '—'}<small> kg</small></span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Cambio</span>
          <span className="kpi-value">
            {change === undefined ? '—' : `${change > 0.05 ? '+' : change < -0.05 ? '−' : ''}${fmtKg(Math.abs(change))}`}
            <small> kg</small>
          </span>
          {change !== undefined && changeSince && <span className="kpi-sub">desde {shortLabel(changeSince)}</span>}
        </div>
      </div>

      {inRange.length >= 2 ? (
        <WeightChart points={inRange} from={from} to={to} />
      ) : (
        <p className="muted small">Registra tu peso al menos dos días para ver la gráfica.</p>
      )}

      <form
        className="weight-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <NumberField label="Peso" value={kg} onChange={setKg} suffix="kg" decimals={1} placeholder={latest ? fmtKg(latest) : '75'} />
        <label className="field">
          <span className="field-label">Fecha</span>
          <span className="field-input">
            <input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </span>
        </label>
        <button className="btn btn-primary" disabled={!kg}>
          Guardar
        </button>
      </form>

      {recent.length > 0 && (
        <ul className="weights">
          {recent.map((w, i) => {
            const prev = recent[i + 1];
            const d = prev ? w.kg - prev.kg : undefined;
            return (
              <li key={w.date}>
                <span>{relativeLabel(w.date)}</span>
                <span className="muted small">{d === undefined || Math.abs(d) < 0.05 ? '' : `${d > 0 ? '+' : '−'}${fmtKg(Math.abs(d))}`}</span>
                <strong>{fmtKg(w.kg)} kg</strong>
                <button
                  className="icon-btn"
                  aria-label={`Eliminar peso de ${relativeLabel(w.date)}`}
                  onClick={async () => {
                    await db.weights.delete(w.date);
                    toast('Peso eliminado', { label: 'Deshacer', run: () => void db.weights.put(w) });
                  }}
                >
                  <Icon name="trash" size={18} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
