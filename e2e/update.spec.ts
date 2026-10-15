import { cpSync, mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// A new version is published while the app is open: the service worker finds
// it, and the page reloads into it without interrupting the user. Each test
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

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'macros-update-'));
  cpSync('dist', dir, { recursive: true });
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
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  const address = server.address();
  origin = `http://localhost:${typeof address === 'object' && address ? address.port : 0}`;
});

test.afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

async function openApp(page: Page) {
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect(page.getByRole('button', { name: 'Hoy' })).toBeVisible();
  await page.evaluate(() => ((window as unknown as { oldPage: boolean }).oldPage = true));
}

const publishNewVersion = () => appendFileSync(join(dir, 'sw.js'), '\n// new version\n');
const isOldPage = (page: Page) => page.evaluate(() => (window as unknown as { oldPage?: boolean }).oldPage === true).catch(() => true);

test('coming back to the app picks up a new version', async ({ page }) => {
  await openApp(page);
  publishNewVersion();
  // Returning to the app (the visibility event) checks for a new version.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => isOldPage(page), { timeout: 15_000 }).toBe(false);
  await expect(page.getByRole('button', { name: 'Hoy' })).toBeVisible();
});

test('a new version found while the app is in use waits until the app is left', async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page);
  await page.waitForTimeout(10_500); // the app has been in use for a while
  publishNewVersion();
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
  await page.waitForFunction(() =>
    navigator.serviceWorker.getRegistration().then((r) => !!r && !r.installing && !r.waiting && r.active?.state === 'activated'),
  );
  await page.waitForTimeout(1_500);
  expect(await isOldPage(page)).toBe(true); // nothing the user is doing gets interrupted

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => isOldPage(page), { timeout: 15_000 }).toBe(false);
});
