/**
 * Server-authoritative engine for the Programming: Debugging module:
 * scenario generation, public views, action application and action descriptions.
 * Pure and deterministic (seeded RNG, ctx.seq/ctx.t only). SERVER-SIDE ONLY.
 */

import type {
  ActionContext,
  ApplyResult,
  GenerateOptions,
  LoggedAction,
  ModuleAction,
  PublicScenario,
  ScenarioInstance,
  ScenarioTemplate,
} from '../../types.ts';
import type { Rng } from '../../rng.ts';
import { createRng } from '../../rng.ts';
import type {
  BugDef,
  BugReport,
  Diagnosis,
  ProgConfig,
  ProgPublicState,
  ProgState,
  ProgView,
  RunScope,
  TestResult,
} from './types.ts';
import type { Hunk } from './codeAnalysis.ts';
import {
  calledFunctions,
  changedLineNumbers,
  codeHunks,
  debugInfo,
  functionAt,
  functionRanges,
  hunkDistance,
  hunkKey,
  hunkSize,
  lineMapper,
  normalizedCode,
} from './codeAnalysis.ts';
import { CATEGORY_LABELS, DIAGNOSIS_CATEGORIES, clipLogs, formatValue, isCategory } from './grading.ts';
import type { TemplateData, Variant } from './templates/index.ts';
import { TEMPLATE_DATA_BY_ID, injectBugs } from './templates/index.ts';
import { CONCEPT_SKILLS, MODULE_ID, SKILL_IDS } from './skills.ts';

export const MAX_CODE_CHARS = 20_000;
const MAX_EXPRESSION_CHARS = 500;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// ---------------------------------------------------------------------------
// Code-change analysis (shared with evaluate / bot)
// ---------------------------------------------------------------------------

export type ChangeKind = 'none' | 'trivia' | 'logs_added' | 'logs_removed' | 'code';

export interface CodeChangeInfo {
  /** Raw text differs from the previous version. */
  codeChanged: boolean;
  /** Real code differs (whitespace, comments and console.* calls ignored). */
  fixChange: boolean;
  logDelta: number;
  debugCalls: number;
  /** Inserted / edited lines in the new version (raw diff, 1-based). */
  changedLines: number[];
  deletedLines: number;
  changeKind: ChangeKind;
  /** The real change touched code within 1 line of a bug line. */
  touchesBugLines: boolean;
  /** Lines of newly added changes that are more than 2 lines from every bug line. */
  offTargetLines: number[];
  /** Lines changed vs the original buggy code. */
  changedVsOriginal: number;
  /** The new version modifies code within 1 line of a bug line (vs original). */
  bugAreaEdited: boolean;
}

export function minBugDistance(bugs: readonly BugDef[], h: Hunk): number {
  return Math.min(...bugs.map((b) => hunkDistance(h, b.line)));
}

export function codeChangeInfo(cfg: ProgConfig, prev: string, next: string): CodeChangeInfo {
  const hn = codeHunks(cfg.buggyCode, next);
  const changedVsOriginal = hn.reduce((s, h) => s + hunkSize(h), 0);
  const bugAreaEdited = hn.some((h) => minBugDistance(cfg.bugs, h) <= 1);
  const dNext = debugInfo(next);
  if (prev === next) {
    return {
      codeChanged: false,
      fixChange: false,
      logDelta: 0,
      debugCalls: dNext.count,
      changedLines: [],
      deletedLines: 0,
      changeKind: 'none',
      touchesBugLines: false,
      offTargetLines: [],
      changedVsOriginal,
      bugAreaEdited,
    };
  }
  const fixChange = normalizedCode(prev) !== normalizedCode(next);
  const logDelta = dNext.count - debugInfo(prev).count;
  const { changed, deleted } = changedLineNumbers(prev, next);
  let touchesBugLines = false;
  let offTargetLines: number[] = [];
  if (fixChange) {
    const hp = codeHunks(cfg.buggyCode, prev);
    const kp = new Set(hp.map(hunkKey));
    const kn = new Set(hn.map(hunkKey));
    const added = hn.filter((h) => !kp.has(hunkKey(h)));
    const removed = hp.filter((h) => !kn.has(hunkKey(h)));
    touchesBugLines = [...added, ...removed].some((h) => minBugDistance(cfg.bugs, h) <= 1);
    offTargetLines = added.filter((h) => minBugDistance(cfg.bugs, h) > 2).flatMap((h) => (h.ins.length ? h.ins : h.del));
  }
  const changeKind: ChangeKind = fixChange ? 'code' : logDelta > 0 ? 'logs_added' : logDelta < 0 ? 'logs_removed' : 'trivia';
  return {
    codeChanged: true,
    fixChange,
    logDelta,
    debugCalls: dNext.count,
    changedLines: changed,
    deletedLines: deleted,
    changeKind,
    touchesBugLines,
    offTargetLines,
    changedVsOriginal,
    bugAreaEdited,
  };
}

