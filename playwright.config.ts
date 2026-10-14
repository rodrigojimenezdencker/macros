import { defineConfig, devices } from '@playwright/test';
import { FAKE_SUPABASE_URL } from './e2e/fake-supabase';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
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
  projects: [
    // The app as built without an account backend: local-only, no sign-in.
    { name: 'local', testIgnore: /cloud\.spec\.ts/, use: { baseURL: 'http://localhost:4173' } },
    // The app built against a (fake) Supabase project: sign-in and sync.
    {
      name: 'cloud',
      testMatch: /cloud\.spec\.ts/,
      use: { baseURL: 'http://localhost:4177', serviceWorkers: 'block' },
    },
  ],
  webServer: [
    {
      command: 'npm run build && npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npx vite build --outDir dist-cloud && npx vite preview --outDir dist-cloud --port 4177 --strictPort',
      url: 'http://localhost:4177',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_SUPABASE_URL: FAKE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e' },
    },
  ],
});
