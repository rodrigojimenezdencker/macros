// One-off: renders public/favicon.svg into the PNG icons the PWA manifest needs.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/favicon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
async function render(size, file, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  // Maskable icons need the artwork inside the central safe zone on a full-bleed background.
  const inner = maskable ? svg.replace('rx="112"', 'rx="0"').replace('<g ', '<g transform="translate(51 51) scale(0.8)" ') : svg;
  await page.setContent(`<html><body style="margin:0;background:transparent">${inner.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/${file}`, omitBackground: !maskable, clip: { x: 0, y: 0, width: size, height: size } });
}
await render(192, 'pwa-192.png');
await render(512, 'pwa-512.png');
await render(512, 'pwa-maskable-512.png', { maskable: true });
await render(180, 'apple-touch-icon.png', { maskable: true });
await browser.close();
