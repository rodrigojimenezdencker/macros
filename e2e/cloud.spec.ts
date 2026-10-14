import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { FakeSupabase } from './fake-supabase';
import { field, mockOpenFoodFacts } from './fixtures';

const EMAIL = 'rodrigo@example.com';
const PASSWORD = 'correcto-caballo-bateria';

async function newDevice(browser: Browser, server: FakeSupabase): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await server.install(context);
  const page = await context.newPage();
  await mockOpenFoodFacts(page);
  return { context, page };
}

async function signIn(page: Page, mode: 'Entrar' | 'Crear cuenta' = 'Entrar') {
  await page.goto('/');
  if (mode === 'Crear cuenta') await page.getByRole('radio', { name: 'Crear cuenta' }).click();
  await page.getByLabel('Correo electrónico').fill(EMAIL);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.locator('form').getByRole('button', { name: mode }).click();
  await expect(page.getByRole('button', { name: 'Hoy' })).toBeVisible();
}

async function quickAdd(page: Page, name: string, kcal: string) {
  await page.getByRole('button', { name: 'Opciones de Comida' }).click();
  await page.getByRole('menuitem', { name: 'Añadido rápido' }).click();
  await page.getByLabel('Descripción (opcional)').fill(name);
  await field(page, 'Calorías').fill(kcal);
  await page.getByRole('dialog').getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Comida' }).getByText(name)).toBeVisible();
}

async function syncNow(page: Page) {
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Ajustes' }).click();
  await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await expect(page.getByText(/Sincronizado hace/)).toBeVisible();
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Diario' }).click();
}

test('creating an account and logging food stores it in the account', async ({ browser }) => {
  const server = new FakeSupabase();
  const { page } = await newDevice(browser, server);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Macros' })).toBeVisible();
  await signIn(page, 'Crear cuenta');

  await quickAdd(page, 'Menú del día', '750');
  await expect.poll(() => server.recordsOf(EMAIL).filter((r) => r.kind === 'entry').length, { timeout: 10_000 }).toBe(1);
  const entry = server.recordsOf(EMAIL).find((r) => r.kind === 'entry')!;
  expect(entry.data).toMatchObject({ name: 'Menú del día', nutrients: { kcal: 750 } });
  expect(entry.data).not.toHaveProperty('id');
});

test('a second device signs in and gets the same data; edits flow both ways', async ({ browser }) => {
  const server = new FakeSupabase();
  const a = await newDevice(browser, server);
  await signIn(a.page, 'Crear cuenta');
  await quickAdd(a.page, 'Lentejas', '420');
  await expect.poll(() => server.recordsOf(EMAIL).length, { timeout: 10_000 }).toBeGreaterThan(0);

  const b = await newDevice(browser, server);
  await signIn(b.page);
  await expect(b.page.getByRole('region', { name: 'Comida' }).getByText('Lentejas')).toBeVisible({ timeout: 10_000 });

  // B deletes it; A sees it gone after syncing.
  await b.page.getByRole('region', { name: 'Comida' }).getByRole('button', { name: /Lentejas/ }).click();
  await b.page.getByRole('button', { name: 'Eliminar' }).click();
  await expect.poll(() => server.recordsOf(EMAIL).filter((r) => r.kind === 'entry').length, { timeout: 10_000 }).toBe(0);
  await syncNow(a.page);
  await expect(a.page.getByRole('region', { name: 'Comida' }).getByText('Lentejas')).toHaveCount(0);
});

test('wrong password shows a clear message', async ({ browser }) => {
  const server = new FakeSupabase();
  server.users.push({ id: crypto.randomUUID(), email: EMAIL, password: PASSWORD });
  const { page } = await newDevice(browser, server);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(EMAIL);
  await page.getByLabel('Contraseña').fill('mala');
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');
});

test('signing out clears this device; signing back in restores the data', async ({ browser }) => {
  const server = new FakeSupabase();
  const { page } = await newDevice(browser, server);
  await signIn(page, 'Crear cuenta');
  await quickAdd(page, 'Tortilla', '300');
  await expect.poll(() => server.recordsOf(EMAIL).length, { timeout: 10_000 }).toBeGreaterThan(0);

  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Ajustes' }).click();
  await expect(page.getByText(EMAIL)).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  const local = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('macros');
        req.onsuccess = () => {
          const count = req.result.transaction('entries').objectStore('entries').count();
          count.onsuccess = () => resolve(count.result);
        };
      }),
  );
  expect(local).toBe(0);

  await signIn(page);
  await expect(page.getByRole('region', { name: 'Comida' }).getByText('Tortilla')).toBeVisible({ timeout: 10_000 });
});

