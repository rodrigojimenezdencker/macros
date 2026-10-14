import { expect, test, type Page } from '@playwright/test';
import { field, mockOpenFoodFacts } from './fixtures';

/** Makes every IndexedDB read fail the way Safari does after losing its database connection. */
async function breakIndexedDB(page: Page) {
  await page.evaluate(() => {
    const fail = () => {
      throw new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError');
    };
    for (const proto of [IDBObjectStore.prototype, IDBIndex.prototype] as unknown as Record<string, unknown>[]) {
      for (const m of ['get', 'getAll', 'getAllKeys', 'getKey', 'openCursor', 'openKeyCursor', 'count']) proto[m] = fail;
    }
  });
}

const tabbar = (page: Page) => page.getByRole('navigation', { name: 'Secciones' });

test.beforeEach(async ({ page }) => {
  await mockOpenFoodFacts(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Hoy' })).toBeVisible();
});

test('recovers from a lost database connection instead of going blank', async ({ page }) => {
  await breakIndexedDB(page);
  await tabbar(page).getByRole('button', { name: 'Alimentos' }).click();
  // The app reloads itself once, which reconnects, and lands on the screen that was asked for.
  await expect(page.getByRole('heading', { name: 'Alimentos' })).toBeVisible();
  await expect(tabbar(page)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  // If it breaks again right away, explain instead of reloading in a loop.
  await breakIndexedDB(page);
  await tabbar(page).getByRole('button', { name: 'Progreso' }).click();
  await expect(page.getByText('No se pueden leer tus datos ahora mismo.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Progreso' })).toBeVisible();
  await expect(tabbar(page)).toBeVisible();
});

test('a screen that fails to render shows the error and keeps the app usable', async ({ page }) => {
  await page.evaluate(() => {
    const w = window as unknown as { __format?: PropertyDescriptor };
    w.__format = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, 'format');
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', {
      configurable: true,
      get() {
        throw new RangeError('fallo simulado');
      },
    });
  });
  await tabbar(page).getByRole('button', { name: 'Progreso' }).click();
  await expect(page.getByRole('heading', { name: 'Algo ha fallado' })).toBeVisible();
  await expect(page.getByText('RangeError: fallo simulado', { exact: true })).toBeVisible();
  await expect(tabbar(page)).toBeVisible();
  // The technical details carry the screen, build and stack, to locate the bug.
  await page.getByText('Detalles técnicos').click();
  const details = page.locator('.crash-more .crash-detail');
  await expect(details).toContainText('Pantalla: #/progress');
  await expect(details).toContainText('Versión: local');
  await expect(details).toContainText(/index-[\w-]+\.js:\d+:\d+/);

  await page.evaluate(() => {
    const w = window as unknown as { __format: PropertyDescriptor };
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', w.__format);
  });
  await tabbar(page).getByRole('button', { name: 'Ajustes' }).click();
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible();
});

test('nested sheets close one at a time and always release page scrolling', async ({ page }) => {
  const overflow = () => page.evaluate(() => document.body.style.overflow);
  await page.goto('/#/recipe/new');
  await page.getByRole('button', { name: 'Añadir ingrediente' }).click();
  await page.getByRole('button', { name: 'Escanear código de barras' }).click();
  await expect(page.getByRole('dialog', { name: 'Escanear código de barras' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Escanear código de barras' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Añadir ingrediente' })).toBeVisible();
  expect(await overflow()).toBe('hidden');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await overflow()).toBe('');

  // Leaving the screen (back gesture) with both sheets open must not leave scrolling locked.
  await page.getByRole('button', { name: 'Añadir ingrediente' }).click();
  await page.getByRole('button', { name: 'Escanear código de barras' }).click();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Hoy' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await overflow()).toBe('');
});

test('importing a damaged backup skips the bad rows and nothing breaks', async ({ page }) => {
  const backup = {
    app: 'macros',
    version: 1,
    exportedAt: '2026-10-14T00:00:00.000Z',
    foods: [
      { id: 1, name: 'Pan de centeno', source: 'custom', unit: 'g', per100: { kcal: 250, protein: 8, carbs: 48, fat: 2 }, createdAt: 1 },
      { id: 2, name: null, source: 'custom', unit: 'g', per100: {}, createdAt: 1 },
    ],
    entries: [{ id: 1, date: 'abc', meal: 'lunch', name: 'x', amount: 1, createdAt: 1 }],
    weights: [{ date: '2026-10-01', kg: null }],
    settings: { goals: { kcal: 2100, protein: 150, carbs: 200, fat: 77 }, profile: { activity: 'nope' }, offCountry: 'es' },
  };
  page.on('dialog', (d) => void d.accept());
  await tabbar(page).getByRole('button', { name: 'Ajustes' }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'macros.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByText('Copia restaurada (3 registros omitidos)')).toBeVisible();

  await tabbar(page).getByRole('button', { name: 'Alimentos' }).click();
  await page.getByRole('radio', { name: 'Míos' }).click();
  await expect(page.getByRole('button', { name: /Pan de centeno/ })).toBeVisible();
  await tabbar(page).getByRole('button', { name: 'Progreso' }).click();
  await expect(page.getByText('objetivo 2100 kcal')).toBeVisible();
  await tabbar(page).getByRole('button', { name: 'Ajustes' }).click();
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible();
});

test('re-tapping the tab of a failed screen tries it again', async ({ page }) => {
  await page.evaluate(() => {
    const w = window as unknown as { __format?: PropertyDescriptor };
    w.__format = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, 'format');
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', {
      configurable: true,
      get() {
        throw new RangeError('fallo simulado');
      },
    });
  });
  await tabbar(page).getByRole('button', { name: 'Progreso' }).click();
  await expect(page.getByRole('heading', { name: 'Algo ha fallado' })).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { __format: PropertyDescriptor };
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', w.__format);
  });
  await tabbar(page).getByRole('button', { name: 'Progreso' }).click();
  await expect(page.getByRole('heading', { name: 'Progreso' })).toBeVisible();
});

test('one-off reads and failed saves also recover instead of failing silently', async ({ page }) => {
  // A screen that loads with a one-off read (editing a food).
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('macros');
        req.onsuccess = () => {
          const tx = req.result.transaction('foods', 'readwrite');
          tx.objectStore('foods').put({ id: 7, name: 'Hummus', source: 'custom', unit: 'g', per100: { kcal: 166, protein: 8, carbs: 14, fat: 10 }, createdAt: 1 });
          tx.oncomplete = () => resolve();
        };
      }),
  );
  await breakIndexedDB(page);
  await page.evaluate(() => (window.location.hash = '#/food/7'));
  await expect(field(page, 'Nombre')).toHaveValue('Hummus'); // after the automatic reload

  // A write from a button: the failure triggers recovery too (here: the banner, as we just reloaded).
  await page.evaluate(() => {
    const fail = () => {
      throw new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError');
    };
    for (const m of ['add', 'put', 'delete']) (IDBObjectStore.prototype as unknown as Record<string, unknown>)[m] = fail;
  });
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('No se pueden leer tus datos ahora mismo.')).toBeVisible();
});
