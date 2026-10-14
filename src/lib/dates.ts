/** Dates are stored as local calendar days (YYYY-MM-DD), never as UTC timestamps. */

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(): string {
  return toISODate(new Date());
}

export function addDays(s: string, n: number): string {
  const d = fromISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Inclusive list of days ending on `end`. */
export function lastNDays(end: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(end, i - n + 1));
}

const longFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const shortFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'narrow' });

export function relativeLabel(s: string, now = today()): string {
  if (s === now) return 'Hoy';
  if (s === addDays(now, -1)) return 'Ayer';
  if (s === addDays(now, 1)) return 'Mañana';
  const label = longFmt.format(fromISODate(s));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function shortLabel(s: string): string {
  return shortFmt.format(fromISODate(s)).replace('.', '');
}

export function weekdayInitial(s: string): string {
  return weekdayFmt.format(fromISODate(s)).toUpperCase();
}
