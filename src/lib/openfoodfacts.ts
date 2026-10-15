import type { Food, Nutrients, Unit } from '../types';

/**
 * Open Food Facts client. OFF is a free, open database with CORS enabled, so
 * the browser talks to it directly. Their limits are generous for one person
 * (100 product reads/min, 10 searches/min), so we search on submit, never on
 * every keystroke.
 */

export const OFF_COUNTRIES: { id: string; label: string }[] = [
  { id: 'world', label: 'Todo el mundo' },
  { id: 'es', label: 'España' },
  { id: 'mx', label: 'México' },
  { id: 'ar', label: 'Argentina' },
  { id: 'co', label: 'Colombia' },
  { id: 'cl', label: 'Chile' },
  { id: 'pe', label: 'Perú' },
  { id: 'us', label: 'Estados Unidos' },
  { id: 'uk', label: 'Reino Unido' },
  { id: 'fr', label: 'Francia' },
  { id: 'it', label: 'Italia' },
  { id: 'de', label: 'Alemania' },
];

const FIELDS = [
  'code',
  'product_name',
  'product_name_es',
  'product_name_en',
  'generic_name',
  'generic_name_es',
  'brands',
  'nutriments',
  'serving_size',
  'serving_quantity',
  'serving_quantity_unit',
  'product_quantity_unit',
  'quantity',
  'categories_tags',
  'image_front_small_url',
  'image_small_url',
].join(',');

type Raw = Record<string, unknown>;

export class OffError extends Error {}

function num(v: unknown, max = Infinity): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= max ? n : undefined;
}

// Nothing has more than 100 g of a nutrient, or ~900 kcal (pure fat), per 100 g.
// Larger values are data-entry errors in the database (often kJ typed as kcal).
const MAX_G = 100;
const MAX_KCAL = 1000;
const MAX_KJ = MAX_KCAL * 4.184;

function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(', ') || undefined;
  return undefined;
}

function firstBrand(v: unknown): string | undefined {
  return str(v)?.split(',')[0]?.trim() || undefined;
}

function kcalFrom(n: Raw): number | undefined {
  const kcal = num(n['energy-kcal_100g'], MAX_KCAL);
  if (kcal !== undefined) return kcal;
  const kj = num(n['energy-kj_100g'], MAX_KJ) ?? num(n['energy_100g'], MAX_KJ);
  return kj !== undefined ? kj / 4.184 : undefined;
}

const VOLUME_UNIT = /^(ml|cl|dl|l|fl\.? ?oz)$/;
const WEIGHT_UNIT = /^(mg|g|kg|oz|lbs?)$/;
// JavaScript's \b treats "á" as a word break, which would read "1 lámina" as litres.
const VOLUME_TEXT = /\d\s*(ml|cl|dl|l|litros?|fl\.? ?oz)(?![\p{L}\p{N}_])/iu;
const WEIGHT_TEXT = /\d\s*(mg|g|gr|grs|gramos?|kg|kilos?|oz|lbs?)(?![\p{L}\p{N}_])/iu;
const DRINK_TAGS = ['en:beverages', 'en:milks', 'en:plant-based-milks', 'en:juices', 'en:waters', 'en:sodas'];
// Drink categories that are sold dry: cocoa powder, instant coffee, tea bags…
const DRY_TAGS = ['en:dried-products', 'en:beverage-preparations', 'en:instant-beverages', 'en:powdered-milks', 'en:coffees', 'en:teas'];

/** Whether nutrition is per 100 ml: from the pack size, then the serving, then the category. */
function unitFrom(p: Raw): Unit {
  for (const field of [p.product_quantity_unit, p.serving_quantity_unit]) {
    const u = str(field)?.toLowerCase();
    if (u && VOLUME_UNIT.test(u)) return 'ml';
    if (u && WEIGHT_UNIT.test(u)) return 'g';
  }
  for (const field of [p.quantity, p.serving_size]) {
    // The first unit named decides: "30 g + 125 ml de leche" is a 30 g serving.
    const text = str(field) ?? '';
    const volume = VOLUME_TEXT.exec(text)?.index ?? Infinity;
    const weight = WEIGHT_TEXT.exec(text)?.index ?? Infinity;
    if (volume < weight) return 'ml';
    if (weight < volume) return 'g';
  }
  const tags = Array.isArray(p.categories_tags) ? p.categories_tags : [];
  const has = (list: string[]) => list.some((t) => tags.includes(t));
  return has(DRINK_TAGS) && !has(DRY_TAGS) ? 'ml' : 'g';
}

/** True when the product carries at least energy or one macro per 100 g. */
export function hasNutrition(food: Pick<Food, 'per100'>): boolean {
  const n = food.per100;
  return n.kcal > 0 || n.protein > 0 || n.carbs > 0 || n.fat > 0;
}

