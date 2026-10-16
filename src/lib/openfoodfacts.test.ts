import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetRecentSearches, getProduct, hasNutrition, mapProduct, OffError, SEARCH_BUSY, searchProducts } from './openfoodfacts';

const nutella = {
  code: '3017624010701',
  product_name: 'Nutella',
  product_name_es: 'Nutella crema de cacao',
  brands: 'Ferrero, Nutella',
  serving_size: '15 g',
  serving_quantity: '15',
  product_quantity_unit: 'g',
  image_front_small_url: 'https://images.openfoodfacts.org/x.jpg',
  nutriments: {
    'energy-kcal_100g': 539,
    proteins_100g: 6.3,
    carbohydrates_100g: 57.5,
    fat_100g: 30.9,
    'saturated-fat_100g': 10.6,
    sugars_100g: 56.3,
    salt_100g: 0.107,
  },
};

describe('mapProduct', () => {
  it('maps an Open Food Facts product', () => {
    const food = mapProduct(nutella)!;
    expect(food).toMatchObject({
      name: 'Nutella crema de cacao',
      brand: 'Ferrero',
      barcode: '3017624010701',
      source: 'off',
      unit: 'g',
      servingSize: 15,
      servingLabel: '15 g',
      per100: { kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9, saturatedFat: 10.6, sugar: 56.3, salt: 0.107 },
    });
    expect(food.per100).not.toHaveProperty('fiber');
  });

  it('converts kJ when kcal is missing and reads string numbers', () => {
    const food = mapProduct({ product_name: 'Zumo', quantity: '1 L', nutriments: { energy_100g: '418,4', proteins_100g: '0.5' } })!;
    expect(food.per100.kcal).toBeCloseTo(100);
    expect(food.per100.protein).toBe(0.5);
    expect(food.unit).toBe('ml');
  });

  it('tells drinks (per 100 ml) from solids (per 100 g)', () => {
    const unit = (p: Record<string, unknown>) => mapProduct({ product_name: 'x', ...p })!.unit;
    expect(unit({ product_quantity_unit: 'ml' })).toBe('ml');
    expect(unit({ product_quantity_unit: 'l' })).toBe('ml');
    expect(unit({ product_quantity_unit: 'g', categories_tags: ['en:beverages'] })).toBe('g');
    expect(unit({ quantity: '6 x 200 ml' })).toBe('ml');
    expect(unit({ quantity: '1 litro' })).toBe('ml');
    expect(unit({ quantity: '33cl' })).toBe('ml');
    expect(unit({ quantity: '500 g', serving_size: '250 ml' })).toBe('g');
    expect(unit({ quantity: '6 bricks', serving_size: '1 vaso (250 ml)' })).toBe('ml');
    expect(unit({ serving_quantity_unit: 'ml' })).toBe('ml');
    expect(unit({ serving_size: '30 g', categories_tags: ['en:beverages'] })).toBe('g');
    // The first unit named decides, and accents don't end a unit.
    expect(unit({ serving_size: '30 g + 125 ml de leche semidesnatada' })).toBe('g');
    expect(unit({ serving_size: '1 vaso de 200 ml (aprox. 206 g)' })).toBe('ml');
    expect(unit({ quantity: '1 paquete', serving_size: '1 lámina (25 g)' })).toBe('g');
    // No size anywhere: the category decides, but drink powders stay in grams.
    expect(unit({ categories_tags: ['en:dairies', 'en:milks'] })).toBe('ml');
    expect(unit({ categories_tags: ['en:beverages', 'en:plant-based-milks'] })).toBe('ml');
    expect(unit({ categories_tags: ['en:beverages', 'en:instant-beverages'] })).toBe('g');
    expect(unit({ product_quantity_unit: 'unit', categories_tags: ['en:juices'] })).toBe('ml');
    expect(unit({})).toBe('g');
  });

  it('accepts brands as an array (search service format)', () => {
    expect(mapProduct({ product_name: 'Leche', brands: ['Hacendado'] })!.brand).toBe('Hacendado');
  });

  it('ignores impossible per-100 g values from bad database entries', () => {
    const food = mapProduct({ product_name: 'Error', nutriments: { 'energy-kcal_100g': 1e30, proteins_100g: 250, fat_100g: 12 } })!;
    expect(food.per100.protein).toBe(0);
    expect(food.per100.kcal).toBe(108); // recomputed from the plausible macros
  });

  it('drops products without a name and flags missing nutrition', () => {
    expect(mapProduct({ code: '1', nutriments: {} })).toBeNull();
    expect(hasNutrition(mapProduct({ product_name: 'Misterio' })!)).toBe(false);
  });
});