/** Maps flagged lines through a code change (drops lines that disappeared). */
export function remapFlags(flags: readonly number[], prev: string, next: string): number[] {
  if (prev === next || flags.length === 0) return [...flags];
  const map = lineMapper(prev, next);
  const out = new Set<number>();
  for (const f of flags) {
    const m = map(f);
    if (m !== null) out.add(m);
  }
  return [...out].sort((a, b) => a - b);
}

/** Functions (directly or transitively) calling a buggy function, plus the buggy functions themselves. */
export function bugFunctions(cfg: ProgConfig): { buggy: Set<string>; reaching: Set<string> } {
  const ranges = functionRanges(cfg.referenceCode);
  const lines = cfg.referenceCode.split('\n');
  const buggy = new Set<string>();
  for (const b of cfg.bugs) {
    const f = functionAt(ranges, b.line);
    if (f) buggy.add(f.name);
  }
  const names = ranges.map((r) => r.name);
  const calls = new Map(
    ranges.map((r) => [
      r.name,
      calledFunctions(lines.slice(r.start, r.end).join('\n'), names).filter((n) => n !== r.name),
    ]),
  );
  const reaching = new Set(buggy);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [fn, callees] of calls) {
      if (!reaching.has(fn) && callees.some((c) => reaching.has(c))) {
        reaching.add(fn);
        grew = true;
      }
    }
  }
  return { buggy, reaching };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function bugWeight(b: BugDef, d: number, focus: readonly string[]): number {
  const dist = Math.abs(b.subtlety - d);
  let w = dist === 0 ? 2 : dist === 1 ? 1 : dist === 2 ? 0.35 : 0.1;
  if (focus.includes(b.conceptSkill)) w *= 3;
  if ((focus.includes('prog.localize') || focus.includes('prog.trace')) && b.subtlety >= d) w *= 1.5;
  return w;
}

function chooseVariant(data: TemplateData, d: number, focus: readonly string[], avoid: Set<string>, rng: Rng): Variant {
  const singles = data.variants.filter((v) => v.bugs.length === 1);
  const pairs = data.variants.filter((v) => v.bugs.length === 2);
  let pool = singles;
  if (d >= 4 && pairs.length > 0) {
    const p = d >= 5 ? 0.85 : focus.includes('prog.verify') ? 0.6 : 0.35;
    if (rng.chance(p)) pool = pairs;
  }
  const maxDist = pool === pairs ? 2 : 1;
  let candidates = pool.filter((v) => v.bugs.every((b) => Math.abs(b.subtlety - d) <= maxDist));
  if (candidates.length === 0) candidates = pool;
  const fresh = candidates.filter((v) => !avoid.has(v.id));
  if (fresh.length > 0) candidates = fresh;
  else {
    const freshAny = pool.filter((v) => !avoid.has(v.id));
    if (freshAny.length > 0) candidates = freshAny;
  }
  return rng.weighted(candidates, (v) => v.bugs.reduce((w, b) => w * bugWeight(b, d, focus), 1));
}