test('data saved on this device before accounts existed is uploaded on first sign-in', async ({ browser }) => {
  const server = new FakeSupabase();
  const { page } = await newDevice(browser, server);
  // Recreate the first version's database (Dexie v1 = IndexedDB version 10) with one diary entry.
  await page.goto('/favicon.svg');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('macros', 10);
        req.onupgradeneeded = () => {
          const d = req.result;
          const foods = d.createObjectStore('foods', { keyPath: 'id', autoIncrement: true });
          for (const i of ['name', 'barcode', 'source', 'lastUsedAt']) foods.createIndex(i, i);
          const entries = d.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
          entries.createIndex('date', 'date');
          entries.createIndex('[date+meal]', ['date', 'meal']);
          d.createObjectStore('weights', { keyPath: 'date' });
          d.createObjectStore('settings', { keyPath: 'key' });
        };
        req.onsuccess = () => {
          const today = new Date();
          const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          const tx = req.result.transaction(['entries', 'weights'], 'readwrite');
          tx.objectStore('entries').add({ date: iso, meal: 'lunch', name: 'Paella de antes', amount: 0, nutrients: { kcal: 600, protein: 20, carbs: 70, fat: 25 }, createdAt: 1 });
          tx.objectStore('weights').put({ date: iso, kg: 81.3 });
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );

  await signIn(page, 'Crear cuenta');
  await expect(page.getByRole('region', { name: 'Comida' }).getByText('Paella de antes')).toBeVisible();
  await expect
    .poll(() => server.recordsOf(EMAIL).map((r) => r.kind).sort(), { timeout: 10_000 })
    .toEqual(['entry', 'weight']);
});

test('opens offline with an expired session and syncs when the network returns', async ({ browser }) => {
  const server = new FakeSupabase();
  const { context, page } = await newDevice(browser, server);
  await signIn(page, 'Crear cuenta');
  await quickAdd(page, 'Cocido', '700');
  await expect.poll(() => server.recordsOf(EMAIL).length, { timeout: 10_000 }).toBeGreaterThan(0);

  // An hour later, no signal: the stored access token has expired and refreshing needs the network.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('macros-auth')!);
    s.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem('macros-auth', JSON.stringify(s));
  });
  await context.unroute('https://fake-project.supabase.test/**');
  await context.route('https://fake-project.supabase.test/**', (route) => route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Comida' }).getByText('Cocido')).toBeVisible({ timeout: 10_000 });
  await quickAdd(page, 'Fruta', '90'); // still usable offline

  // Back online: the change made offline reaches the account.
  await context.unroute('https://fake-project.supabase.test/**');
  await server.install(context);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(() => server.recordsOf(EMAIL).filter((r) => r.kind === 'entry').length, { timeout: 20_000 })
    .toBe(2);
});

test('resets a forgotten password with the emailed code', async ({ browser }) => {
  const server = new FakeSupabase();
  server.users.push({ id: crypto.randomUUID(), email: EMAIL, password: 'olvidada-hace-tiempo' });
  const { page } = await newDevice(browser, server);
  await page.goto('/');
  await page.getByRole('button', { name: '¿Has olvidado tu contraseña?' }).click();
  await page.getByLabel('Correo electrónico').fill(EMAIL);
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await page.getByLabel('Código del correo').fill('123456');
  await page.getByRole('button', { name: 'Comprobar código' }).click();
  await expect(page.getByRole('heading', { name: 'Elige una contraseña nueva' })).toBeVisible();
  await page.getByLabel('Contraseña nueva').fill(PASSWORD);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByRole('button', { name: 'Hoy' })).toBeVisible();
  expect(server.users[0].password).toBe(PASSWORD);
});

test('signing up with an address that already has an account says so', async ({ browser }) => {
  const server = new FakeSupabase();
  server.confirmEmail = true;
  server.users.push({ id: crypto.randomUUID(), email: EMAIL, password: PASSWORD });
  const { page } = await newDevice(browser, server);
  await page.goto('/');
  await page.getByRole('radio', { name: 'Crear cuenta' }).click();
  await page.getByLabel('Correo electrónico').fill(EMAIL);
  await page.getByLabel('Contraseña').fill('otra-contraseña-larga');
  await page.locator('form').getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('alert')).toHaveText(/Ya existe una cuenta con ese correo/);
});

test('an expired email link is explained and removed from the address bar', async ({ browser }) => {
  const server = new FakeSupabase();
  const { page } = await newDevice(browser, server);
  await page.goto('/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired#/');
  await expect(page.getByRole('alert')).toHaveText('El enlace ha caducado o ya se usó. Pide uno nuevo.');
  expect(new URL(page.url()).search).toBe('');
});
