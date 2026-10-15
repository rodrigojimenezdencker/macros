import type { Food, Nutrients, Unit } from '../types';

/**
 * Open Food Facts client. OFF is a free, open database with CORS enabled, so
 * the browser talks to it directly. Its limits per IP address are 15 product
 * reads and 10 searches a minute, so we search on submit, never on every
 * keystroke. On top of that, OFF's proxy lets through at most 600 anonymous
 * searches a minute from everyone in the world together, and answers the rest
 * with an instant 503: that, not the user's connection, is why search often
 * fails (see openfoodfacts-infrastructure, confs/scaleway-proxy/nginx).
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

/**
 * fetch + JSON with a time limit. Built by hand: AbortSignal.timeout (iOS 16)
 * and AbortSignal.any (iOS 17.4) are too new for older iPhones. The timeout
 * aborts with a TimeoutError, which is never retried.
 */
async function getJSON(url: string, signal?: AbortSignal, timeoutMs = 12000): Promise<Raw> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException('Open Food Facts tardó demasiado.', 'TimeoutError')), timeoutMs);
  const onAbort = () => ctl.abort(signal!.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (res.status === 429) throw new OffError('Demasiadas búsquedas seguidas. Espera un minuto y vuelve a intentarlo.');
    if (!res.ok) throw new OffHttpError(res.status);
    return (await res.json()) as Raw;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * OFF's 503s carry no CORS headers, so the browser only reports a failed fetch
 * ("Failed to fetch", "Load failed"). Such quick failures are worth another
 * try. A timeout is not: the user has already waited, and the search button is
 * right there. Nor is a 429: OFF bans an IP for a day after 12 of those in an
 * hour (fail2ban counts 401/403/429, not 503).
 */
function retryable(err: unknown): boolean {
  if (offline()) return false;
  if (err instanceof OffHttpError) return err.status >= 500;
  return err instanceof TypeError || err instanceof SyntaxError;
}

/** Waits between tries; a new search, or leaving the picker, cancels the wait. */
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

/**
 * Waits before each new try, growing and with random jitter as OFF asks. The
 * global search limit turns away whichever searches arrive too close to
 * someone else's, so a few tries spread over seconds almost always get one
 * through. Turned-away tries cost OFF nothing (its proxy refuses them before
 * any search work) and don't count towards the per-IP limits.
 */
const RETRY_DELAYS = [500, 1000, 2000, 4000, 4000];
const SEARCH_ATTEMPTS = RETRY_DELAYS.length + 1;
const PRODUCT_ATTEMPTS = 3;

/** ±30 %, so many users' retries don't land at the same moment. */
const jitter = (ms: number) => Math.round(ms * (0.7 + Math.random() * 0.6));

/** Told before each new try: "Reintentando (2 de 6)…". */
export type OnRetry = (attempt: number, of: number) => void;

async function withRetries<T>(
  request: () => Promise<T>,
  signal: AbortSignal | undefined,
  attempts: number,
  onRetry?: OnRetry,
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await request();
    } catch (err) {
      if (signal?.aborted || i + 1 >= attempts || !retryable(err)) throw err;
      onRetry?.(i + 2, attempts);
      await pause(jitter(RETRY_DELAYS[Math.min(i, RETRY_DELAYS.length - 1)]), signal);
    }
  }
}

export const SEARCH_BUSY = 'Open Food Facts está saturado ahora mismo. Vuelve a intentarlo en un momento.';
const PRODUCT_BUSY = 'Open Food Facts no responde ahora mismo. Vuelve a intentarlo en unos segundos.';

/** What to tell the user once the tries are spent. */
function toOffError(err: unknown, busy: string): OffError {
  if (err instanceof OffError && !(err instanceof OffHttpError)) return err;
  if (offline()) return new OffError('No hay conexión. Comprueba tu red y vuelve a intentarlo.');
  return new OffError(busy);
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
export async function searchProducts(query: string, country: string, signal?: AbortSignal, onRetry?: OnRetry): Promise<Food[]> {
  const q = query.trim();
  if (!q) return [];
  const key = `${country}|${q.toLowerCase().replace(/\s+/g, ' ')}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < RECENT_MS) return hit.foods.slice();

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
    const data = await withRetries(() => getJSON(url.toString(), signal), signal, SEARCH_ATTEMPTS, onRetry);
    const foods = mapList(data.products);
    remember(key, foods);
    return foods.slice();
  } catch (err) {
    if (signal?.aborted) throw err;
    throw toOffError(err, SEARCH_BUSY);
  }
}

/** Recent results: searching the same thing again is instant and needs no luck with OFF's limit. */
const recent = new Map<string, { at: number; foods: Food[] }>();
const RECENT_MS = 30 * 60_000;
const RECENT_MAX = 30;

function remember(key: string, foods: Food[]) {
  recent.delete(key);
  recent.set(key, { at: Date.now(), foods });
  if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value!);
}

/** For tests. */
export function forgetRecentSearches() {
  recent.clear();
}

/**
 * Looks a product up by barcode. Returns null when OFF does not know it.
 * `attempts` is 1 for a lookup the user isn't waiting on.
 */
export async function getProduct(barcode: string, signal?: AbortSignal, attempts = PRODUCT_ATTEMPTS): Promise<Food | null> {
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
    throw toOffError(err, PRODUCT_BUSY);
  }
  if (data.status !== 1 && data.status !== 'success') return null;
  const food = mapProduct({ ...(data.product as Raw), code });
  return food;
}
