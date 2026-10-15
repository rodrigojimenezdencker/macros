import { expect, test } from '@playwright/test';
import { field, mockOpenFoodFacts } from './fixtures';

test.beforeEach(async ({ page }) => {
  await mockOpenFoodFacts(page);
  await page.goto('/');
});

test('logs a food from Open Food Facts by servings', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Hoy' })).toBeVisible();
  await page.getByRole('region', { name: 'Desayuno' }).getByRole('button', { name: 'Añadir alimento' }).click();
  await expect(page.getByRole('heading', { name: 'Añadir a desayuno' })).toBeVisible();

  await page.getByLabel('Buscar alimento').fill('nutella');
  await page.getByLabel('Buscar alimento').press('Enter');
  await page.getByRole('button', { name: /Nutella/ }).click();

  const sheet = page.getByRole('dialog', { name: 'Nutella' });
  await field(sheet, 'Cantidad').fill('2');
  await expect(sheet.getByText('162')).toBeVisible(); // 30 g × 539 kcal/100 g
  await sheet.getByRole('button', { name: 'Añadir', exact: true }).click();

  const breakfast = page.getByRole('region', { name: 'Desayuno' });
  await expect(breakfast.getByText('Nutella')).toBeVisible();
  await expect(breakfast.getByText('2 porciones · 30 g')).toBeVisible();
  await expect(breakfast.getByText('162 kcal')).toBeVisible();
  await expect(page.getByText('1838')).toBeVisible(); // 2000 − 162 remaining (Spanish doesn't group 4-digit numbers)
});

test('edits an entry and undoes a delete', async ({ page }) => {
  await page.getByRole('region', { name: 'Desayuno' }).getByRole('button', { name: 'Añadir alimento' }).click();
  await page.getByLabel('Buscar alimento').fill('avena');
  await page.getByLabel('Buscar alimento').press('Enter');
  await page.getByRole('button', { name: /Copos de avena/ }).click();
  await field(page, 'Cantidad').fill('50');
  await page.getByRole('dialog').getByRole('button', { name: 'Añadir', exact: true }).click();

  await page.getByRole('region', { name: 'Desayuno' }).getByRole('button', { name: /Copos de avena/ }).click();
  await field(page, 'Cantidad').fill('80');
  await page.getByRole('dialog').getByText('Cena').click();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('region', { name: 'Cena' }).getByText('80 g')).toBeVisible();

  await page.getByRole('region', { name: 'Cena' }).getByRole('button', { name: /Copos de avena/ }).click();
  await page.getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByRole('region', { name: 'Cena' }).getByText('Copos de avena')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.getByRole('region', { name: 'Cena' }).getByText('Copos de avena')).toBeVisible();
});