/** Maps an OFF product (from search or product lookup) into our Food shape. Returns null if it is unusable. */
export function mapProduct(p: Raw): Food | null {
  const name =
    str(p.product_name_es) ?? str(p.product_name) ?? str(p.product_name_en) ?? str(p.generic_name_es) ?? str(p.generic_name);
  if (!name) return null;

  const n = (p.nutriments && typeof p.nutriments === 'object' ? p.nutriments : {}) as Raw;
  const protein = num(n.proteins_100g, MAX_G) ?? 0;
  const carbs = num(n.carbohydrates_100g, MAX_G) ?? 0;
  const fat = num(n.fat_100g, MAX_G) ?? 0;
  const per100: Nutrients = {
    kcal: kcalFrom(n) ?? protein * 4 + carbs * 4 + fat * 9,
    protein,
    carbs,
    fat,
  };
  const fiber = num(n.fiber_100g, MAX_G);
  const sugar = num(n.sugars_100g, MAX_G);
  const saturatedFat = num(n['saturated-fat_100g'], MAX_G);
  const salt = num(n.salt_100g, MAX_G);
  if (fiber !== undefined) per100.fiber = fiber;
  if (sugar !== undefined) per100.sugar = sugar;
  if (saturatedFat !== undefined) per100.saturatedFat = saturatedFat;
  if (salt !== undefined) per100.salt = salt;

  const servingSize = num(p.serving_quantity, 5000);
  const servingLabel = str(p.serving_size);

  return {
    name,
    brand: firstBrand(p.brands),
    barcode: str(p.code),
    source: 'off',
    unit: unitFrom(p),
    per100,
    servingSize: servingSize && servingSize > 0 ? servingSize : undefined,
    servingLabel: servingSize && servingSize > 0 ? servingLabel : undefined,
    imageUrl: str(p.image_front_small_url) ?? str(p.image_small_url),
    createdAt: Date.now(),
  };
}

/** An HTTP error status from Open Food Facts. */
class OffHttpError extends OffError {
  constructor(readonly status: number) {
    super(`Open Food Facts respondió ${status}`);
  }
}

async function getJSON(url: string, signal?: AbortSignal, timeoutMs = 12000): Promise<Raw> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : (signal ?? timeout);
  const res = await fetch(url, {
    signal: combined,
    headers: { Accept: 'application/json' },
  });
  if (res.status === 429) throw new OffError('Demasiadas búsquedas seguidas. Espera un minuto y vuelve a intentarlo.');
  if (!res.ok) throw new OffHttpError(res.status);
  return (await res.json()) as Raw;
}

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * Open Food Facts often answers 503 for a moment, and those answers carry no
 * CORS headers, so the browser only reports a failed fetch ("Failed to fetch",
 * "Load failed"). Such quick failures are worth another try. A timeout is not:
 * the user has already waited, and the search button is right there.
 */
function retryable(err: unknown): boolean {
  if (offline()) return false;
  if (err instanceof OffHttpError) return err.status >= 500;
  return err instanceof TypeError || err instanceof SyntaxError;
}

/** Waits between tries; a new search (or leaving the page) cancels the wait. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Waits before the 2nd and 3rd tries. Three tries keep well inside OFF's limit of 10 searches a minute. */
const RETRY_DELAYS = [1000, 2500];

async function withRetries<T>(request: () => Promise<T>, signal?: AbortSignal, attempts = RETRY_DELAYS.length + 1): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await request();
    } catch (err) {
      if (signal?.aborted || i + 1 >= attempts || !retryable(err)) throw err;
      await pause(RETRY_DELAYS[Math.min(i, RETRY_DELAYS.length - 1)], signal);
    }
  }
}

/** What to tell the user once the tries are spent. */
function toOffError(err: unknown): OffError {
  if (err instanceof OffError && !(err instanceof OffHttpError)) return err;
  if (offline()) return new OffError('No hay conexión. Comprueba tu red y vuelve a intentarlo.');
  return new OffError('Open Food Facts no responde ahora mismo. Vuelve a intentarlo en unos segundos.');
}

function host(country: string) {
  return `https://${country === 'world' || !country ? 'world' : country}.openfoodfacts.org`;
}

function mapList(list: unknown): Food[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Food[] = [];
  for (const raw of list) {
    const food = mapProduct(raw as Raw);
    if (!food) continue;
    const key = food.barcode ?? `${food.name}|${food.brand}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(food);
  }
  return out;
}

/**
 * Full-text search on the classic search API, the only Open Food Facts search
 * a browser can call: the newer search service (search.openfoodfacts.org)
 * sends no CORS headers.
 */
export async function searchProducts(query: string, country: string, signal?: AbortSignal): Promise<Food[]> {
  const q = query.trim();
  if (!q) return [];

  const url = new URL(`${host(country)}/cgi/search.pl`);
  url.search = new URLSearchParams({
    search_terms: q,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '30',
    lc: 'es',
    fields: FIELDS,
  }).toString();

  try {
    const data = await withRetries(() => getJSON(url.toString(), signal), signal);
    return mapList(data.products);
  } catch (err) {
    if (signal?.aborted) throw err;
    throw toOffError(err);
  }
}

/**
 * Looks a product up by barcode. Returns null when OFF does not know it.
 * `attempts` is 1 for a lookup the user isn't waiting on.
 */
export async function getProduct(barcode: string, signal?: AbortSignal, attempts?: number): Promise<Food | null> {
  const code = barcode.replace(/\D/g, '');
  if (!code) return null;
  let data: Raw;
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`;
    data = await withRetries(() => getJSON(url, signal), signal, attempts);
  } catch (err) {
    if (signal?.aborted) throw err;
    // A 404 is the API's way of saying "unknown product".
    if (err instanceof OffHttpError && err.status === 404) return null;
    throw toOffError(err);
  }
  if (data.status !== 1 && data.status !== 'success') return null;
  const food = mapProduct({ ...(data.product as Raw), code });
  return food;
}
