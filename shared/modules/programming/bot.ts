/**
 * Simulated learner for the Programming: Debugging module (demo data + tests).
 * Produces a plausible action sequence whose payloads carry REAL test results,
 * computed with the trusted executor (ctx.exec) and the shared grader.
 * SERVER-SIDE ONLY.
 */

import type { BotContext, ModuleAction, ScenarioInstance } from '../../types.ts';
import type { BugDef, DiagnosisCategory, ExperimentResult, ProgConfig, TestCase, TestResult } from './types.ts';
import { functionAt, functionRanges, lineMapper, significantLines } from './codeAnalysis.ts';
import { DIAGNOSIS_CATEGORIES, clipLogs, formatValue, gradeTests } from './grading.ts';
import { remapFlags } from './engine.ts';
import { TEMPLATE_DATA_BY_ID } from './templates/index.ts';

const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0.5));

/** Fallback when no executor is available: a bug's repro test fails while its buggy line is still present. */
function presentBugs(cfg: ProgConfig, src: string): BugDef[] {
  const map = lineMapper(cfg.buggyCode, src);
  const lines = src.split('\n');
  return cfg.bugs.filter((b) => {
    const l = map(b.line);
    return l !== null && lines[l - 1]?.trim() === b.buggyLine;
  });
}

function oracleTests(cfg: ProgConfig, src: string, tests: readonly TestCase[]): TestResult[] {
  const present = presentBugs(cfg, src);
  return tests.map((t) => {
    const bug = present.find((b) => b.repro === t.id);
    return { id: t.id, pass: !bug, actual: bug ? bug.actual : formatValue(t.expected), logs: [] };
  });
}

const FLIPS: Array<[string, string]> = [
  ['<=', '<'],
  ['>=', '>'],
  [' < ', ' <= '],
  [' > ', ' >= '],
  ['&&', '||'],
  ['||', '&&'],
  ['===', '!=='],
  [' + ', ' - '],
  [' - ', ' + '],
  ['0', '1'],
];