test('logs milk in glasses and litres and remembers the unit', async ({ page }) => {
  const breakfast = page.getByRole('region', { name: 'Desayuno' });
  await breakfast.getByRole('button', { name: 'Añadir alimento' }).click();
  await page.getByLabel('Buscar alimento').fill('leche');
  await page.getByLabel('Buscar alimento').press('Enter');
  await page.getByRole('button', { name: /Leche semidesnatada/ }).click();

  const sheet = page.getByRole('dialog', { name: 'Leche semidesnatada' });
  await expect(sheet.getByLabel('Unidad')).toHaveValue('serving');
  await sheet.getByLabel('Unidad').selectOption({ label: 'Vaso (250 ml)' });
  await expect(field(sheet, 'Cantidad')).toHaveValue('1'); // one 250 ml serving is one glass
  await sheet.getByRole('button', { name: 'Más' }).click();
  await sheet.getByRole('button', { name: 'Más' }).click();
  await expect(field(sheet, 'Cantidad')).toHaveValue('2');
  await expect(sheet.getByText('kcal en 500 ml')).toBeVisible();
  await expect(sheet.getByText('230', { exact: true })).toBeVisible(); // 500 ml × 46 kcal/100 ml
  await sheet.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(breakfast.getByText('2 vasos · 500 ml')).toBeVisible();
  await expect(breakfast.getByText('230 kcal')).toBeVisible();

  // Found again in a search, it offers the same portion; switch to litres.
  await page.getByRole('region', { name: 'Cena' }).getByRole('button', { name: 'Añadir alimento' }).click();
  await page.getByLabel('Buscar alimento').fill('leche');
  await page.getByLabel('Buscar alimento').press('Enter');
  // Your saved copy is listed first; pick the Open Food Facts result below it.
  await expect(page.getByRole('button', { name: /Leche semidesnatada/ })).toHaveCount(2);
  await page.getByRole('button', { name: /Leche semidesnatada/ }).last().click();
  await expect(sheet.getByLabel('Unidad')).toHaveValue('glass');
  await expect(field(sheet, 'Cantidad')).toHaveValue('2');
  await sheet.getByLabel('Unidad').selectOption({ label: 'Litros (l)' });
  await expect(field(sheet, 'Cantidad')).toHaveValue('0,5');
  await field(sheet, 'Cantidad').fill('0,3');
  await sheet.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Cena' }).getByText('0,3 l')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Cena' }).getByText('138 kcal')).toBeVisible();

  // Editing reopens the entry in the unit it was logged in; grams are flagged as approximate.
  await breakfast.getByRole('button', { name: /Leche semidesnatada/ }).click();
  await expect(sheet.getByLabel('Unidad')).toHaveValue('glass');
  await expect(field(sheet, 'Cantidad')).toHaveValue('2');
  await expect(sheet.getByText(/Aproximado/)).toHaveCount(0);
  await sheet.getByLabel('Unidad').selectOption({ label: 'Gramos (g)' });
  await expect(field(sheet, 'Cantidad')).toHaveValue('500');
  await expect(sheet.getByText('Aproximado: se cuenta 1 ml como 1 g.')).toBeVisible();
  await expect(sheet.getByText('kcal en ≈500 ml')).toBeVisible();
  await sheet.getByLabel('Unidad').selectOption({ label: 'Cucharada (15 ml)' });
  await expect(field(sheet, 'Cantidad')).toHaveValue('1'); // 33,3 cucharadas reads badly: start at one
  await sheet.getByRole('button', { name: 'Guardar' }).click();
  await expect(breakfast.getByText('1 cucharada · 15 ml')).toBeVisible();
});