function instanceWeights(base: Record<string, number>, bugs: readonly BugDef[]): Record<string, number> {
  const w: Record<string, number> = { ...base };
  const chosen = new Set(bugs.map((b) => b.conceptSkill));
  for (const c of CONCEPT_SKILLS) {
    if (chosen.has(c)) w[c] = Math.max(w[c] ?? 0, 0.8);
    else if ((w[c] ?? 0) > 0.2) w[c] = 0.2;
  }
  if (bugs.length > 1) {
    w['prog.localize'] = Math.max(w['prog.localize'] ?? 0, 0.8);
    w['prog.verify'] = Math.max(w['prog.verify'] ?? 0, 0.8);
  }
  return w;
}

function buildBugReport(data: TemplateData, bugs: readonly BugDef[], reporter: string, ticket: string): BugReport {
  const parts = bugs.map((b) => {
    const t = data.spec.tests.find((x) => x.id === b.repro);
    return { b, call: t?.call ?? '', expected: t ? formatValue(t.expected) : '' };
  });
  const steps = [`Open ${data.spec.fileName}`, ...parts.map((p) => `Call \`${p.call}\``)];
  if (bugs.length > 1) steps.push(`Second report: ${bugs[1].symptom}`);
  return {
    ticket,
    title: bugs.length === 1 ? bugs[0].symptom : `${bugs[0].symptom} (plus a second report)`,
    reporter,
    steps,
    expected: parts.map((p) => `\`${p.call}\` returns ${p.expected}`).join('; '),
    actual: parts.map((p) => `\`${p.call}\` returns ${p.b.actual}`).join('; '),
  };
}

function resolveOptions(template: ScenarioTemplate, opts: GenerateOptions) {
  const data = TEMPLATE_DATA_BY_ID.get(template.id);
  if (!data) throw new Error(`Unknown programming template "${template.id}"`);
  const [lo, hi] = data.template.difficultyRange;
  const raw = Number.isFinite(opts.difficulty) ? Math.round(opts.difficulty) : lo;
  const difficulty = Math.min(hi, Math.max(lo, raw));
  const focus = [...new Set(opts.focusSkills ?? [])].filter(
    (s) => SKILL_IDS.has(s) && (data.template.skillWeights[s] ?? 0) > 0,
  );
  return { data, difficulty, focus, rng: createRng(opts.seed) };
}

export function generate(template: ScenarioTemplate, opts: GenerateOptions): ScenarioInstance<ProgConfig> {
  const { data, difficulty, focus, rng } = resolveOptions(template, opts);
  const variant = chooseVariant(data, difficulty, focus, new Set(opts.avoidVariants ?? []), rng);
  return buildInstance(data, variant, difficulty, focus, rng, opts.seed);
}

/** Builds the instance for one specific variant id (tests, instructor previews, retries). */
export function generateVariant(template: ScenarioTemplate, variantId: string, opts: GenerateOptions): ScenarioInstance<ProgConfig> {
  const { data, difficulty, focus, rng } = resolveOptions(template, opts);
  const variant = data.variants.find((v) => v.id === variantId);
  if (!variant) throw new Error(`Unknown variant "${variantId}" for ${template.id}`);
  return buildInstance(data, variant, difficulty, focus, rng, opts.seed);
}

