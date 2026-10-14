import { useMemo, useSyncExternalStore } from 'react';

/**
 * A tiny hash router. Hash URLs work on any static host (GitHub Pages) and
 * keep the installed app's back gesture meaningful. Each in-app navigation
 * records its depth in history.state so "back" never leaves the app.
 */

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', emit);
  window.addEventListener('hashchange', emit);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export interface Route {
  path: string;
  segments: string[];
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path, segments: path.split('/').filter(Boolean), params: new URLSearchParams(qs) };
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return useMemo(() => parseHash(hash), [hash]);
}

function depth(): number {
  return (window.history.state as { depth?: number } | null)?.depth ?? 0;
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const url = `#${to}`;
  if (opts.replace) window.history.replaceState({ depth: depth() }, '', url);
  else window.history.pushState({ depth: depth() + 1 }, '', url);
  emit();
}

/** Goes back within the app, or to `fallback` if this screen was opened directly. */
export function goBack(fallback = '/') {
  if (depth() > 0) window.history.back();
  else navigate(fallback, { replace: true });
}
