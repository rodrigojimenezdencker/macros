import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db } from '../db';
import { NO_FOODS, useDbQuery } from '../hooks';
import { navigate } from '../router';
import type { Food } from '../types';
import { getProduct, hasNutrition, OffError, searchProducts } from '../lib/openfoodfacts';
import { fmt, fmtKcal, scale } from '../lib/nutrition';
import { BarcodeScanner } from './BarcodeScanner';
import { Icon } from './Icon';
import { Segmented } from './Field';
import { MacroLine } from './Macros';

type Tab = 'recent' | 'favorites' | 'mine' | 'recipes';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

function matches(food: Food, q: string) {
  const hay = normalize(`${food.name} ${food.brand ?? ''}`);
  return normalize(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** Lets a page that sent the user to create a food open it straight away on return. */
let pendingPick: number | undefined;
export const setPendingPick = (id: number) => (pendingPick = id);
export function takePendingPick(): number | undefined {
  const id = pendingPick;
  pendingPick = undefined;
  return id;
}

export function FoodRow({ food, onClick }: { food: Food; onClick: () => void }) {
  const serving = food.servingSize;
  const ref = serving ? scale(food.per100, serving) : food.per100;
  const incomplete = !hasNutrition(food);
  return (
    <li>
      <button className="food-row" onClick={onClick}>
        {food.imageUrl ? <img src={food.imageUrl} alt="" loading="lazy" /> : <span className="food-row-ph" aria-hidden="true">{String(food.name ?? '?').charAt(0).toUpperCase()}</span>}
        <span className="food-row-main">
          <span className="food-row-name">
            {food.name}
            {food.favorite && (
              <span className="fav-mark" aria-label="Favorito">
                <Icon name="star" size={13} filled />
              </span>
            )}
          </span>
          <span className="food-row-sub">
            {food.source === 'recipe' && 'Receta · '}
            {food.brand && `${food.brand} · `}
            {serving ? `1 porción (${fmt(serving)} ${food.unit})` : `100 ${food.unit}`}
          </span>
          {incomplete ? <span className="food-row-sub warn">Sin datos nutricionales</span> : <MacroLine n={ref} />}
        </span>
        <span className="food-row-kcal">
          {incomplete ? '—' : fmtKcal(ref.kcal)}
          <small>kcal</small>
        </span>
      </button>
    </li>
  );
}

/** A product logged before offers the same portion again ("1 vaso"), even when picked from a search. */
async function withLastPortion(food: Food): Promise<Food> {
  if (!food.barcode) return food;
  try {
    const local = await db.foods.where('barcode').equals(food.barcode).first();
    return local?.lastPortion ? { ...food, lastPortion: local.lastPortion } : food;
  } catch {
    return food;
  }
}

export function FoodPicker({
  country,
  onPick,
  actions,
  hideRecipes = false,
}: {
  country: string;
  onPick: (food: Food) => void;
  actions?: ReactNode;
  hideRecipes?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('recent');
  const [results, setResults] = useState<{ query: string; foods: Food[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<{ attempt: number; of: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Leaving the picker stops a search that is still retrying.
  useEffect(() => () => abort.current?.abort(), []);

  const all = useDbQuery(() => db.foods.toArray(), [], NO_FOODS);
  const lists = useMemo(() => {
    const byRecent = [...all].filter((f) => f.lastUsedAt).sort((a, b) => b.lastUsedAt! - a.lastUsedAt!);
    const byName = (a: Food, b: Food) => String(a.name).localeCompare(String(b.name), 'es');
    return {
      recent: byRecent.slice(0, 50),
      favorites: all.filter((f) => f.favorite).sort(byName),
      mine: all.filter((f) => f.source === 'custom').sort(byName),
      recipes: hideRecipes ? [] : all.filter((f) => f.source === 'recipe').sort(byName),
    };
  }, [all, hideRecipes]);

  const q = query.trim();
  const localMatches = useMemo(
    () => (q ? all.filter((f) => matches(f, q) && !(hideRecipes && f.source === 'recipe')).slice(0, 15) : []),
    [all, q, hideRecipes],
  );

  // Typing something else drops a search still retrying for the old text.
  useEffect(() => {
    if (!abort.current || abort.current.signal.aborted) return;
    abort.current.abort();
    setLoading(false);
    setRetry(null);
  }, [q]);

  const runSearch = async () => {
    if (!q) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setLoading(true);
    setRetry(null);
    setError(null);
    try {
      const foods = await searchProducts(q, country, ctrl.signal, (attempt, of) => {
        if (!ctrl.signal.aborted) setRetry({ attempt, of });
      });
      if (!ctrl.signal.aborted) setResults({ query: q, foods });
    } catch (err) {
      if (!ctrl.signal.aborted) setError(err instanceof OffError ? err.message : 'Error al buscar. Inténtalo de nuevo.');
    } finally {
      if (!ctrl.signal.aborted) {
        setLoading(false);
        setRetry(null);
      }
    }
  };

  const pickRemote = async (food: Food) => {
    // Search results sometimes lack nutrition that the product page has.
    if (!hasNutrition(food) && food.barcode) {
      try {
        // One try only: nothing on screen says we're waiting, and the result is usable without it.
        const full = await getProduct(food.barcode, undefined, 1);
        if (full) return onPick(await withLastPortion(full));
      } catch {
        // Fall through with what we have.
      }
    }
    onPick(await withLastPortion(food));
  };

  const onScan = useCallback(
    async (code: string) => {
      setScanning(false);
      setNotFound(null);
      const local = await db.foods.where('barcode').equals(code).first();
      if (local && hasNutrition(local)) return onPick(local);
      setLoading(true);
      setError(null);
      try {
        const food = await getProduct(code);
        if (food) onPick(food);
        else setNotFound(code);
      } catch (err) {
        setError(err instanceof OffError ? err.message : 'No se pudo buscar el código.');
      } finally {
        setLoading(false);
      }
    },
    [onPick],
  );

  const showResults = results && results.query === q;
  const tabs: { value: Tab; label: string }[] = [
    { value: 'recent', label: 'Recientes' },
    { value: 'favorites', label: 'Favoritos' },
    { value: 'mine', label: 'Míos' },
    ...(hideRecipes ? [] : [{ value: 'recipes' as Tab, label: 'Recetas' }]),
  ];
  const emptyText: Record<Tab, string> = {
    recent: 'Aquí aparecerán los alimentos que vayas añadiendo.',
    favorites: 'Marca alimentos con la estrella para tenerlos a mano.',
    mine: 'Crea alimentos propios con los datos de la etiqueta.',
    recipes: 'Crea recetas con tus ingredientes para registrarlas por porción.',
  };

  return (
    <div className="picker">
      <form
        className="search-bar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          (document.activeElement as HTMLElement | null)?.blur();
          void runSearch();
        }}
      >
        <span className="search-input">
          <Icon name="search" size={18} />
          <input
            type="search"
            enterKeyHint="search"
            placeholder="Buscar alimento o marca"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar alimento"
          />
        </span>
        <button type="button" className="icon-btn boxed" onClick={() => setScanning(true)} aria-label="Escanear código de barras">
          <Icon name="scan" />
        </button>
      </form>

      {actions && <div className="picker-actions">{actions}</div>}

      {notFound && (
        <div className="notice">
          <p>
            El código <strong>{notFound}</strong> no está en Open Food Facts.
          </p>
          <button className="btn" onClick={() => navigate(`/food/new?barcode=${notFound}&pick=1`)}>
            <Icon name="plus" size={18} /> Crear este alimento
          </button>
        </div>
      )}

      {q ? (
        <>
          {localMatches.length > 0 && (
            <section>
              <h3 className="list-title">Tus alimentos</h3>
              <ul className="food-list">
                {localMatches.map((f) => (
                  <FoodRow key={f.id} food={f} onClick={() => onPick(f)} />
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3 className="list-title">Open Food Facts</h3>
            {!showResults && !loading && (
              <button className="btn btn-block" onClick={() => void runSearch()}>
                <Icon name="search" size={18} /> Buscar «{q}»
              </button>
            )}
            {loading && (
              <p className="muted center pad" role="status">
                {retry ? `Open Food Facts está saturado. Reintentando (${retry.attempt} de ${retry.of})…` : 'Buscando…'}
              </p>
            )}
            {error && <p className="error center pad">{error}</p>}
            {showResults && !loading && results.foods.length === 0 && (
              <p className="muted center pad">Sin resultados. Prueba con otras palabras o crea el alimento.</p>
            )}
            {showResults && results.foods.length > 0 && (
              <ul className="food-list">
                {results.foods.map((f, i) => (
                  <FoodRow key={f.barcode ?? i} food={f} onClick={() => void pickRemote(f)} />
                ))}
              </ul>
            )}
            <p className="attribution">
              Datos de productos de{' '}
              <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">
                Open Food Facts
              </a>{' '}
              (ODbL). Revisa la etiqueta si algo no cuadra.
            </p>
          </section>
        </>
      ) : (
        <>
          {loading && <p className="muted center pad">Buscando el código…</p>}
          {error && <p className="error center pad">{error}</p>}
          <Segmented label="Listas" value={tab} onChange={setTab} options={tabs} />
          {lists[tab].length === 0 ? (
            <p className="muted center pad">{emptyText[tab]}</p>
          ) : (
            <ul className="food-list">
              {lists[tab].map((f) => (
                <FoodRow key={f.id} food={f} onClick={() => onPick(f)} />
              ))}
            </ul>
          )}
        </>
      )}

      {scanning && <BarcodeScanner onDetected={onScan} onClose={() => setScanning(false)} />}
    </div>
  );
}
