/** Small numeric helpers shared by the platform. */

export const clamp = (x: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, x));

export const round = (x: number, digits = 0): number => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;

export const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);

export const DAY_MS = 24 * 60 * 60 * 1000;

export const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** Joins ["a","b","c"] as "a, b and c". */
export function listJoin(items: readonly string[], conj = 'and'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function uniq<T>(xs: readonly T[]): T[] {
  return Array.from(new Set(xs));
}
