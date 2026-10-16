import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FakeSupabase } from './fake-supabase';

// A new version is published while the app is open: the service worker finds
// it, and the page reloads into it once the user has left the app. Each test
// serves its own copy of the build, so "publishing" (changing its sw.js) can't
// disturb other tests. The browser fetches sw.js updates itself, out of
// Playwright's reach, which is why routes can't fake this.

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

let dir: string;
let server: Server;
let origin: string;

/** Serves a private copy of a build (dist: local-only app, dist-cloud: with sign-in). */
async function serve(build: 'dist' | 'dist-cloud') {
  dir = mkdtempSync(join(tmpdir(), 'macros-update-'));
  cpSync(build, dir, { recursive: true });
  server = createServer((req, res) => {
    const path = normalize(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    try {
      const body = readFileSync(join(dir, path));
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}

test.afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

async function open(page: Page, ready: Locator) {
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect(ready).toBeVisible();
  await page.evaluate(() => ((window as unknown as { oldPage: boolean }).oldPage = true));
}

/** Publishes a new version and comes back to the app, which finds it and lets it take over. */
async function publishAndReturn(page: Page) {
  appendFileSync(join(dir, 'sw.js'), '\n// new version\n');
  const tookOver = page.evaluate(
    () => new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })),
  );
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await tookOver;
}

const hide = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });

const isOldPage = (page: Page) => page.evaluate(() => (window as unknown as { oldPage?: boolean }).oldPage === true).catch(() => true);

test('a new version found when coming back loads once the app is left, never while in use', async ({ page }) => {
  await serve('dist');
  await open(page, page.getByRole('button', { name: 'Hoy' }));
  await publishAndReturn(page);
  await page.waitForTimeout(1_000);
  expect(await isOldPage(page)).toBe(true); // nothing on screen is interrupted

  await hide(page);
  await expect.poll(() => isOldPage(page), { timeout: 15_000 }).toBe(false);
  await expect(page.getByRole('button', { name: 'Hoy' })).toBeVisible();
});

test('a failed update download does not stop later updates', async ({ page }) => {
  await serve('dist');
  await open(page, page.getByRole('button', { name: 'Hoy' }));
  // Version 2 can't be fully downloaded (say, the connection drops): its install fails.
  const index = readFileSync(join(dir, 'index.html'));
  rmSync(join(dir, 'index.html'));
  appendFileSync(join(dir, 'sw.js'), '\n// version 2\n');
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {}));
  await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!r && !r.installing && !r.waiting));
  // Version 3 downloads fine and still gets loaded.
  writeFileSync(join(dir, 'index.html'), index);
  await publishAndReturn(page);
  await hide(page);
  await expect.poll(() => isOldPage(page), { timeout: 15_000 }).toBe(false);
});

test('the sign-in screen is never reloaded under the user (e.g. while reading a reset code)', async ({ page }) => {
  await serve('dist-cloud');
  await new FakeSupabase().install(page.context());
  await open(page, page.getByRole('button', { name: 'Entrar', exact: true }));
  await publishAndReturn(page);
  await hide(page); // off to the mail app
  await page.waitForTimeout(1_500);
  expect(await isOldPage(page)).toBe(true);
});