describe('network', () => {
  beforeEach(() => {
    forgetRecentSearches();
    // No jitter, so the waits are exact: 0.5 s, 1 s, 2 s, 4 s, 4 s.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('searches and de-duplicates by barcode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ products: [nutella, nutella, { code: '2' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const results = await searchProducts('nutella', 'es');
    expect(results).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/es\.openfoodfacts\.org\/cgi\/search\.pl\?/);
  });

  it('never calls the newer search service, which browsers cannot reach (no CORS headers)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ products: [nutella] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await searchProducts('nutella', 'world');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/world\.openfoodfacts\.org\/cgi\/search\.pl\?/);
  });

  it('retries the momentary failures Open Food Facts often has', async () => {
    vi.useFakeTimers();
    const ok = () => new Response(JSON.stringify({ products: [nutella] }), { status: 200 });
    // A 503 without CORS headers reaches the page as a failed fetch.
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);
    const onRetry = vi.fn();
    const search = searchProducts('nutella', 'es', undefined, onRetry);
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(1); // waits a moment before trying again
    expect(onRetry).toHaveBeenLastCalledWith(2, 6);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(2); // and a little longer each time
    await vi.advanceTimersByTimeAsync(1);
    expect((await search)[0].name).toBe('Nutella crema de cacao');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls).toEqual([
      [2, 6],
      [3, 6],
    ]);
  });

  it('spreads the waits randomly, so many users do not retry in step', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(new Response(JSON.stringify({ products: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Math, 'random').mockReturnValue(0); // the shortest wait: 70 % of 0,5 s
    const search = searchProducts('leche', 'es');
    await vi.advanceTimersByTimeAsync(349);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await search;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after six tries and says Open Food Facts is busy, not your connection', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const search = searchProducts('nutella', 'es');
    const failed = expect(search).rejects.toThrow(SEARCH_BUSY);
    await vi.advanceTimersByTimeAsync(11_499);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
    await failed;
    await expect(search).rejects.toBeInstanceOf(OffError);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(SEARCH_BUSY).not.toMatch(/conexión/);
  });

  it('remembers recent results, so the same search again needs no luck with OFF', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ products: [nutella] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const first = await searchProducts('Nutella', 'es');
    expect(await searchProducts('  nutella ', 'es')).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A copy each time: a caller changing its list can't change what is remembered.
    (await searchProducts('nutella', 'es')).length = 0;
    expect(await searchProducts('nutella', 'es')).toHaveLength(1);
    await searchProducts('nutella', 'world'); // other country, other results
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(30 * 60_000); // half an hour later, ask again
    await searchProducts('nutella', 'es');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry slow failures, which a weak signal produces (only OFF\'s quick rejections)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      () => new Promise<Response>((_, reject) => setTimeout(() => reject(new TypeError('Load failed')), 10_000)),
    );
    vi.stubGlobal('fetch', fetchMock);
    const search = searchProducts('nutella', 'es');
    const failed = expect(search).rejects.toThrow(SEARCH_BUSY);
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks again after an empty answer, which may be a hiccup on OFF\'s side', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ products: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await searchProducts('zzz', 'es')).toEqual([]);
    await searchProducts('zzz', 'es');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not remember failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ products: [nutella] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchProducts('nutella', 'es')).rejects.toThrow('Demasiadas búsquedas seguidas');
    expect(await searchProducts('nutella', 'es')).toHaveLength(1);
  });

  it('does not retry what another try cannot fix', async () => {
    const tooMany = vi.fn().mockResolvedValue(new Response('slow down', { status: 429 }));
    vi.stubGlobal('fetch', tooMany);
    await expect(searchProducts('nutella', 'es')).rejects.toThrow('Demasiadas búsquedas seguidas');
    expect(tooMany).toHaveBeenCalledTimes(1);

    const timedOut = vi.fn().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    vi.stubGlobal('fetch', timedOut);
    await expect(searchProducts('nutella', 'es')).rejects.toThrow(SEARCH_BUSY);
    expect(timedOut).toHaveBeenCalledTimes(1);

    vi.stubGlobal('navigator', { onLine: false });
    const offline = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', offline);
    await expect(searchProducts('nutella', 'es')).rejects.toThrow('No hay conexión');
    expect(offline).toHaveBeenCalledTimes(1);
  });

  it('a new search cancels the wait between tries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const ctrl = new AbortController();
    const search = searchProducts('nutella', 'es', ctrl.signal);
    const aborted = expect(search).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(300);
    ctrl.abort();
    await aborted;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('times out on browsers without AbortSignal.timeout/any (older iPhones), and does not retry it', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('AbortSignal', Object.assign(function () {}, { prototype: AbortSignal.prototype }));
    // A request OFF never answers: it only ends when its signal aborts.
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))),
    );
    vi.stubGlobal('fetch', fetchMock);
    const search = searchProducts('nutella', 'es', new AbortController().signal);
    const failed = expect(search).rejects.toThrow(SEARCH_BUSY);
    await vi.advanceTimersByTimeAsync(12_000);
    await failed;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The caller can still cancel it.
    const ctrl = new AbortController();
    const cancelled = searchProducts('nutella', 'es', ctrl.signal);
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);
    ctrl.abort();
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a barcode lookup, but an unknown product is just unknown', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 0 }), { status: 404 }))
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 1, product: nutella }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getProduct('0000000000000')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const lookup = getProduct('3017624010701');
    await vi.advanceTimersByTimeAsync(5000);
    expect((await lookup)?.name).toBe('Nutella crema de cacao');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('looks a barcode up and returns null for unknown products', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: 1, product: nutella }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: 0 }), { status: 404 })),
    );
    expect((await getProduct('3017624010701'))?.name).toBe('Nutella crema de cacao');
    expect(await getProduct('0000000000000')).toBeNull();
  });
});
