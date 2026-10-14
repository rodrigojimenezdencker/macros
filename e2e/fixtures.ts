import type { Locator, Page } from '@playwright/test';

export const nutella = {
  code: '3017624010701',
  product_name: 'Nutella',
  product_name_es: 'Nutella',
  brands: 'Ferrero',
  serving_size: '15 g',
  serving_quantity: 15,
  product_quantity_unit: 'g',
  nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9, sugars_100g: 56.3 },
};

export const oats = {
  code: '8480000101011',
  product_name: 'Copos de avena',
  brands: 'Hacendado',
  product_quantity_unit: 'g',
  nutriments: { 'energy-kcal_100g': 372, proteins_100g: 13.5, carbohydrates_100g: 58.7, fat_100g: 7, fiber_100g: 10 },
};

export const milk = {
  code: '8410000000001',
  product_name: 'Leche semidesnatada',
  brands: 'Central Lechera',
  product_quantity_unit: 'ml',
  serving_size: '250 ml',
  serving_quantity: 250,
  nutriments: { 'energy-kcal_100g': 46, proteins_100g: 3.1, carbohydrates_100g: 4.7, fat_100g: 1.6 },
};

/** Stands in for Open Food Facts so tests never touch the network. */
export async function mockOpenFoodFacts(page: Page) {
  await page.route(/openfoodfacts\.org\/cgi\/search\.pl/, async (route) => {
    const q = new URL(route.request().url()).searchParams.get('search_terms')?.toLowerCase() ?? '';
    const all = [nutella, oats, milk];
    const products = all.filter((p) => `${p.product_name} ${p.brands}`.toLowerCase().includes(q));
    await route.fulfill({ json: { count: products.length, products } });
  });
  await page.route(/openfoodfacts\.org\/api\/v2\/product\/(\d+)/, async (route) => {
    const code = /product\/(\d+)/.exec(route.request().url())![1];
    const product = [nutella, oats, milk].find((p) => p.code === code);
    await route.fulfill(product ? { json: { status: 1, product } } : { status: 404, json: { status: 0 } });
  });
  await page.route(/images\.openfoodfacts\.org/, (route) => route.abort());
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A text field by its label; the unit suffix ("g", "kcal") and hint are part of the accessible name. */
export function field(scope: Page | Locator, label: string) {
  return scope.getByRole('textbox', { name: new RegExp(`^${escape(label)}(?: (?:g|ml|kcal|kg|cm|años|×|%)(?: |$)|$)`) });
}