test('quick add and copy from yesterday', async ({ page }) => {
  await page.getByRole('button', { name: 'Día anterior' }).click();
  await expect(page.getByRole('button', { name: 'Ayer' })).toBeVisible();
  await page.getByRole('button', { name: 'Opciones de Comida' }).click();
  await page.getByRole('menuitem', { name: 'Añadido rápido' }).click();
  await page.getByLabel('Descripción (opcional)').fill('Menú del día');
  await field(page, 'Proteína').fill('40');
  await field(page, 'Carbohidratos').fill('90');
  await field(page, 'Grasas').fill('30');
  await expect(page.getByText('Calculadas a partir de los macros')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Comida' }).getByText('790 kcal')).toBeVisible();

  await page.getByRole('button', { name: 'Día siguiente' }).click();
  await page.getByRole('button', { name: 'Opciones de Comida' }).click();
  await page.getByRole('menuitem', { name: 'Copiar de ayer' }).click();
  await expect(page.getByText('Copiados 1 alimento de ayer')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Comida' }).getByText('Menú del día')).toBeVisible();
});

test('creates a custom food from label values per serving', async ({ page }) => {
  await page.getByRole('button', { name: 'Alimentos' }).click();
  await page.getByRole('button', { name: 'Crear alimento' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Barrita proteica');
  await field(page, 'Tamaño de porción').fill('60');
  await page.getByRole('radio', { name: 'Por porción' }).click();
  await field(page, 'Calorías').fill('210');
  await field(page, 'Proteína').fill('20');
  await field(page, 'Carbohidratos').fill('18');
  await field(page, 'Grasas').fill('7');
  await page.getByRole('button', { name: 'Guardar' }).click();

  await page.getByRole('radio', { name: 'Míos' }).click();
  await page.getByRole('button', { name: /Barrita proteica/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Por 100 g: 350 kcal')).toBeVisible();
  await expect(sheet.getByText('210', { exact: true })).toBeVisible();
});

test('builds a recipe and logs a serving', async ({ page }) => {
  await page.goto('/#/recipe/new');
  await page.getByLabel('Nombre', { exact: true }).fill('Porridge');
  await field(page, 'Porciones').fill('2');
  await page.getByRole('button', { name: 'Añadir ingrediente' }).click();
  await page.getByLabel('Buscar alimento').fill('avena');
  await page.getByLabel('Buscar alimento').press('Enter');
  await page.getByRole('button', { name: /Copos de avena/ }).click();
  await field(page, 'Cantidad').fill('100');
  await page.getByRole('button', { name: 'Añadir ingrediente' }).last().click();

  await page.getByRole('button', { name: 'Añadir ingrediente' }).click();
  await page.getByLabel('Buscar alimento').fill('leche');
  await page.getByLabel('Buscar alimento').press('Enter');
  await page.getByRole('button', { name: /Leche semidesnatada/ }).click();
  await field(page, 'Cantidad').fill('1');
  await page.getByRole('button', { name: 'Añadir ingrediente' }).last().click();

  // (372 + 115) / 2 servings
  await expect(page.getByText('244', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Guardar receta' }).click();

  await page.getByRole('button', { name: 'Diario' }).click();
  await page.getByRole('region', { name: 'Desayuno' }).getByRole('button', { name: 'Añadir alimento' }).click();
  await page.getByRole('radio', { name: 'Recetas' }).click();
  await page.getByRole('button', { name: /Porridge/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Desayuno' }).getByText('244 kcal')).toBeVisible();
});

test('calculates goals and logs weight', async ({ page }) => {
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await field(page, 'Edad').fill('30');
  await field(page, 'Altura').fill('180');
  await field(page, 'Peso').fill('80');
  await expect(page.getByText('2760')).toBeVisible();
  await page.getByRole('button', { name: 'Usar estos objetivos' }).click();
  await expect(field(page, 'Proteína')).toHaveValue('144');

  await page.getByRole('button', { name: 'Diario' }).click();
  await expect(page.getByText('2760').first()).toBeVisible();

  await page.getByRole('button', { name: 'Progreso' }).click();
  await expect(page.getByText('80,0 kg').first()).toBeVisible();
  await field(page, 'Peso').fill('79,4');
  await page.getByLabel('Fecha').fill('2020-01-01');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Peso guardado')).toBeVisible();
});

test('scanning an unknown barcode offers to create the food', async ({ page }) => {
  await page.getByRole('region', { name: 'Snacks' }).getByRole('button', { name: 'Añadir alimento' }).click();
  await page.getByRole('button', { name: 'Escanear código de barras' }).click();
  await page.getByLabel('O escribe el número').fill('1234567890123');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByText('no está en Open Food Facts')).toBeVisible();
  await page.getByRole('button', { name: 'Crear este alimento' }).click();
  await expect(page.getByLabel('Código de barras (opcional)')).toHaveValue('1234567890123');
  await page.getByLabel('Nombre', { exact: true }).fill('Galletas caseras');
  await field(page, 'Calorías').fill('450');
  await page.getByRole('button', { name: 'Guardar' }).click();
  // Back on the add screen with the new food open, ready to log.
  await expect(page.getByRole('dialog', { name: 'Galletas caseras' })).toBeVisible();
});

test('scanning a known barcode opens the product', async ({ page }) => {
  await page.getByRole('region', { name: 'Snacks' }).getByRole('button', { name: 'Añadir alimento' }).click();
  await page.getByRole('button', { name: 'Escanear código de barras' }).click();
  await page.getByLabel('O escribe el número').fill('3017624010701');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Nutella' })).toBeVisible();
});

test('switching sections works when scrollTo returns a Promise (Chrome/Edge 150+)', async ({ page }) => {
  // Guard: the browser under test really has the new scroll behaviour.
  expect(await page.evaluate(() => String(window.scrollTo(0, 0)))).toBe('[object Promise]');
  const tabs = page.getByRole('navigation', { name: 'Secciones' });
  for (const [tab, heading] of [
    ['Alimentos', 'Alimentos'],
    ['Progreso', 'Progreso'],
    ['Ajustes', 'Ajustes'],
  ]) {
    await tabs.getByRole('button', { name: tab }).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
  await tabs.getByRole('button', { name: 'Diario' }).click();
  await expect(page.getByRole('button', { name: 'Hoy' })).toBeVisible();
  await expect(page.getByText('Algo ha fallado')).toHaveCount(0);
});
