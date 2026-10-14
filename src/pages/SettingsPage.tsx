import { useEffect, useRef, useState } from 'react';
import { db, exportAll, importAll, isBackup, saveSettings, wipeData } from '../db';
import { useSettings } from '../hooks';
import type { ActivityLevel, Goals, GoalType, Profile, Sex } from '../types';
import { ACTIVITY, GOAL, bmr, gramsFromPercent, minimumKcal, profileProblem, suggestGoals, tdee } from '../lib/goals';
import { fmtKcal, kcalFromMacros, macroSplit } from '../lib/nutrition';
import { OFF_COUNTRIES } from '../lib/openfoodfacts';
import { sanitizeBackup } from '../lib/backup';
import { today } from '../lib/dates';
import { NumberField, Segmented } from '../components/Field';
import { MACROS, Swatch } from '../components/Macros';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';
import { cloudEnabled } from '../cloud/supabase';
import { signOut, syncNow, useAuth, useSyncState } from '../cloud/session';

export function SettingsPage() {
  const settings = useSettings();
  return (
    <div className="page">
      <header className="page-head">
        <h1>Ajustes</h1>
      </header>
      {cloudEnabled && <AccountCard />}
      <GoalsCard goals={settings.goals} key={JSON.stringify(settings.goals)} />
      <CalculatorCard profile={settings.profile} />
      <section className="card form">
        <h2 className="card-title">
          <Icon name="globe" size={18} /> Búsqueda de alimentos
        </h2>
        <label className="field">
          <span className="field-label">Priorizar productos de</span>
          <span className="field-input">
            <select value={settings.offCountry} onChange={(e) => void saveSettings({ offCountry: e.target.value })}>
              {OFF_COUNTRIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </span>
        </label>
        <p className="muted small">Busca en la base de datos abierta Open Food Facts. Elegir tu país da resultados más relevantes.</p>
      </section>
      <BackupCard />
      <section className="card about">
        <h2 className="card-title">
          <Icon name="info" size={18} /> Acerca de
        </h2>
        <p className="small">
          {cloudEnabled
            ? 'Tus datos se guardan en tu cuenta y en este dispositivo, así que puedes usar la app sin conexión y en varios dispositivos.'
            : 'Tus datos se guardan solo en este dispositivo; no hay cuentas ni servidores. Haz una copia de seguridad de vez en cuando, sobre todo antes de cambiar de móvil o borrar los datos del navegador.'}
        </p>
        <p className="small muted">
          Datos de productos ©{' '}
          <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">
            colaboradores de Open Food Facts
          </a>
          , bajo licencia ODbL.
        </p>
        <p className="small muted">Versión {__APP_VERSION__}</p>
      </section>
    </div>
  );
}

function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(ms).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function AccountCard() {
  const auth = useAuth();
  const sync = useSyncState();
  const [busy, setBusy] = useState(false);
  // Re-render every minute so "hace X min" stays true.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const status = !sync
    ? 'Preparando la sincronización…'
    : sync.status === 'syncing'
      ? 'Sincronizando…'
      : sync.status === 'offline'
        ? 'Sin conexión: los cambios se subirán al volver la red.'
        : sync.status === 'error'
          ? `No se ha podido sincronizar: ${sync.error}`
          : sync.lastSyncedAt
            ? `Sincronizado ${timeAgo(sync.lastSyncedAt)}`
            : 'Sin sincronizar todavía';

  const doSignOut = async () => {
    setBusy(true);
    try {
      let result = await signOut();
      if (result === 'pending') {
        const ok = confirm(
          'Hay cambios que aún no se han subido a tu cuenta (¿sin conexión?). Si cierras sesión ahora se perderán. ¿Cerrar sesión de todos modos?',
        );
        if (!ok) return;
        result = await signOut({ discardPending: true });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card form account">
      <h2 className="card-title">
        <Icon name="user" size={18} /> Cuenta
      </h2>
      <div className="account-row">
        <div>
          <div className="account-email">{auth.session?.user.email}</div>
          <div className={`small ${sync?.status === 'error' ? 'error' : 'muted'}`} role="status">
            {status}
            {sync && sync.pending > 0 && sync.status !== 'syncing' ? ` · ${sync.pending} cambios pendientes` : ''}
          </div>
        </div>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={() => void syncNow()} disabled={!sync || sync.status === 'syncing'}>
          <Icon name="sync" size={18} /> Sincronizar ahora
        </button>
        <button className="btn" onClick={() => void doSignOut()} disabled={busy}>
          <Icon name="logout" size={18} /> Cerrar sesión
        </button>
      </div>
    </section>
  );
}

type GoalMode = 'grams' | 'percent';

function GoalsCard({ goals }: { goals: Goals }) {
  const [mode, setMode] = useState<GoalMode>('grams');
  const [protein, setProtein] = useState<number | undefined>(goals.protein);
  const [carbs, setCarbs] = useState<number | undefined>(goals.carbs);
  const [fat, setFat] = useState<number | undefined>(goals.fat);
  const [fiber, setFiber] = useState<number | undefined>(goals.fiber);
  const split0 = macroSplit(goals);
  const [kcal, setKcal] = useState<number | undefined>(goals.kcal);
  const [pct, setPct] = useState({
    protein: Math.round(split0.protein),
    carbs: Math.round(split0.carbs),
    fat: 100 - Math.round(split0.protein) - Math.round(split0.carbs),
  });

  const pctSum = pct.protein + pct.carbs + pct.fat;
  const grams =
    mode === 'grams'
      ? { protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 }
      : gramsFromPercent(kcal ?? 0, pct);
  const total = mode === 'grams' ? Math.round(kcalFromMacros(grams.protein, grams.carbs, grams.fat)) : (kcal ?? 0);
  const valid = total > 0 && (mode === 'grams' || pctSum === 100);
  const dirty =
    total !== goals.kcal ||
    grams.protein !== goals.protein ||
    grams.carbs !== goals.carbs ||
    grams.fat !== goals.fat ||
    fiber !== goals.fiber;

  const save = async () => {
    await saveSettings({ goals: { kcal: total, ...grams, fiber } });
    toast('Objetivos guardados');
  };

  const switchMode = (m: GoalMode) => {
    // Carry the current numbers across so switching never loses work.
    if (m === 'grams') {
      setProtein(grams.protein);
      setCarbs(grams.carbs);
      setFat(grams.fat);
    } else {
      const s = macroSplit(grams);
      setKcal(total);
      setPct({ protein: Math.round(s.protein), carbs: Math.round(s.carbs), fat: 100 - Math.round(s.protein) - Math.round(s.carbs) });
    }
    setMode(m);
  };

  return (
    <section className="card form">
      <h2 className="card-title">
        <Icon name="target" size={18} /> Objetivos diarios
      </h2>
      <Segmented
        label="Fijar macros en"
        value={mode}
        onChange={switchMode}
        options={[
          { value: 'grams', label: 'Gramos' },
          { value: 'percent', label: 'Porcentajes' },
        ]}
      />
      {mode === 'grams' ? (
        <>
          <div className="grid-3">
            <NumberField label="Proteína" value={protein} onChange={setProtein} suffix="g" decimals={0} />
            <NumberField label="Carbohidratos" value={carbs} onChange={setCarbs} suffix="g" decimals={0} />
            <NumberField label="Grasas" value={fat} onChange={setFat} suffix="g" decimals={0} />
          </div>
          <p className="goal-total">
            Calorías: <strong>{fmtKcal(total)} kcal</strong> <span className="muted small">(4 kcal/g P y C, 9 kcal/g G)</span>
          </p>
        </>
      ) : (
        <>
          <NumberField label="Calorías" value={kcal} onChange={setKcal} suffix="kcal" decimals={0} />
          <div className="grid-3">
            {MACROS.map((m) => (
              <NumberField
                key={m.key}
                label={m.label}
                value={pct[m.key]}
                onChange={(v) => setPct((p) => ({ ...p, [m.key]: Math.round(v ?? 0) }))}
                suffix="%"
                decimals={0}
                hint={`${grams[m.key]} g`}
              />
            ))}
          </div>
          {pctSum !== 100 && <p className="error small">Los porcentajes suman {pctSum} %; deben sumar 100 %.</p>}
        </>
      )}
      <NumberField label="Fibra (opcional)" value={fiber} onChange={setFiber} suffix="g" decimals={0} />
      <button className="btn btn-primary" disabled={!valid || !dirty} onClick={() => void save()}>
        Guardar objetivos
      </button>
    </section>
  );
}

const DEFAULT_PROFILE: Profile = { sex: 'male', age: 30, heightCm: 175, weightKg: 75, activity: 'moderate', goal: 'maintain' };

function CalculatorCard({ profile }: { profile?: Profile }) {
  const [open, setOpen] = useState(!profile);
  const [p, setP] = useState<Partial<Profile>>(profile ?? { sex: 'male', activity: 'moderate', goal: 'maintain' });
  const loadedProfile = useRef(false);

  // The saved profile arrives asynchronously on first load.
  useEffect(() => {
    if (profile && !loadedProfile.current) {
      loadedProfile.current = true;
      setP(profile);
      setOpen(false);
    }
  }, [profile]);

  const complete = !!(p.age && p.heightCm && p.weightKg && p.sex && p.activity && p.goal);
  const problem = complete ? profileProblem(p as Profile) : null;
  const full = complete && !problem ? (p as Profile) : null;
  const suggestion = full ? suggestGoals(full) : null;
  const set = <K extends keyof Profile>(k: K) => (v: Profile[K] | undefined) => setP((prev) => ({ ...prev, [k]: v }));

  const apply = async () => {
    if (!full || !suggestion) return;
    await saveSettings({ goals: suggestion, profile: full });
    if (!(await db.weights.get(today()))) await db.weights.put({ date: today(), kg: full.weightKg });
    toast('Objetivos actualizados');
    setOpen(false);
  };

  return (
    <section className="card form">
      <button className="card-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="card-title">
          <Icon name="scale" size={18} /> Calcular mis objetivos
        </span>
        <Icon name={open ? 'minus' : 'plus'} size={18} />
      </button>
      {open && (
        <>
          <p className="muted small">
            Estimamos tu gasto diario con la fórmula de Mifflin-St Jeor y lo ajustamos a tu objetivo. Es un punto de partida:
            revisa tu peso cada semana y ajusta.
          </p>
          <Segmented<Sex>
            label="Sexo"
            value={p.sex ?? 'male'}
            onChange={set('sex')}
            options={[
              { value: 'male', label: 'Hombre' },
              { value: 'female', label: 'Mujer' },
            ]}
          />
          <div className="grid-3">
            <NumberField label="Edad" value={p.age} onChange={set('age')} suffix="años" decimals={0} placeholder={String(DEFAULT_PROFILE.age)} />
            <NumberField label="Altura" value={p.heightCm} onChange={set('heightCm')} suffix="cm" decimals={0} placeholder="175" />
            <NumberField label="Peso" value={p.weightKg} onChange={set('weightKg')} suffix="kg" decimals={1} placeholder="75" />
          </div>
          <label className="field">
            <span className="field-label">Actividad</span>
            <span className="field-input">
              <select value={p.activity} onChange={(e) => set('activity')(e.target.value as ActivityLevel)}>
                {Object.entries(ACTIVITY).map(([k, a]) => (
                  <option key={k} value={k}>
                    {a.label} — {a.hint}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className="field">
            <span className="field-label">Objetivo</span>
            <span className="field-input">
              <select value={p.goal} onChange={(e) => set('goal')(e.target.value as GoalType)}>
                {Object.entries(GOAL).map(([k, g]) => (
                  <option key={k} value={k}>
                    {g.label}
                  </option>
                ))}
              </select>
            </span>
          </label>

          {problem && <p className="error small">{problem}</p>}
          {full && suggestion && (
            <div className="suggestion">
              <dl className="extras">
                <div>
                  <dt>Metabolismo basal</dt>
                  <dd>{fmtKcal(bmr(full))} kcal</dd>
                </div>
                <div>
                  <dt>Gasto diario estimado</dt>
                  <dd>{fmtKcal(tdee(full))} kcal</dd>
                </div>
              </dl>
              <div className="suggestion-main">
                <span className="hero-figure">{fmtKcal(suggestion.kcal)}</span>
                <span className="muted">kcal al día</span>
              </div>
              <ul className="legend legend-inline">
                {MACROS.map((m) => (
                  <li key={m.key}>
                    <Swatch macro={m.key} />
                    {m.label} <strong>{suggestion[m.key]} g</strong>
                  </li>
                ))}
              </ul>
              {suggestion.kcal < minimumKcal(full.sex) && (
                <p className="error small">
                  Es una cantidad muy baja. Considera un objetivo más suave o consulta con un profesional sanitario.
                </p>
              )}
              <button className="btn btn-primary btn-block" onClick={() => void apply()}>
                Usar estos objetivos
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function BackupCard() {
  const fileInput = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `macros-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Copia descargada');
  };

  const doImport = async (file: File) => {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      alert('El archivo no es una copia de seguridad válida de Macros.');
      return;
    }
    if (!isBackup(data)) {
      alert('El archivo no es una copia de seguridad válida de Macros.');
      return;
    }
    const clean = sanitizeBackup(data);
    const note = clean.skipped ? ` Se omitirán ${clean.skipped} registros dañados.` : '';
    if (!confirm(`Esto sustituirá todos tus datos actuales por los de la copia (${clean.entries.length} registros).${note} ¿Continuar?`)) return;
    try {
      await importAll(clean);
      toast(clean.skipped ? `Copia restaurada (${clean.skipped} registros omitidos)` : 'Copia restaurada');
    } catch (err) {
      alert(`No se pudo restaurar la copia: ${(err as Error)?.message ?? err}. Tus datos actuales no se han tocado.`);
    }
  };

  const wipe = async () => {
    const question = cloudEnabled
      ? '¿Borrar todos tus datos? Se borrarán de tu cuenta y de todos tus dispositivos. No se puede deshacer.'
      : '¿Borrar todos los datos de este dispositivo? No se puede deshacer.';
    if (!confirm(question)) return;
    await wipeData();
    toast('Datos borrados');
  };

  return (
    <section className="card form">
      <h2 className="card-title">
        <Icon name="download" size={18} /> Copia de seguridad
      </h2>
      <div className="btn-row">
        <button className="btn" onClick={() => void doExport()}>
          <Icon name="download" size={18} /> Exportar
        </button>
        <button className="btn" onClick={() => fileInput.current?.click()}>
          <Icon name="upload" size={18} /> Importar
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void doImport(f);
          }}
        />
      </div>
      <button className="btn btn-danger-ghost" onClick={() => void wipe()}>
        <Icon name="trash" size={18} /> Borrar todos los datos
      </button>
    </section>
  );
}
