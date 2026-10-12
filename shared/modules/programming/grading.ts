/**
 * Test grading + value formatting for the debugging module.
 *
 * Contains NO scenario data, so it is safe to import at runtime from the client
 * (the Web Worker) as well as from the server-side bot. Both sides therefore
 * grade identically: deep equality with a numeric tolerance of 1e-6.
 */

import type { ExecResult } from '../../types.ts';
import type { CategoryOption, DiagnosisCategory, TestCase, TestResult } from './types.ts';

export const NUMERIC_TOLERANCE = 1e-6;
export const MAX_LOGS = 50;
export const MAX_LOG_CHARS = 300;
export const MAX_VALUE_CHARS = 500;

export const DIAGNOSIS_CATEGORIES: CategoryOption[] = [
  { id: 'off_by_one', label: 'Off-by-one / boundary' },
  { id: 'wrong_operator', label: 'Wrong comparison or logical operator' },
  { id: 'wrong_initial_value', label: 'Wrong initial value' },
  { id: 'wrong_variable', label: 'Wrong variable or property' },
  { id: 'missing_edge_case', label: 'Unhandled edge case' },
  { id: 'mutation', label: 'Unintended mutation' },
  { id: 'type_coercion', label: 'Type / coercion problem' },
  { id: 'missing_return', label: 'Missing return' },
];

export const CATEGORY_LABELS = Object.fromEntries(DIAGNOSIS_CATEGORIES.map((c) => [c.id, c.label])) as Record<
  DiagnosisCategory,
  string
>;

export function isCategory(x: unknown): x is DiagnosisCategory {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, x);
}

const tagOf = (v: unknown): string => Object.prototype.toString.call(v);

/** Deep equality (arrays, plain objects, primitives) with numeric tolerance; NaN equals NaN. Cross-realm safe. */
export function deepEqual(actual: unknown, expected: unknown, tol = NUMERIC_TOLERANCE, depth = 0): boolean {
  if (depth > 60) return false;
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Number.isNaN(actual) || Number.isNaN(expected)) return Number.isNaN(actual) && Number.isNaN(expected);
    if (actual === expected) return true;
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
    return Math.abs(actual - expected) <= tol;
  }
  if (actual === expected) return true;
  if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') return false;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    for (let i = 0; i < expected.length; i++) {
      if (!deepEqual(actual[i], expected[i], tol, depth + 1)) return false;
    }
    return true;
  }
  if (Array.isArray(actual)) return false;
  if (tagOf(actual) !== '[object Object]' || tagOf(expected) !== '[object Object]') return false;
  try {
    const a = actual as Record<string, unknown>;
    const e = expected as Record<string, unknown>;
    const ka = Object.keys(a);
    const ke = Object.keys(e);
    if (ka.length !== ke.length) return false;
    for (const k of ke) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) return false;
      if (!deepEqual(a[k], e[k], tol, depth + 1)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function quote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function fmt(v: unknown, depth: number, seen: unknown[]): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'undefined':
      return 'undefined';
    case 'number':
      return Object.is(v, -0) ? '0' : String(v);
    case 'bigint':
      return `${v}n`;
    case 'boolean':
      return String(v);
    case 'string':
      return quote(v);
    case 'symbol':
      return v.toString();
    case 'function':
      return `[Function${v.name ? `: ${v.name}` : ' (anonymous)'}]`;
    default:
      break;
  }
  if (seen.includes(v)) return '[Circular]';
  try {
    if (Array.isArray(v)) {
      if (depth >= 4) return '[Array]';
      seen.push(v);
      const n = Math.min(v.length, 50);
      const items: string[] = [];
      for (let i = 0; i < n; i++) items.push(i in v ? fmt(v[i], depth + 1, seen) : '<empty>');
      if (v.length > n) items.push(`… ${v.length - n} more`);
      seen.pop();
      return `[${items.join(', ')}]`;
    }
    const tag = tagOf(v);
    if (tag === '[object Date]') {
      const d = v as Date;
      return Number.isNaN(d.getTime()) ? 'Invalid Date' : d.toISOString();
    }
    if (tag === '[object Error]') {
      const e = v as Error;
      return `${e.name}: ${e.message}`;
    }
    if (tag === '[object Map]') return `Map(${(v as Map<unknown, unknown>).size})`;
    if (tag === '[object Set]') return `Set(${(v as Set<unknown>).size})`;
    if (tag === '[object RegExp]') return String(v);
    if (depth >= 4) return '[Object]';
    seen.push(v);
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj);
    const parts = keys
      .slice(0, 30)
      .map((k) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k)}: ${fmt(obj[k], depth + 1, seen)}`);
    if (keys.length > 30) parts.push(`… ${keys.length - 30} more`);
    seen.pop();
    let ctor = '';
    try {
      const c = (obj as { constructor?: { name?: unknown } }).constructor;
      ctor = c && typeof c.name === 'string' && c.name !== 'Object' ? `${c.name} ` : '';
    } catch {
      ctor = '';
    }
    return parts.length ? `${ctor}{ ${parts.join(', ')} }` : `${ctor}{}`;
  } catch {
    return '[Unprintable]';
  }
}

/** Display string for a JS value, e.g. NaN, undefined, [1, 2], { a: 1 }, 'text'. */
export function formatValue(value: unknown, maxLen = MAX_VALUE_CHARS): string {
  return clip(fmt(value, 0, []), maxLen);
}

/** console.log-style formatting: strings raw, everything else via formatValue. */
export function formatLogArgs(args: readonly unknown[]): string {
  return clip(args.map((a) => (typeof a === 'string' ? a : formatValue(a, 200))).join(' '), MAX_LOG_CHARS);
}

export function clipLogs(logs: unknown): string[] {
  if (!Array.isArray(logs)) return [];
  const out = logs.slice(0, MAX_LOGS).map((l) => clip(String(l), MAX_LOG_CHARS));
  if (logs.length > MAX_LOGS) out.push(`… ${logs.length - MAX_LOGS} more log lines`);
  return out;
}

/** Turns one execution result into a graded test result. */
export function gradeTest(test: TestCase, exec: ExecResult | undefined): TestResult {
  const logs = clipLogs(exec?.logs ?? []);
  if (!exec) return { id: test.id, pass: false, actual: '', error: 'Test did not run', logs };
  if (exec.timedOut) {
    return { id: test.id, pass: false, actual: '', error: 'Timed out (possible infinite loop)', logs, timedOut: true };
  }
  if (!exec.ok) return { id: test.id, pass: false, actual: '', error: clip(exec.error ?? 'Error', MAX_VALUE_CHARS), logs };
  return { id: test.id, pass: deepEqual(exec.value, test.expected), actual: formatValue(exec.value), logs };
}

export function gradeTests(tests: readonly TestCase[], execs: readonly ExecResult[]): TestResult[] {
  return tests.map((t, i) => gradeTest(t, execs[i]));
}

export function summarizeResults(results: readonly TestResult[]): { passed: number; failed: number; total: number } {
  const passed = results.filter((r) => r.pass).length;
  return { passed, failed: results.length - passed, total: results.length };
}