function buildInstance(
  data: TemplateData,
  variant: Variant,
  difficulty: number,
  focus: string[],
  rng: Rng,
  seed: number,
): ScenarioInstance<ProgConfig> {
  const template = data.template;
  const bugs = variant.bugs;
  const reporter = rng.pick(data.spec.reporters);
  const ticket = `#${rng.int(1040, 4980)}`;
  const bugReport = buildBugReport(data, bugs, reporter, ticket);
  const quoted = bugs.map((b) => `"${b.symptom}"`);
  const briefing =
    bugs.length === 1
      ? `${reporter} filed bug ${ticket}: ${quoted[0]}. ${data.spec.context} Reproduce the problem, find the root cause, fix it with a minimal change, and verify the fix with the full test suite.`
      : `${reporter} filed bug ${ticket} with two problems: ${quoted[0]} and ${quoted[1]}. ${data.spec.context} These are two separate bugs: reproduce, localize and fix each one, then verify everything with the full test suite.`;
  return {
    templateId: template.id,
    moduleId: MODULE_ID,
    seed,
    difficulty,
    variantId: variant.id,
    title: data.template.title,
    briefing,
    goal: 'Find and fix the root cause so every test passes, then submit your diagnosis (faulty line and kind of bug).',
    constraints: [
      'Keep the fix minimal: change only what the root cause requires.',
      'Do not rename functions or change their parameters.',
      'Hidden edge-case tests also run when you submit.',
      'Remove debugging output (console.log) before submitting.',
    ],
    objectives: [
      'Reproduce the failure before editing',
      'Use evidence (console experiments, logs) to locate the faulty line',
      'Make a minimal root-cause fix',
      'Re-run the full test suite to verify',
      'Submit with an accurate diagnosis',
    ],
    skillWeights: instanceWeights(data.template.skillWeights, bugs),
    focusSkills: focus,
    config: {
      fileName: data.spec.fileName,
      functionNames: data.functionNames,
      referenceCode: data.spec.code,
      buggyCode: injectBugs(data.spec.code, bugs),
      bugs: bugs.map((b) => ({ ...b })),
      tests: data.spec.tests.map((t) => ({ ...t })),
      bugReport,
    },
  };
}

export function publicScenario(instance: ScenarioInstance<ProgConfig>): PublicScenario<ProgView> {
  const cfg = instance.config;
  // Template-level weights: the instance weights would reveal which concept the bug belongs to.
  const templateWeights = TEMPLATE_DATA_BY_ID.get(instance.templateId)?.template.skillWeights ?? instance.skillWeights;
  return {
    templateId: instance.templateId,
    moduleId: instance.moduleId,
    difficulty: instance.difficulty,
    title: instance.title,
    briefing: instance.briefing,
    goal: instance.goal,
    constraints: instance.constraints,
    objectives: instance.objectives,
    focusSkills: instance.focusSkills,
    skillWeights: { ...templateWeights },
    view: {
      language: 'javascript',
      fileName: cfg.fileName,
      code: cfg.buggyCode,
      functionNames: [...cfg.functionNames],
      tests: cfg.tests.map((t) => ({ id: t.id, name: t.name, call: t.call, expected: t.expected, visible: t.visible })),
      bugReport: { ...cfg.bugReport, steps: [...cfg.bugReport.steps] },
      categories: DIAGNOSIS_CATEGORIES.map((c) => ({ ...c })),
    },
  };
}

export function initialState(instance: ScenarioInstance<ProgConfig>): ProgState {
  return {
    code: instance.config.buggyCode,
    flags: [],
    counts: { runs: 0, experiments: 0, edits: 0, resets: 0, flags: 0 },
    observed: false,
    firstFixSeq: null,
    lastRunCode: null,
    lastFullRun: null,
    testStatus: {},
    lastRun: null,
    submitted: null,
  };
}

