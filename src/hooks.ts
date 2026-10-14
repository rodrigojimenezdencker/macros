import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_SETTINGS, getSettings } from './db';
import type { Settings } from './types';

export function useSettings(): Settings {
  return useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS);
}

/** Width of an element, kept current with a ResizeObserver (for responsive SVG charts). */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Parses user-typed numbers, accepting a decimal comma. */
export function parseNumber(s: string): number | undefined {
  if (s.trim() === '') return undefined;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** Number → input text with a decimal comma and no trailing noise. */
export function numberText(n: number | undefined, decimals = 1): string {
  if (n === undefined || !Number.isFinite(n)) return '';
  const f = 10 ** decimals;
  return String(Math.round(n * f) / f).replace('.', ',');
}
