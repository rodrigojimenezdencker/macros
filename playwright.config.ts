import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Pixel 7'],
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    launchOptions: {
      ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
      // Newer Chrome/Edge make scrollTo()/scrollIntoView() return a Promise. Test with
      // that behaviour on: an effect that returned it crashed every tab change.
      args: ['--enable-blink-features=ProgrammaticScrollPromise'],
    },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
