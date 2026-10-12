/**
 * Host side of the code runner: owns the Web Worker, serializes requests and
 * enforces a per-test time limit. If learner code hangs (e.g. an infinite loop),
 * the worker is terminated and recreated, and the hung test is reported as
 * timed out.
 */

import type { ExperimentResult, TestCase, TestResult } from '../../../../shared/modules/programming/types.ts';
import type { RunnerRequest, RunnerResponse } from './runner.worker.ts';

export const RUN_TIMEOUT_MS = 2000;

const TIMEOUT_ERROR = `Timed out after ${RUN_TIMEOUT_MS / 1000}s (possible infinite loop)`;
const SKIPPED_ERROR = 'Not run: an earlier test timed out (possible infinite loop)';

export class CodeRunner {
  private worker: Worker | null = null;
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./runner.worker.ts', import.meta.url), { type: 'module' });
    }
    return this.worker;
  }

  private kill() {
    this.worker?.terminate();
    this.worker = null;
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const p = this.queue.then(job, job);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Runs tests one after another; partial results survive a timeout. */
  runTests(code: string, tests: TestCase[]): Promise<TestResult[]> {
    return this.enqueue(
      () =>
        new Promise<TestResult[]>((resolve) => {
          if (tests.length === 0) return resolve([]);
          const id = this.nextId++;
          const results: Array<TestResult | undefined> = new Array(tests.length).fill(undefined);
          let worker: Worker;
          try {
            worker = this.ensure();
          } catch (e) {
            resolve(tests.map((t) => ({ id: t.id, pass: false, actual: '', error: `Could not start the code runner: ${String(e)}`, logs: [] })));
            return;
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          const finish = () => {
            if (timer) clearTimeout(timer);
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            resolve(tests.map((t, i) => results[i] ?? { id: t.id, pass: false, actual: '', error: SKIPPED_ERROR, logs: [] }));
          };
          const arm = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              const idx = results.findIndex((r) => r === undefined);
              if (idx >= 0) results[idx] = { id: tests[idx].id, pass: false, actual: '', error: TIMEOUT_ERROR, logs: [], timedOut: true };
              this.kill();
              finish();
            }, RUN_TIMEOUT_MS);
          };
          const onMessage = (e: MessageEvent<RunnerResponse>) => {
            const m = e.data;
            if (!m || m.id !== id) return;
            if (m.kind === 'test') {
              results[m.index] = m.result;
              arm();
            } else if (m.kind === 'done') finish();
          };
          const onError = (e: ErrorEvent) => {
            e.preventDefault();
            const idx = results.findIndex((r) => r === undefined);
            if (idx >= 0) results[idx] = { id: tests[idx].id, pass: false, actual: '', error: e.message || 'Runner error', logs: [] };
            this.kill();
            finish();
          };
          worker.addEventListener('message', onMessage);
          worker.addEventListener('error', onError);
          arm();
          const req: RunnerRequest = { id, kind: 'tests', code, tests };
          worker.postMessage(req);
        }),
    );
  }

  /** Evaluates a console expression against the code. */
  evaluate(code: string, expression: string): Promise<ExperimentResult> {
    return this.enqueue(
      () =>
        new Promise<ExperimentResult>((resolve) => {
          const id = this.nextId++;
          let worker: Worker;
          try {
            worker = this.ensure();
          } catch (e) {
            resolve({ ok: false, error: `Could not start the code runner: ${String(e)}`, logs: [] });
            return;
          }
          const done = (r: ExperimentResult) => {
            clearTimeout(timer);
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            resolve(r);
          };
          const timer = setTimeout(() => {
            this.kill();
            done({ ok: false, error: TIMEOUT_ERROR, logs: [], timedOut: true });
          }, RUN_TIMEOUT_MS);
          const onMessage = (e: MessageEvent<RunnerResponse>) => {
            const m = e.data;
            if (m && m.id === id && m.kind === 'eval') done(m.result);
          };
          const onError = (e: ErrorEvent) => {
            e.preventDefault();
            this.kill();
            done({ ok: false, error: e.message || 'Runner error', logs: [] });
          };
          worker.addEventListener('message', onMessage);
          worker.addEventListener('error', onError);
          const req: RunnerRequest = { id, kind: 'eval', code, expression };
          worker.postMessage(req);
        }),
    );
  }

  dispose() {
    this.kill();
  }
}