export function simulateLearner(instance: ScenarioInstance<ProgConfig>, ctx: BotContext): ModuleAction[] {
  const cfg = instance.config;
  const rng = ctx.rng;
  const ability = clamp01(ctx.ability);
  const careful = clamp01(ctx.traits?.careful);
  const systematic = clamp01(ctx.traits?.systematic);
  const visible = cfg.tests.filter((t) => t.visible);
  const refLines = cfg.referenceCode.split('\n');
  const actions: ModuleAction[] = [];

  let lines = cfg.buggyCode.split('\n');
  let synced = cfg.buggyCode;
  let flags: number[] = [];
  const src = () => lines.join('\n');
  const track = (code: string) => {
    flags = remapFlags(flags, synced, code);
    synced = code;
  };

  const runTests = (tests: readonly TestCase[], code: string): TestResult[] =>
    ctx.exec ? gradeTests(tests, ctx.exec(code, tests.map((t) => t.call))) : oracleTests(cfg, code, tests);

  const run = (): TestResult[] => {
    const code = src();
    const results = runTests(visible, code);
    actions.push({ type: 'run_tests', payload: { code, scope: 'all', testIds: visible.map((t) => t.id), results } });
    track(code);
    return results;
  };

  const experiment = (expression: string) => {
    const code = src();
    let result: ExperimentResult;
    if (ctx.exec) {
      const [r] = ctx.exec(code, [expression]);
      result = r?.ok
        ? { ok: true, value: formatValue(r.value), logs: clipLogs(r.logs) }
        : { ok: false, error: r?.error ?? 'Error', logs: clipLogs(r?.logs ?? []), timedOut: r?.timedOut === true };
    } else {
      const t = cfg.tests.find((x) => x.call === expression);
      const bug = presentBugs(cfg, code).find((b) => b.repro === t?.id);
      result = { ok: true, value: bug ? bug.actual : t ? formatValue(t.expected) : 'undefined', logs: [] };
    }
    actions.push({ type: 'run_experiment', payload: { code, expression, result } });
    track(code);
  };

  const sync = () => {
    const code = src();
    if (code === synced) return false;
    actions.push({ type: 'edit', payload: { code } });
    track(code);
    return true;
  };

  const flag = (line: number) => {
    if (line < 1 || line > lines.length || flags.includes(line)) return;
    actions.push({ type: 'flag_line', payload: { line, flagged: true } });
    flags = [...flags, line].sort((a, b) => a - b);
  };

  /** Current (1-based) line of an original line number. */
  const currentLine = (origLine: number): number => {
    const mapped = lineMapper(cfg.buggyCode, src())(origLine);
    return mapped ?? Math.min(origLine, lines.length);
  };
  const indentOf = (s: string) => /^\s*/.exec(s)?.[0] ?? '';

  // --- persona -------------------------------------------------------------
  const reproduceFirst = rng.chance(0.2 + 0.8 * systematic);
  const doExperiment = rng.chance(0.15 + 0.75 * systematic);
  const instrument = rng.chance(0.1 + 0.35 * systematic);
  const doFlag = rng.chance(0.25 + 0.65 * systematic);
  let decoyCount = Math.round((1 - ability) * (1.2 - systematic) * 3 * rng.next());
  const findChance = 0.3 + 0.7 * ability;
  const nearMiss = rng.chance((1 - ability) * 0.6);
  const verify = rng.chance(0.25 + 0.75 * careful);
  const cleanLogs = rng.chance(0.3 + 0.7 * careful);
  const revertDecoys = rng.chance(careful * 0.8);
  const rightDiagnosis = rng.chance(0.25 + 0.75 * ability);
  if (!reproduceFirst) decoyCount = Math.max(1, decoyCount);

  // --- decoy edits (plausible but unrelated changes) ------------------------
  const allBugs = TEMPLATE_DATA_BY_ID.get(instance.templateId)?.bugs ?? [];
  const ranges = functionRanges(cfg.buggyCode);
  const farFromBugs = (l: number) => cfg.bugs.every((b) => Math.abs(b.line - l) > 2);
  const decoyLines = significantLines(cfg.buggyCode)
    .map((s) => s.n)
    .filter((n) => farFromBugs(n) && ranges.some((r) => n > r.start && n < r.end) && !/^[{}]+$/.test(cfg.buggyCode.split('\n')[n - 1].trim()));
  const decoyEdits: Array<{ line: number; text: string }> = [];
  for (const b of allBugs) {
    if (cfg.bugs.some((x) => x.id === b.id) || !decoyLines.includes(b.line)) continue;
    const orig = cfg.buggyCode.split('\n')[b.line - 1];
    if (orig.includes(b.find)) decoyEdits.push({ line: b.line, text: orig.replace(b.find, b.replace) });
  }
  for (const n of decoyLines) {
    const orig = cfg.buggyCode.split('\n')[n - 1];
    const m = /^(\s*)return (.+);$/.exec(orig);
    if (m) decoyEdits.push({ line: n, text: `${m[1]}return (${m[2]});` });
    else if (orig.includes('const ')) decoyEdits.push({ line: n, text: orig.replace('const ', 'let ') });
    else if (orig.includes('++')) decoyEdits.push({ line: n, text: orig.replace('++', ' += 1') });
  }
  const pendingDecoys = rng.shuffle(decoyEdits).filter((d, i, arr) => arr.findIndex((x) => x.line === d.line) === i);
  const applied: Array<{ line: number; text: string }> = [];
  const applyDecoy = (): boolean => {
    const d = pendingDecoys.shift();
    if (!d) return false;
    const cur = currentLine(d.line);
    if (lines[cur - 1]?.trim() !== cfg.buggyCode.split('\n')[d.line - 1].trim()) return false;
    lines[cur - 1] = d.text;
    applied.push(d);
    return sync();
  };

  // --- instrumentation -----------------------------------------------------
  let logLines = 0;
  const addLog = (bug: BugDef) => {
    const cur = currentLine(bug.line);
    const fn = functionAt(functionRanges(src()), cur);
    const indent = indentOf(lines[cur - 1] ?? '  ');
    const args = fn && fn.params.length ? `'${fn.name} called with', ${fn.params.join(', ')}` : `'reached line ${cur}'`;
    lines.splice(cur - 1, 0, `${indent}console.log(${args});`);
    logLines++;
    sync();
  };
  const removeLogs = () => {
    if (!logLines) return;
    lines = lines.filter((l) => !/^\s*console\.log\(.*\);\s*$/.test(l));
    logLines = 0;
  };

  const fixBug = (bug: BugDef) => {
    let cur = currentLine(bug.line);
    if (lines[cur - 1]?.trim() !== bug.buggyLine) {
      const idx = lines.findIndex((l) => l.trim() === bug.buggyLine);
      if (idx < 0) return;
      cur = idx + 1;
    }
    lines[cur - 1] = refLines[bug.line - 1];
  };

  const wrongVersion = (bug: BugDef): string | null => {
    const cur = currentLine(bug.line);
    const line = lines[cur - 1] ?? '';
    for (const [from, to] of FLIPS) {
      if (!line.includes(from)) continue;
      const cand = line.replace(from, to);
      if (cand.trim() !== bug.fixedLine && cand !== line) return cand;
    }
    return null;
  };

  // --- the attempt ---------------------------------------------------------
  if (!reproduceFirst) {
    applyDecoy();
    decoyCount--;
  }
  run();
  const first = cfg.bugs[0];
  const reproCall = (b: BugDef) => cfg.tests.find((t) => t.id === b.repro)?.call ?? '';
  if (doExperiment) experiment(reproCall(first));
  if (instrument) {
    addLog(first);
    run();
  }
  if (doFlag) flag(currentLine(first.line));
  for (let i = 0; i < decoyCount; i++) {
    if (applyDecoy()) run();
  }
  if (applied.length && revertDecoys && rng.chance(0.4) && src() !== cfg.buggyCode) {
    actions.push({ type: 'reset_code' });
    lines = cfg.buggyCode.split('\n');
    track(cfg.buggyCode);
    applied.length = 0;
    logLines = 0;
  }

  let solvedAll = true;
  cfg.bugs.forEach((bug, i) => {
    if (!solvedAll) return;
    if (i > 0 && systematic > 0.5) {
      experiment(reproCall(bug));
      if (doFlag) flag(currentLine(bug.line));
    }
    if (!rng.chance(findChance)) {
      solvedAll = false;
      return;
    }
    if (nearMiss) {
      const wrong = wrongVersion(bug);
      if (wrong !== null) {
        lines[currentLine(bug.line) - 1] = wrong;
        if (sync()) run();
        lines[currentLine(bug.line) - 1] = cfg.buggyCode.split('\n')[bug.line - 1];
      }
    }
    fixBug(bug);
    if (cleanLogs && i === cfg.bugs.length - 1) removeLogs();
    sync();
    if (i < cfg.bugs.length - 1 || verify) run();
  });

  if (applied.length && revertDecoys) {
    for (const d of applied) {
      const near = currentLine(d.line);
      let idx = -1;
      lines.forEach((x, k) => {
        if (x === d.text && (idx < 0 || Math.abs(k + 1 - near) < Math.abs(idx + 1 - near))) idx = k;
      });
      if (idx >= 0) lines[idx] = cfg.buggyCode.split('\n')[d.line - 1];
    }
    if (sync() && verify) run();
  }
  if (cleanLogs && logLines) {
    removeLogs();
    if (sync() && verify) run();
  }

  // --- submit --------------------------------------------------------------
  const code = src();
  const results = runTests(cfg.tests, code);
  const target = cfg.bugs[0];
  let line = currentLine(target.line);
  let category: DiagnosisCategory = target.category;
  if (!rightDiagnosis) {
    if (rng.chance(0.5)) {
      const wrong = DIAGNOSIS_CATEGORIES.filter((c) => c.id !== target.category && !(target.accept ?? []).includes(c.id));
      category = rng.pick(wrong).id;
    } else {
      const far = Array.from({ length: lines.length }, (_, k) => k + 1).filter((n) => Math.abs(n - line) > 2);
      if (far.length) line = rng.pick(far);
    }
  }
  actions.push({
    type: 'submit_fix',
    payload: {
      code,
      results,
      diagnosis: {
        line: Math.max(1, Math.min(lines.length, line)),
        category,
        ...(rightDiagnosis && careful > 0.5 ? { explanation: `The value goes wrong on line ${line}.` } : {}),
      },
    },
  });
  return actions;
}
