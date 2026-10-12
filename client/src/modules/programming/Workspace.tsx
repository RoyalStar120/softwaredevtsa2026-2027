/**
 * Programming: Debugging workspace.
 *
 * Bug report + CodeMirror editor (flag gutter) + test runner + console for
 * experiments + submit dialog. Code runs in a Web Worker in the browser; every
 * meaningful step is dispatched to the server-authoritative engine, which records
 * it for process evaluation. Edits are synced ~1.5 s after typing stops and are
 * always flushed before runs, experiments, flags and submission.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  EyeOff,
  FileCode2,
  Flag,
  FlaskConical,
  ListChecks,
  Play,
  RotateCcw,
  Send,
  Terminal,
  XCircle,
} from 'lucide-react';
import type { ModuleAction } from '../../../../shared/types.ts';
import type { ActionResponse } from '../../../../shared/api.ts';
import type {
  DiagnosisCategory,
  ExperimentObservation,
  ProgPublicState,
  ProgView,
  TestCase,
  TestResult,
} from '../../../../shared/modules/programming/types.ts';
import { debugInfo } from '../../../../shared/modules/programming/codeAnalysis.ts';
import { formatValue } from '../../../../shared/modules/programming/grading.ts';
import type { WorkspaceProps } from '../types.ts';
import { Callout, Modal, Spinner, cx } from '../../components/ui.tsx';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor.tsx';
import { CodeRunner } from './runner.ts';
import './programming.css';

const EDIT_DEBOUNCE_MS = 1500;

interface RunView {
  results: TestResult[];
  code: string;
}

interface ConsoleEntry {
  key: string;
  expression: string;
  ok: boolean;
  value: string;
  error: string | null;
  logs: string[];
  pending?: boolean;
}

export function Workspace(props: WorkspaceProps<ProgView, ProgPublicState>) {
  const { scenario, publicState, log, mode, dispatch, submit } = props;
  const view = scenario.view;
  const visibleTests = useMemo(() => view.tests.filter((t) => t.visible), [view.tests]);
  const hiddenCount = view.tests.length - visibleTests.length;
  const initialCode = publicState?.code ?? view.code;

  const [code, setCode] = useState(initialCode);
  const [dirty, setDirty] = useState(false);
  const [flags, setFlags] = useState<number[]>(publicState?.flags ?? []);
  const [run, setRun] = useState<RunView | null>(() =>
    publicState?.lastRun ? { results: publicState.lastRun.results, code: initialCode } : null,
  );
  const [running, setRunning] = useState<'all' | string | null>(null);
  const [pendingExp, setPendingExp] = useState<ConsoleEntry | null>(null);
  const [expr, setExpr] = useState('');
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(true);

  const codeRef = useRef(initialCode);
  const syncedRef = useRef(initialCode);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const runnerRef = useRef<CodeRunner | null>(null);
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const consoleLogRef = useRef<HTMLDivElement | null>(null);
  const flagOps = useRef(0);
  const serverFlagsRef = useRef<number[]>(publicState?.flags ?? []);
  const submitted = !!publicState?.submitted;

  const runner = () => (runnerRef.current ??= new CodeRunner());
  useEffect(() => () => runnerRef.current?.dispose(), []);
  useEffect(() => {
    if (!publicState?.flags) return;
    serverFlagsRef.current = publicState.flags;
    if (flagOps.current === 0) setFlags(publicState.flags);
  }, [publicState?.flags]);

  /** Sends actions strictly in order. */
  const send = useCallback(
    (action: ModuleAction): Promise<ActionResponse> => {
      const p = queueRef.current.then(() => dispatch(action)).catch((e: unknown) => ({ ok: false, error: String(e) }) as ActionResponse);
      queueRef.current = p;
      return p;
    },
    [dispatch],
  );

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const current = codeRef.current;
    if (current === syncedRef.current) {
      setDirty(false);
      return;
    }
    syncedRef.current = current;
    setDirty(false);
    await send({ type: 'edit', payload: { code: current } });
  }, [send]);

  // Flush pending edits when the workspace unmounts (e.g. navigating away).
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (codeRef.current !== syncedRef.current) void dispatch({ type: 'edit', payload: { code: codeRef.current } });
    },
    [dispatch],
  );

  const onChange = useCallback(
    (next: string) => {
      codeRef.current = next;
      setCode(next);
      if (next === syncedRef.current) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        setDirty(false);
        return;
      }
      setDirty(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), EDIT_DEBOUNCE_MS);
    },
    [flush],
  );

  const report = (res: ActionResponse) => {
    if (!res.ok && res.error) setError(res.error);
    else setError(null);
  };

  const runTests = useCallback(
    async (tests: TestCase[], scope: 'all' | 'single') => {
      if (running || submitted) return;
      setRunning(scope === 'all' ? 'all' : tests[0].id);
      try {
        await flush();
        const current = codeRef.current;
        const results = await runner().runTests(current, tests);
        setRun((prev) => {
          if (scope === 'all' || !prev) return { results, code: current };
          const merged = prev.results.filter((r) => !results.some((x) => x.id === r.id)).concat(results);
          return { results: merged, code: current };
        });
        report(await send({ type: 'run_tests', payload: { code: current, scope, testIds: tests.map((t) => t.id), results } }));
      } finally {
        setRunning(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [running, submitted, flush, send],
  );
  const runAll = useCallback(() => void runTests(visibleTests, 'all'), [runTests, visibleTests]);

  const onToggleFlag = useCallback(
    async (line: number, flagged: boolean) => {
      flagOps.current++;
      setFlags((f) => (flagged ? [...new Set([...f, line])].sort((a, b) => a - b) : f.filter((x) => x !== line)));
      try {
        await flush();
        const res = await send({ type: 'flag_line', payload: { line, flagged } });
        const serverFlags = (res.publicState as ProgPublicState | undefined)?.flags;
        if (serverFlags) setFlags(serverFlags);
        else if (!res.ok) setFlags(serverFlagsRef.current);
      } finally {
        flagOps.current--;
      }
    },
    [flush, send],
  );

  // Console history comes from the authoritative log (survives reloads).
  const history: ConsoleEntry[] = useMemo(
    () =>
      log
        .filter((e) => e.type === 'run_experiment' && e.observation)
        .map((e) => {
          const o = e.observation as ExperimentObservation;
          return { key: `s${e.seq}`, expression: o.expression, ok: o.ok, value: o.value, error: o.error, logs: o.logs ?? [] };
        }),
    [log],
  );
  const consoleItems = pendingExp ? [...history, pendingExp] : history;
  useEffect(() => {
    const el = consoleLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [consoleItems.length]);

  const runExperiment = async (e?: FormEvent) => {
    e?.preventDefault();
    const expression = expr.trim();
    if (!expression || pendingExp || submitted) return;
    setPendingExp({ key: 'pending', expression, ok: true, value: '', error: null, logs: [], pending: true });
    setExpr('');
    setHistoryIdx(null);
    try {
      await flush();
      const current = codeRef.current;
      const result = await runner().evaluate(current, expression);
      report(await send({ type: 'run_experiment', payload: { code: current, expression, result } }));
    } finally {
      setPendingExp(null);
    }
  };

  const onConsoleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const exprs = history.map((h) => h.expression);
    if (!exprs.length) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = historyIdx === null ? exprs.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(idx);
      setExpr(exprs[idx]);
    } else if (e.key === 'ArrowDown' && historyIdx !== null) {
      e.preventDefault();
      const idx = historyIdx + 1;
      if (idx >= exprs.length) {
        setHistoryIdx(null);
        setExpr('');
      } else {
        setHistoryIdx(idx);
        setExpr(exprs[idx]);
      }
    }
  };

  const doReset = async () => {
    setConfirmReset(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const wasSynced = syncedRef.current;
    syncedRef.current = view.code;
    codeRef.current = view.code;
    editorRef.current?.setCode(view.code);
    setCode(view.code);
    setDirty(false);
    if (wasSynced !== view.code) report(await send({ type: 'reset_code' }));
  };

  const resultById = useMemo(() => new Map((run?.results ?? []).map((r) => [r.id, r])), [run]);
  const visibleResults = visibleTests.map((t) => resultById.get(t.id)).filter((r): r is TestResult => !!r);
  const passed = visibleResults.filter((r) => r.pass).length;
  const stale = !!run && run.code !== code;
  const isOriginal = code === view.code;

  return (
    <div className="prog-ws">
      <div className="prog-main">
        <div className="prog-toolbar">
          <div className="prog-file">
            <FileCode2 />
            <span className="mono">{view.fileName}</span>
            <span className={cx('prog-sync', dirty && 'is-dirty')} aria-live="polite">
              {dirty ? 'Editing…' : 'Saved'}
            </span>
          </div>
          <div className="row gap-6 wrap">
            <button className="btn btn-primary btn-sm" onClick={runAll} disabled={!!running || submitted} title="Run all visible tests (Ctrl/Cmd + Enter)">
              {running === 'all' ? <Spinner size={14} /> : <Play />}
              Run all tests
            </button>
            <button className="btn btn-sm" onClick={() => setConfirmReset(true)} disabled={isOriginal || !!running || submitted}>
              <RotateCcw />
              Reset code
            </button>
            <button className="btn btn-sm prog-submit-btn" onClick={() => setShowSubmit(true)} disabled={!!running || submitted}>
              <Send />
              Submit fix
            </button>
          </div>
        </div>

        <div className="panel prog-editor-panel">
          <div className="panel-head">
            <span className="row gap-6">
              <Flag className="prog-head-icon" /> Click a line number to flag a suspect line
            </span>
            {flags.length > 0 && <span className="prog-flag-count">{flags.length} flagged</span>}
          </div>
          <CodeEditor
            initialCode={initialCode}
            flags={flags}
            readOnly={submitted}
            onChange={onChange}
            onToggleFlag={(line, on) => void onToggleFlag(line, on)}
            onRun={runAll}
            handleRef={editorRef}
            ariaLabel={`${view.fileName} code editor`}
          />
        </div>

        <div className="panel prog-console">
          <div className="panel-head">
            <span className="row gap-6">
              <Terminal className="prog-head-icon" /> Console
            </span>
            <span className="muted tiny">Evaluate any expression against your current code</span>
          </div>
          <div className="prog-console-log" role="log" aria-live="polite" ref={consoleLogRef}>
            {consoleItems.length === 0 && (
              <div className="prog-console-empty">
                Try calling a function with a small input, e.g. <code>{visibleTests[0]?.call ?? 'myFunction(1)'}</code>
              </div>
            )}
            {consoleItems.map((c) => (
              <div key={c.key} className="prog-console-entry">
                <div className="prog-console-in">
                  <ChevronRight /> <span className="mono">{c.expression}</span>
                </div>
                {c.logs.map((l, i) => (
                  <div key={i} className="prog-console-logline mono">
                    {l}
                  </div>
                ))}
                {c.pending ? (
                  <div className="prog-console-out muted">
                    <Spinner size={12} /> running…
                  </div>
                ) : c.ok ? (
                  <div className="prog-console-out mono">{c.value}</div>
                ) : (
                  <div className="prog-console-out is-error mono">{c.error}</div>
                )}
              </div>
            ))}
          </div>
          <form className="prog-console-input" onSubmit={(e) => void runExperiment(e)}>
            <FlaskConical />
            <input
              className="input mono"
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              onKeyDown={onConsoleKey}
              placeholder={visibleTests[0] ? `e.g. ${visibleTests[0].call}` : 'Type an expression'}
              aria-label="Console expression"
              disabled={submitted}
              spellCheck={false}
              autoComplete="off"
            />
            <button className="btn btn-sm" type="submit" disabled={!expr.trim() || !!pendingExp || submitted}>
              Run
            </button>
          </form>
        </div>
      </div>

      <div className="prog-side">
        <section className="card prog-report">
          <button className="prog-report-head" onClick={() => setReportOpen((o) => !o)} aria-expanded={reportOpen}>
            <Bug />
            <span className="grow">
              <span className="eyebrow">Bug report {view.bugReport.ticket}</span>
              <span className="prog-report-title">{view.bugReport.title}</span>
            </span>
            {reportOpen ? <ChevronDown /> : <ChevronRight />}
          </button>
          {reportOpen && (
            <div className="prog-report-body">
              <div className="small text-2">Reported by {view.bugReport.reporter}</div>
              <div className="label">Steps to reproduce</div>
              <ol className="prog-steps">
                {view.bugReport.steps.map((s, i) => (
                  <li key={i}>
                    <InlineCode text={s} />
                  </li>
                ))}
              </ol>
              <div className="prog-expect">
                <div>
                  <div className="label">Expected</div>
                  <div className="small">
                    <InlineCode text={view.bugReport.expected} />
                  </div>
                </div>
                <div>
                  <div className="label">Actual</div>
                  <div className="small">
                    <InlineCode text={view.bugReport.actual} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="panel prog-tests">
          <div className="panel-head">
            <span className="row gap-6">
              <ListChecks className="prog-head-icon" /> Tests
            </span>
            {run && visibleResults.length > 0 && (
              <span className={cx('prog-score', passed === visibleTests.length ? 'is-pass' : 'is-fail')}>
                {passed}/{visibleTests.length} passing
              </span>
            )}
          </div>
          {stale && <div className="prog-stale">Code changed since the last run. Results may be out of date.</div>}
          {!run && <div className="prog-tests-empty">No tests run yet. Start by reproducing the bug: run the tests.</div>}
          <ul className="prog-test-list">
            {visibleTests.map((t) => (
              <TestRow
                key={t.id}
                test={t}
                result={resultById.get(t.id)}
                running={running === t.id || running === 'all'}
                disabled={!!running || submitted}
                onRun={() => void runTests([t], 'single')}
              />
            ))}
          </ul>
          {hiddenCount > 0 && (
            <div className="prog-hidden-note">
              <EyeOff />
              {submitted && publicState?.submitted
                ? `Submitted: ${publicState.submitted.passed}/${publicState.submitted.total} tests passed (including ${hiddenCount} hidden).`
                : `${hiddenCount} hidden edge-case test${hiddenCount === 1 ? '' : 's'} will also run when you submit.`}
            </div>
          )}
        </div>
        {error && (
          <Callout tone="danger" title="Action not recorded">
            {error}
          </Callout>
        )}
      </div>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset code?"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={() => void doReset()}>
              <RotateCcw /> Reset to original
            </button>
          </>
        }
      >
        <p className="text-2">This discards all your changes and restores the original buggy code. Your flags and test history are kept.</p>
      </Modal>

      {showSubmit && (
        <SubmitDialog
          view={view}
          mode={mode}
          code={code}
          flags={flags}
          cursorLine={() => editorRef.current?.cursorLine() ?? 1}
          lastRun={run}
          onClose={() => setShowSubmit(false)}
          onSubmit={async (diagnosis) => {
            await flush();
            const current = codeRef.current;
            const results = await runner().runTests(current, view.tests);
            await submit({ type: 'submit_fix', payload: { code: current, results, diagnosis } });
          }}
        />
      )}
    </div>
  );
}

/** Renders `code` spans inside plain text (bug report strings use backticks). */
function InlineCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') && p.length > 1 ? (
          <code key={i} className="prog-inline-code">
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

const formatExpected = (v: unknown): string => formatValue(v);

function TestRow(props: { test: TestCase; result: TestResult | undefined; running: boolean; disabled: boolean; onRun: () => void }) {
  const { test, result } = props;
  const [open, setOpen] = useState(false);
  const status = props.running ? 'running' : !result ? 'idle' : result.pass ? 'pass' : 'fail';
  const hasDetails = !!result && (!result.pass || result.logs.length > 0);
  useEffect(() => {
    if (result && !result.pass) setOpen(true);
  }, [result]);
  return (
    <li className={cx('prog-test', `is-${status}`)}>
      <div className="prog-test-row">
        <span className="prog-test-icon" aria-label={status}>
          {status === 'running' ? <Spinner size={14} /> : status === 'pass' ? <CheckCircle2 /> : status === 'fail' ? <XCircle /> : <Circle />}
        </span>
        <button className="prog-test-name" onClick={() => hasDetails && setOpen((o) => !o)} aria-expanded={hasDetails ? open : undefined}>
          <span>{test.name}</span>
          <span className="prog-test-call mono">{test.call}</span>
        </button>
        <button className="btn btn-sm btn-icon prog-test-run" onClick={props.onRun} disabled={props.disabled} title="Run only this test" aria-label={`Run test ${test.name}`}>
          <Play />
        </button>
      </div>
      {hasDetails && open && result && (
        <div className="prog-test-details">
          {!result.pass && (
            <div className="prog-kv">
              <span className="muted">Expected</span>
              <span className="mono">{formatExpected(test.expected)}</span>
              <span className="muted">{result.error ? 'Error' : 'Actual'}</span>
              <span className={cx('mono', 'prog-actual')}>{result.error ?? result.actual}</span>
            </div>
          )}
          {result.logs.length > 0 && (
            <div className="prog-logs">
              <div className="muted tiny upper">console output</div>
              {result.logs.map((l, i) => (
                <div key={i} className="mono">
                  {l}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function SubmitDialog(props: {
  view: ProgView;
  mode: 'practice' | 'assessment';
  code: string;
  flags: number[];
  cursorLine: () => number;
  lastRun: RunView | null;
  onClose: () => void;
  onSubmit: (diagnosis: { line: number; category: DiagnosisCategory; explanation?: string }) => Promise<void>;
}) {
  const lineCount = props.code.split('\n').length;
  const [line, setLine] = useState(() => String(props.flags[0] ?? props.cursorLine()));
  const [category, setCategory] = useState<DiagnosisCategory | ''>('');
  const [explanation, setExplanation] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lineNo = Number(line);
  const lineValid = Number.isInteger(lineNo) && lineNo >= 1 && lineNo <= lineCount;
  const lineText = lineValid ? props.code.split('\n')[lineNo - 1]?.trim() : '';
  const logs = debugInfo(props.code).count;
  const verified = !!props.lastRun && props.lastRun.code === props.code;
  const visibleTotal = props.view.tests.filter((t) => t.visible).length;
  const lastPassed = props.lastRun ? props.lastRun.results.filter((r) => r.pass).length : 0;

  const go = async () => {
    if (!lineValid || !category) return;
    setBusy(true);
    setErr(null);
    try {
      await props.onSubmit({ line: lineNo, category, ...(explanation.trim() ? { explanation: explanation.trim() } : {}) });
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => !busy && props.onClose()}
      title="Submit your fix"
      footer={
        <>
          <button className="btn btn-ghost" onClick={props.onClose} disabled={busy}>
            Keep debugging
          </button>
          <button className="btn btn-primary" onClick={() => void go()} disabled={busy || !lineValid || !category}>
            {busy ? <Spinner size={14} /> : <Send />}
            {busy ? 'Running all tests…' : 'Run all tests & submit'}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="text-2 small">
          Your code will run against every test, including the hidden edge cases. Tell us where the root cause was and what kind of bug it
          was.
        </p>
        <div className="prog-diag-grid">
          <label className="field">
            <span className="label">Root-cause line</span>
            <input
              className="input mono"
              type="number"
              min={1}
              max={lineCount}
              value={line}
              onChange={(e) => setLine(e.target.value)}
              aria-invalid={!lineValid}
            />
          </label>
          <label className="field">
            <span className="label">Kind of bug</span>
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value as DiagnosisCategory)}>
              <option value="" disabled>
                Choose a category…
              </option>
              {props.view.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {lineValid && lineText && (
          <div className="prog-diag-line mono">
            <span className="muted">{lineNo}</span> {lineText}
          </div>
        )}
        <label className="field">
          <span className="label">Explanation (optional)</span>
          <textarea
            className="textarea"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Why did this line produce the reported symptom?"
            maxLength={2000}
          />
        </label>
        {props.mode === 'practice' && (
          <div className="prog-precheck">
            <div className={cx('prog-check', verified && lastPassed === visibleTotal ? 'ok' : 'warn')}>
              {verified
                ? `Last run on this exact code: ${lastPassed}/${visibleTotal} visible tests passing.`
                : 'You have not run the tests on this exact version of your code.'}
            </div>
            <div className={cx('prog-check', logs === 0 ? 'ok' : 'warn')}>
              {logs === 0 ? 'No debug logging left in the code.' : `${logs} console statement${logs === 1 ? '' : 's'} still in the code.`}
            </div>
          </div>
        )}
        {err && <div className="error-text">{err}</div>}
      </div>
    </Modal>
  );
}

export default Workspace;
