import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProduct, hasNutrition, mapProduct, searchProducts } from './openfoodfacts';

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
  afterEach(() => vi.unstubAllGlobals());

  it('searches and de-duplicates by barcode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ products: [nutella, nutella, { code: '2' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const results = await searchProducts('nutella', 'es');
    expect(results).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/es\.openfoodfacts\.org\/cgi\/search\.pl\?/);
  });

  it('falls back to the search service when the classic API fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ hits: [nutella] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const results = await searchProducts('nutella', 'es');
    expect(results[0].name).toBe('Nutella crema de cacao');
    expect(String(fetchMock.mock.calls[1][0])).toContain('search.openfoodfacts.org');
    expect(decodeURIComponent(String(fetchMock.mock.calls[1][0]))).toContain('countries_tags:"en:spain"');
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