export function publicState(_instance: ScenarioInstance<ProgConfig>, state: ProgState): ProgPublicState {
  return {
    code: state.code,
    flags: [...state.flags],
    lastRun: state.lastRun,
    counts: { ...state.counts },
    submitted: state.submitted ? { passed: state.submitted.passed, total: state.submitted.total } : null,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Result = ApplyResult<ProgState>;

function sanitizeResults(cfg: ProgConfig, raw: unknown, allowHidden: boolean): TestResult[] | string {
  if (!Array.isArray(raw)) return 'Test results must be an array';
  if (raw.length > cfg.tests.length * 3) return 'Too many test results';
  const byId = new Map(cfg.tests.map((t) => [t.id, t]));
  const out = new Map<string, TestResult>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') return 'Invalid test result';
    const rr = r as Record<string, unknown>;
    const id = rr.id;
    if (typeof id !== 'string' || !byId.has(id)) return `Unknown test id "${String(id)}"`;
    if (typeof rr.pass !== 'boolean') return `Test "${id}" is missing pass/fail`;
    if (!allowHidden && !byId.get(id)!.visible) continue;
    const res: TestResult = { id, pass: rr.pass, actual: clip(String(rr.actual ?? ''), 500), logs: clipLogs(rr.logs) };
    if (typeof rr.error === 'string' && rr.error) res.error = clip(rr.error, 500);
    if (rr.timedOut === true) res.timedOut = true;
    out.set(id, res);
  }
  return cfg.tests.filter((t) => out.has(t.id)).map((t) => out.get(t.id)!);
}

function readCode(payload: Record<string, unknown>): string | { error: string } {
  if (typeof payload.code !== 'string') return { error: 'The action must include the current code' };
  if (payload.code.length > MAX_CODE_CHARS) return { error: `Code is too long (max ${MAX_CODE_CHARS} characters)` };
  return payload.code.replace(/\r\n?/g, '\n');
}

function withCode(cfg: ProgConfig, state: ProgState, code: string, seq: number) {
  const change = codeChangeInfo(cfg, state.code, code);
  return {
    change,
    code,
    flags: remapFlags(state.flags, state.code, code),
    firstFixSeq: state.firstFixSeq ?? (change.fixChange ? seq : null),
  };
}

function runTests(cfg: ProgConfig, state: ProgState, payload: Record<string, unknown>, ctx: ActionContext): Result {
  const code = readCode(payload);
  if (typeof code !== 'string') return { state, error: code.error };
  const scope: RunScope = payload.scope === 'single' ? 'single' : 'all';
  const results = sanitizeResults(cfg, payload.results, false);
  if (typeof results === 'string') return { state, error: results };
  if (results.length === 0) return { state, error: 'No visible test results were included' };

  const c = withCode(cfg, state, code, ctx.seq);
  const since = codeChangeInfo(cfg, state.lastRunCode ?? cfg.buggyCode, code);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const visibleIds = cfg.tests.filter((t) => t.visible).map((t) => t.id);
  const fullSuite = scope === 'all' && visibleIds.every((id) => results.some((r) => r.id === id));
  const syntaxError = results.every((r) => !r.pass && /^SyntaxError/.test(r.error ?? ''));
  const regressions = syntaxError ? [] : results.filter((r) => !r.pass && state.testStatus[r.id] === true).map((r) => r.id);
  const norm = normalizedCode(code);
  const isReproduction = failed > 0 && norm === normalizedCode(cfg.buggyCode);
  const testStatus = { ...state.testStatus };
  for (const r of results) testStatus[r.id] = r.pass;
  const logsCaptured = results.reduce((s, r) => s + r.logs.length, 0);
  const label = scope === 'single' && results.length === 1 ? cfg.tests.find((t) => t.id === results[0].id)?.name : undefined;
  const summary = { seq: ctx.seq, scope, passed, failed, total: results.length, results };

  return {
    state: {
      ...state,
      code,
      flags: c.flags,
      firstFixSeq: c.firstFixSeq,
      counts: { ...state.counts, runs: state.counts.runs + 1 },
      observed: true,
      lastRunCode: code,
      lastFullRun: fullSuite ? { seq: ctx.seq, norm, allPass: failed === 0 } : state.lastFullRun,
      testStatus,
      lastRun: summary,
    },
    observation: { scope, passed, failed, total: results.length, results, ...(label ? { label } : {}) },
    annotations: {
      change: c.change,
      scope,
      fullSuite,
      passed,
      failed,
      total: results.length,
      allPass: failed === 0,
      failingIds: results.filter((r) => !r.pass).map((r) => r.id),
      regressions,
      isReproduction,
      beforeFirstFix: c.firstFixSeq === null,
      editedSinceLastRun: since.fixChange,
      changeSinceLastRunTouchesBug: since.touchesBugLines,
      offTargetSinceLastRun: since.offTargetLines,
      bugAreaEdited: c.change.bugAreaEdited,
      touchesBugLines: c.change.bugAreaEdited,
      changedLinesVsOriginal: c.change.changedVsOriginal,
      codeChanged: c.change.codeChanged,
      syntaxError,
      logsCaptured,
      instrumented: c.change.debugCalls > 0,
    },
  };
}

function runExperiment(cfg: ProgConfig, state: ProgState, payload: Record<string, unknown>, ctx: ActionContext): Result {
  const code = readCode(payload);
  if (typeof code !== 'string') return { state, error: code.error };
  const expression = typeof payload.expression === 'string' ? payload.expression.trim() : '';
  if (!expression) return { state, error: 'Type an expression to evaluate' };
  if (expression.length > MAX_EXPRESSION_CHARS) return { state, error: 'Expression is too long' };
  const r = payload.result;
  if (!r || typeof r !== 'object') return { state, error: 'Missing experiment result' };
  const rr = r as Record<string, unknown>;
  const ok = rr.ok === true;
  const observation = {
    expression,
    ok,
    value: ok ? clip(String(rr.value ?? 'undefined'), 500) : '',
    error: ok ? null : clip(String(rr.error ?? 'Error'), 500),
    logs: clipLogs(rr.logs),
    timedOut: rr.timedOut === true,
  };
  const c = withCode(cfg, state, code, ctx.seq);
  const called = calledFunctions(expression, cfg.functionNames);
  const { buggy, reaching } = bugFunctions(cfg);
  return {
    state: {
      ...state,
      code,
      flags: c.flags,
      firstFixSeq: c.firstFixSeq,
      counts: { ...state.counts, experiments: state.counts.experiments + 1 },
      observed: true,
    },
    observation,
    annotations: {
      change: c.change,
      beforeFirstEdit: c.firstFixSeq === null,
      beforeFirstFix: c.firstFixSeq === null,
      calledFunctions: called,
      callsBuggyFunction: called.some((f) => buggy.has(f)),
      reachesBug: called.some((f) => reaching.has(f)),
      ok,
      timedOut: observation.timedOut,
      logsCaptured: observation.logs.length,
    },
  };
}

function edit(cfg: ProgConfig, state: ProgState, payload: Record<string, unknown>, ctx: ActionContext): Result {
  const code = readCode(payload);
  if (typeof code !== 'string') return { state, error: code.error };
  if (code === state.code) return { state, error: 'No changes to save' };
  const c = withCode(cfg, state, code, ctx.seq);
  return {
    state: {
      ...state,
      code,
      flags: c.flags,
      firstFixSeq: c.firstFixSeq,
      counts: { ...state.counts, edits: state.counts.edits + 1 },
    },
    observation: { changedLines: c.change.changedLines, deletedLines: c.change.deletedLines },
    annotations: {
      change: c.change,
      ...c.change,
      changedVsOriginal: c.change.changedVsOriginal,
      addedLogs: Math.max(0, c.change.logDelta),
      beforeAnyRun: !state.observed,
      firstFix: c.change.fixChange && state.firstFixSeq === null,
    },
  };
}

function flagLine(cfg: ProgConfig, state: ProgState, payload: Record<string, unknown>): Result {
  const line = payload.line;
  const lineCount = state.code.split('\n').length;
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1 || line > lineCount) {
    return { state, error: `Line must be between 1 and ${lineCount}` };
  }
  const flagged = payload.flagged !== false;
  const has = state.flags.includes(line);
  if (flagged === has) return { state, error: flagged ? 'Line is already flagged' : 'Line is not flagged' };
  const flags = flagged ? [...state.flags, line].sort((a, b) => a - b) : state.flags.filter((f) => f !== line);
  const origLine = lineMapper(state.code, cfg.buggyCode)(line) ?? line;
  const distance = Math.min(...cfg.bugs.map((b) => Math.abs(b.line - origLine)));
  return {
    state: { ...state, flags, counts: { ...state.counts, flags: state.counts.flags + 1 } },
    observation: { line, flagged, flags },
    annotations: {
      line,
      origLine,
      flagged,
      distance,
      onBug: distance === 0,
      nearBug: distance <= 1,
      beforeFirstFix: state.firstFixSeq === null,
    },
  };
}

