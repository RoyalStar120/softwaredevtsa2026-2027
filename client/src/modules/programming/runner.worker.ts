/**
 * Web Worker that executes learner code for the debugging workspace.
 *
 * - Wraps the learner's code in `new Function`, then evaluates one expression
 *   (a test call or a console experiment) against it.
 * - Captures console.* output and serializes values (NaN, undefined, Infinity,
 *   arrays, objects) with the shared formatter, and grades tests with the shared
 *   grader, so the browser and the server-side bot grade identically.
 * - Infinite loops are handled by the host, which terminates this worker after
 *   a timeout and starts a fresh one.
 */

import type { ExecResult } from '../../../../shared/types.ts';
import type { ExperimentResult, TestCase, TestResult } from '../../../../shared/modules/programming/types.ts';
import { clipLogs, formatLogArgs, formatValue, gradeTest } from '../../../../shared/modules/programming/grading.ts';

export type RunnerRequest =
  | { id: number; kind: 'tests'; code: string; tests: TestCase[] }
  | { id: number; kind: 'eval'; code: string; expression: string };

export type RunnerResponse =
  | { id: number; kind: 'test'; index: number; result: TestResult }
  | { id: number; kind: 'done' }
  | { id: number; kind: 'eval'; result: ExperimentResult };

/** Globals the learner code should not touch (they would break the worker protocol). */
const SHADOWED = ['self', 'postMessage', 'onmessage', 'close', 'importScripts', 'fetch', 'XMLHttpRequest', 'WebSocket'];

function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const err = e as { name?: string; message?: string };
    return `${err.name ?? 'Error'}: ${err.message ?? ''}`;
  }
  return `Error: ${String(e)}`;
}

function makeConsole(logs: string[]) {
  const push = (...args: unknown[]) => {
    if (logs.length < 200) logs.push(formatLogArgs(args));
  };
  return { log: push, info: push, warn: push, error: push, debug: push, table: push, dir: push, trace: push };
}

/** Runs the code, then evaluates `expression` (falls back to statements for console input). */
function execOne(code: string, expression: string, allowStatements: boolean): ExecResult {
  const logs: string[] = [];
  const fakeConsole = makeConsole(logs);
  const shadow = SHADOWED.map(() => undefined);
  let fn: (...args: unknown[]) => unknown = () => undefined;
  try {
    // Check the learner code on its own first, so syntax errors point at the code, not the test.
    new Function('console', ...SHADOWED, code);
  } catch (e) {
    return { ok: false, error: errorText(e), logs };
  }
  try {
    fn = new Function('console', ...SHADOWED, `${code}\n;return (${expression}\n);`) as typeof fn;
  } catch (e) {
    if (!allowStatements) return { ok: false, error: errorText(e), logs };
    try {
      fn = new Function('console', ...SHADOWED, `${code}\n;${expression}\n;return undefined;`) as typeof fn;
    } catch (e2) {
      return { ok: false, error: errorText(e2), logs };
    }
  }
  try {
    const value = fn(fakeConsole, ...shadow);
    return { ok: true, value, logs };
  } catch (e) {
    return { ok: false, error: errorText(e), logs };
  }
}

const post = (msg: RunnerResponse) => self.postMessage(msg);

self.onmessage = (event: MessageEvent<RunnerRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.kind === 'tests') {
    msg.tests.forEach((test, index) => {
      const result = gradeTest(test, execOne(msg.code, test.call, false));
      post({ id: msg.id, kind: 'test', index, result });
    });
    post({ id: msg.id, kind: 'done' });
  } else if (msg.kind === 'eval') {
    const r = execOne(msg.code, msg.expression, true);
    const result: ExperimentResult = r.ok
      ? { ok: true, value: formatValue(r.value), logs: clipLogs(r.logs) }
      : { ok: false, error: r.error ?? 'Error', logs: clipLogs(r.logs) };
    post({ id: msg.id, kind: 'eval', result });
  }
};
