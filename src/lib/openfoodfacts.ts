import type { Food, Nutrients, Unit } from '../types';

/**
 * Open Food Facts client. OFF is a free, open database with CORS enabled, so
 * the browser talks to it directly. Their limits are generous for one person
 * (100 product reads/min, 10 searches/min), so we search on submit, never on
 * every keystroke.
 */

export const OFF_COUNTRIES: { id: string; label: string; tag?: string }[] = [
  { id: 'world', label: 'Todo el mundo' },
  { id: 'es', label: 'España', tag: 'en:spain' },
  { id: 'mx', label: 'México', tag: 'en:mexico' },
  { id: 'ar', label: 'Argentina', tag: 'en:argentina' },
  { id: 'co', label: 'Colombia', tag: 'en:colombia' },
  { id: 'cl', label: 'Chile', tag: 'en:chile' },
  { id: 'pe', label: 'Perú', tag: 'en:peru' },
  { id: 'us', label: 'Estados Unidos', tag: 'en:united-states' },
  { id: 'uk', label: 'Reino Unido', tag: 'en:united-kingdom' },
  { id: 'fr', label: 'Francia', tag: 'en:france' },
  { id: 'it', label: 'Italia', tag: 'en:italy' },
  { id: 'de', label: 'Alemania', tag: 'en:germany' },
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
const VOLUME_TEXT = /\d\s*(ml|cl|dl|l|litros?|fl\.? ?oz)\b/i;
const WEIGHT_TEXT = /\d\s*(mg|g|gr|grs|gramos?|kg|kilos?|oz|lbs?)\b/i;
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
    const text = str(field) ?? '';
    if (VOLUME_TEXT.test(text)) return 'ml';
    if (WEIGHT_TEXT.test(text)) return 'g';
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

async function getJSON(url: string, signal?: AbortSignal, timeoutMs = 12000): Promise<Raw> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : (signal ?? timeout);
  const res = await fetch(url, {
    signal: combined,
    headers: { Accept: 'application/json' },
  });
  if (res.status === 429) throw new OffError('Demasiadas búsquedas seguidas. Espera un minuto y vuelve a intentarlo.');
  if (!res.ok) throw new OffError(`Open Food Facts respondió ${res.status}`);
  return (await res.json()) as Raw;
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

/** Full-text search. Tries the classic search API, then the newer search service. */
export async function searchProducts(query: string, country: string, signal?: AbortSignal): Promise<Food[]> {
  const q = query.trim();
  if (!q) return [];

  const classic = new URL(`${host(country)}/cgi/search.pl`);
  classic.search = new URLSearchParams({
    search_terms: q,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '30',
    lc: 'es',
    fields: FIELDS,
  }).toString();

  try {
    const data = await getJSON(classic.toString(), signal);
    return mapList(data.products);
  } catch (err) {
    if (signal?.aborted) throw err;
    const tag = OFF_COUNTRIES.find((c) => c.id === country)?.tag;
    const modern = new URL('https://search.openfoodfacts.org/search');
    modern.search = new URLSearchParams({
      q: tag ? `${q} countries_tags:"${tag}"` : q,
      page_size: '30',
      langs: 'es,en',
      fields: FIELDS,
    }).toString();
    try {
      const data = await getJSON(modern.toString(), signal);
      return mapList(data.hits ?? data.products);
    } catch {
      throw err instanceof OffError ? err : new OffError('No se pudo conectar con Open Food Facts. ¿Tienes conexión?');
    }
  }
}

/** Looks a product up by barcode. Returns null when OFF does not know it. */
export async function getProduct(barcode: string, signal?: AbortSignal): Promise<Food | null> {
  const code = barcode.replace(/\D/g, '');
  if (!code) return null;
  let data: Raw;
  try {
    data = await getJSON(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`, signal);
  } catch (err) {
    // A 404 is the API's way of saying "unknown product".
    if (err instanceof OffError && /404/.test(err.message)) return null;
    if (err instanceof OffError) throw err;
    if (signal?.aborted) throw err;
    throw new OffError('No se pudo conectar con Open Food Facts. ¿Tienes conexión?');
  }
  if (data.status !== 1 && data.status !== 'success') return null;
  const food = mapProduct({ ...(data.product as Raw), code });
  return food;
}
