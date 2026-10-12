/**
 * Trusted code executor for SERVER-SIDE seeding only (runs our own simulated-learner
 * code, never user input). Learner code always runs in a browser Web Worker.
 */

import vm from 'node:vm';
import type { ExecResult } from '../shared/types.ts';

function fmt(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function plain(v: unknown): unknown {
  try {
    return structuredClone(v);
  } catch {
    return String(v);
  }
}

export function execTrusted(code: string, expressions: string[]): ExecResult[] {
  return expressions.map((expr) => {
    const logs: string[] = [];
    const sandbox = { console: { log: (...args: unknown[]) => logs.push(args.map(fmt).join(' ')) } };
    const ctx = vm.createContext(sandbox);
    try {
      vm.runInContext(code, ctx, { timeout: 500 });
      const value = vm.runInContext(expr, ctx, { timeout: 500 });
      return { ok: true, value: plain(value), logs };
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      return { ok: false, error: msg, logs, timedOut: /timed out/i.test(msg) };
    }
  });
}