function resetCode(cfg: ProgConfig, state: ProgState, ctx: ActionContext): Result {
  if (state.code === cfg.buggyCode) return { state, error: 'The code already matches the original' };
  const c = withCode(cfg, state, cfg.buggyCode, ctx.seq);
  const discarded = codeChangeInfo(cfg, cfg.buggyCode, state.code).changedVsOriginal;
  return {
    state: {
      ...state,
      code: cfg.buggyCode,
      flags: c.flags,
      firstFixSeq: c.firstFixSeq,
      counts: { ...state.counts, resets: state.counts.resets + 1 },
    },
    observation: { reset: true },
    annotations: { change: c.change, discardedLines: discarded, discardedLogs: debugInfo(state.code).count },
  };
}

function submitFix(cfg: ProgConfig, state: ProgState, payload: Record<string, unknown>, ctx: ActionContext): Result {
  const code = readCode(payload);
  if (typeof code !== 'string') return { state, error: code.error };
  const results = sanitizeResults(cfg, payload.results, true);
  if (typeof results === 'string') return { state, error: results };
  const d = payload.diagnosis as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object') return { state, error: 'A diagnosis (line and category) is required' };
  const lineCount = code.split('\n').length;
  if (typeof d.line !== 'number' || !Number.isInteger(d.line) || d.line < 1 || d.line > lineCount) {
    return { state, error: `Diagnosis line must be between 1 and ${lineCount}` };
  }
  if (!isCategory(d.category)) return { state, error: 'Choose a bug category for your diagnosis' };
  const diagnosis: Diagnosis = { line: d.line, category: d.category };
  if (typeof d.explanation === 'string' && d.explanation.trim()) diagnosis.explanation = clip(d.explanation.trim(), 2000);

  const c = withCode(cfg, state, code, ctx.seq);
  const byId = new Map(results.map((r) => [r.id, r]));
  const visible = cfg.tests.filter((t) => t.visible);
  const hidden = cfg.tests.filter((t) => !t.visible);
  const passedOf = (ts: typeof cfg.tests) => ts.filter((t) => byId.get(t.id)?.pass === true).length;
  const visiblePassed = passedOf(visible);
  const hiddenPassed = passedOf(hidden);
  const passed = visiblePassed + hiddenPassed;
  const total = cfg.tests.length;
  const allPass = passed === total;
  const origLine = lineMapper(code, cfg.buggyCode)(diagnosis.line) ?? diagnosis.line;
  const lineCorrect = cfg.bugs.some((b) => Math.abs(b.line - origLine) <= 1 || Math.abs(b.line - diagnosis.line) <= 1);
  const categoryCorrect = cfg.bugs.some((b) => b.category === diagnosis.category || (b.accept ?? []).includes(diagnosis.category));
  const norm = normalizedCode(code);
  const verified = state.lastFullRun !== null && state.lastFullRun.norm === norm;

  return {
    state: {
      ...state,
      code,
      flags: c.flags,
      firstFixSeq: c.firstFixSeq,
      submitted: { seq: ctx.seq, passed, total, code, diagnosis },
    },
    observation: {
      passed,
      total,
      allPass,
      visiblePassed,
      visibleTotal: visible.length,
      hiddenPassed,
      hiddenTotal: hidden.length,
      results,
      diagnosis,
    },
    annotations: {
      change: c.change,
      passed,
      total,
      allPass,
      visiblePassed,
      visibleTotal: visible.length,
      hiddenPassed,
      hiddenTotal: hidden.length,
      failingIds: cfg.tests.filter((t) => byId.get(t.id)?.pass !== true).map((t) => t.id),
      diagnosisLineOrig: origLine,
      lineCorrect,
      categoryCorrect,
      verified,
      lastFullRunSeq: state.lastFullRun?.seq ?? null,
      lastFullRunAllPass: state.lastFullRun?.allPass ?? false,
      ranAnyTests: state.counts.runs > 0,
      linesChanged: c.change.changedVsOriginal,
      debugCalls: c.change.debugCalls,
    },
    complete: true,
  };
}

