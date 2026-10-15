/// <reference types="vite-plugin-pwa/vanillajs" />

/** Short commit of the build (set by vite.config.ts). */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://abcd.supabase.co. Without it the app runs local-only. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable (anon) key: public by design, data is protected by row-level security. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