export function applyAction(
  instance: ScenarioInstance<ProgConfig>,
  state: ProgState,
  action: ModuleAction,
  ctx: ActionContext,
): Result {
  if (state.submitted) return { state, error: 'This scenario has already been submitted' };
  const cfg = instance.config;
  const payload = (action.payload && typeof action.payload === 'object' ? action.payload : {}) as Record<string, unknown>;
  switch (action.type) {
    case 'run_tests':
      return runTests(cfg, state, payload, ctx);
    case 'run_experiment':
      return runExperiment(cfg, state, payload, ctx);
    case 'edit':
      return edit(cfg, state, payload, ctx);
    case 'flag_line':
      return flagLine(cfg, state, payload);
    case 'reset_code':
      return resetCode(cfg, state, ctx);
    case 'submit_fix':
      return submitFix(cfg, state, payload, ctx);
    default:
      return { state, error: `Unknown action "${action.type}"` };
  }
}

// ---------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------

/** [4,5,6,9] -> "4-6, 9" */
export function formatLines(lines: readonly number[]): string {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : `${sorted[i]}`);
    i = j;
  }
  return parts.length > 4 ? `${parts.slice(0, 4).join(', ')} and more` : parts.join(', ');
}

export function describeAction(entry: LoggedAction): string {
  const p = (entry.payload ?? {}) as Record<string, any>;
  const o = (entry.observation ?? {}) as Record<string, any>;
  const a = (entry.annotations ?? {}) as Record<string, any>;
  switch (entry.type) {
    case 'run_tests': {
      if (o.scope === 'single' && o.total === 1) {
        return `Ran test "${o.label ?? o.results?.[0]?.id ?? 'test'}": ${o.passed === 1 ? 'passed' : 'failed'}`;
      }
      const what = o.scope === 'single' ? `${o.total} selected tests` : 'all tests';
      return `Ran ${what}: ${o.passed ?? 0}/${o.total ?? 0} passed`;
    }
    case 'run_experiment': {
      const expr = clip(String(p.expression ?? o.expression ?? ''), 60);
      if (o.timedOut) return `Ran \`${expr}\` -> timed out`;
      if (o.ok === false) return `Ran \`${expr}\` -> ${clip(String(o.error ?? 'error'), 60)}`;
      return `Ran \`${expr}\` -> ${clip(String(o.value ?? 'undefined'), 60)}`;
    }
    case 'edit': {
      const c = (a.change ?? a) as Partial<CodeChangeInfo>;
      const lines: number[] = o.changedLines ?? c.changedLines ?? [];
      const at = lines.length ? ` on line${lines.length === 1 ? '' : 's'} ${formatLines(lines)}` : '';
      if (c.changeKind === 'logs_added') return `Added console.log${at}`;
      if (c.changeKind === 'logs_removed') return 'Removed console.log debugging';
      if (c.changeKind === 'trivia') return `Reformatted code${at}`;
      if (lines.length) return `Edited line${lines.length === 1 ? '' : 's'} ${formatLines(lines)}`;
      const del = Number(o.deletedLines ?? c.deletedLines ?? 0);
      return del ? `Deleted ${del} line${del === 1 ? '' : 's'}` : 'Edited code';
    }
    case 'flag_line':
      return p.flagged === false ? `Unflagged line ${p.line}` : `Flagged line ${p.line} as suspect`;
    case 'reset_code':
      return 'Reset code to original';
    case 'submit_fix': {
      const d = (p.diagnosis ?? {}) as Partial<Diagnosis>;
      const label = d.category ? (CATEGORY_LABELS[d.category] ?? d.category) : 'no category';
      return `Submitted fix: ${o.passed ?? '?'}/${o.total ?? '?'} tests passed (diagnosis: ${label} at line ${d.line ?? '?'})`;
    }
    case 'hint':
      return `Used hint (level ${p.level ?? '?'})`;
    default:
      return entry.type.replace(/_/g, ' ');
  }
}
