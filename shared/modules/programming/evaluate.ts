/**
 * Evaluation, hints and debrief reveal for the Programming: Debugging module.
 * Deterministic: the same instance + log always produce the same evaluation.
 * SERVER-SIDE ONLY.
 */

import type {
  HintResult,
  LoggedAction,
  Metric,
  MistakeInstance,
  ModuleEvaluation,
  ScenarioInstance,
  SkillEvidence,
  StrengthInstance,
  TimelineEntry,
  Tone,
  Verdict,
} from '../../types.ts';
import type { BugDef, ProgConfig, ProgReveal, ProgState } from './types.ts';
import type { CodeChangeInfo } from './engine.ts';
import { codeHunks, debugInfo, functionAt, functionRanges, hunkSize, lineMapper } from './codeAnalysis.ts';
import { CATEGORY_LABELS, formatValue } from './grading.ts';
import { formatLines, minBugDistance } from './engine.ts';
import { clamp, listJoin, plural, round } from '../../util.ts';

type Ann = Record<string, any>;
const ann = (e: LoggedAction): Ann => (e.annotations ?? {}) as Ann;
const chg = (e: LoggedAction): Partial<CodeChangeInfo> => (ann(e).change ?? {}) as Partial<CodeChangeInfo>;
const isRun = (e: LoggedAction) => e.type === 'run_tests';
const isExp = (e: LoggedAction) => e.type === 'run_experiment';
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function bugLinesText(bugs: readonly BugDef[]): string {
  return bugs.length === 1 ? `line ${bugs[0].line}` : `lines ${listJoin(bugs.map((b) => String(b.line)))}`;
}

/** Everything evaluate() needs, derived from the log (+ annotations). */
function analyze(instance: ScenarioInstance<ProgConfig>, state: ProgState, log: LoggedAction[]) {
  const cfg = instance.config;
  const bugs = cfg.bugs;
  const entries = [...log].sort((a, b) => a.seq - b.seq);
  const runs = entries.filter(isRun);
  const exps = entries.filter(isExp);
  const flags = entries.filter((e) => e.type === 'flag_line');
  const resets = entries.filter((e) => e.type === 'reset_code');
  const submit = [...entries].reverse().find((e) => e.type === 'submit_fix') ?? null;
  const sa: Ann = submit ? ann(submit) : {};
  const finalCode: string = typeof submit?.payload?.code === 'string' ? submit.payload.code : state.code;
  const solved = submit !== null && sa.allPass === true;

  const firstFix = entries.find((e) => chg(e).fixChange === true) ?? null;
  const firstFixSeq = firstFix ? firstFix.seq : Number.POSITIVE_INFINITY;
  const before = (e: LoggedAction) => e.seq < firstFixSeq;
  const observedBeforeFix = entries.filter((e) => (isRun(e) || isExp(e)) && before(e));

  const failedAfterEdit = runs.filter((e) => ann(e).editedSinceLastRun && !ann(e).allPass && !ann(e).syntaxError);
  const offTargetFails = failedAfterEdit.filter((e) => !ann(e).changeSinceLastRunTouchesBug);
  let streak: number[] = [];
  let maxStreak: number[] = [];
  for (const e of entries) {
    if (isRun(e)) {
      const a = ann(e);
      if (a.editedSinceLastRun && !a.allPass && !a.syntaxError && !(a.logsCaptured > 0)) {
        streak = [...streak, e.seq];
        if (streak.length > maxStreak.length) maxStreak = streak;
      } else if (a.allPass || a.logsCaptured > 0) streak = [];
    } else if (isExp(e)) streak = [];
  }

  const finalHunks = codeHunks(cfg.buggyCode, finalCode);
  const offTargetFinal = finalHunks.filter((h) => minBugDistance(bugs, h) > 2);
  const linesChangedFinal = finalHunks.reduce((s, h) => s + hunkSize(h), 0);
  const leftover = debugInfo(finalCode);
  const leftoverCount = Math.max(0, leftover.count - debugInfo(cfg.buggyCode).count);
  const regressionRuns = runs.filter((e) => (ann(e).regressions ?? []).length > 0);
  const overfit = submit !== null && sa.visiblePassed === sa.visibleTotal && sa.hiddenPassed < sa.hiddenTotal;

  const reproRun = runs.find((e) => before(e) && ann(e).failed > 0) ?? null;
  const reproExp = exps.find((e) => before(e) && ann(e).reachesBug) ?? null;
  const evidenceFlag = flags.find((e) => before(e) && ann(e).flagged && ann(e).nearBug) ?? null;
  const evidenceExp = exps.find((e) => before(e) && ann(e).callsBuggyFunction) ?? null;
  const evidenceLogRun = runs.find((e) => before(e) && ann(e).logsCaptured > 0 && ann(e).instrumented) ?? null;
  const evidence = evidenceFlag ?? evidenceExp ?? evidenceLogRun;
  const firstFixOnTarget = firstFix !== null && chg(firstFix).touchesBugLines === true;
  const usefulExps = exps.filter((e) => (ann(e).calledFunctions ?? []).length > 0);

  let editSessions = 0;
  let inSession = false;
  for (const e of entries) {
    if (e.type === 'edit' || e.type === 'reset_code') {
      if (chg(e).codeChanged && !inSession) {
        editSessions++;
        inSession = true;
      }
    } else if (isRun(e) || isExp(e) || e.type === 'submit_fix') {
      if (chg(e).fixChange) editSessions++;
      inSession = false;
    }
  }

  const testName = (id: string) => cfg.tests.find((t) => t.id === id)?.name ?? id;
  return {
    cfg,
    bugs,
    entries,
    runs,
    exps,
    flags,
    resets,
    submit,
    sa,
    finalCode,
    solved,
    firstFix,
    firstFixSeq,
    observedBeforeFix,
    failedAfterEdit,
    offTargetFails,
    maxStreak,
    finalHunks,
    offTargetFinal,
    linesChangedFinal,
    leftover,
    leftoverCount,
    regressionRuns,
    overfit,
    reproRun,
    reproExp,
    evidence,
    evidenceFlag,
    evidenceExp,
    firstFixOnTarget,
    usefulExps,
    editSessions,
    testName,
  };
}

type Analysis = ReturnType<typeof analyze>;

const PENALTY: Record<string, number> = {
  'prog.edited_before_reproducing': 0.25,
  'prog.trial_and_error': 0.25,
  'prog.submitted_without_verifying': 0.2,
  'prog.leftover_debug_code': 0.06,
  'prog.overfit_to_tests': 0.15,
  'prog.misdiagnosed_root_cause': 0.08,
  'prog.gave_up_unsolved': 0.15,
  'prog.oversized_fix': 0.06,
};

function findMistakes(x: Analysis): MistakeInstance[] {
  const out: MistakeInstance[] = [];
  const { bugs, sa, submit } = x;
  const where = bugLinesText(bugs);

  if (x.firstFix && x.observedBeforeFix.length === 0) {
    const lines = chg(x.firstFix).changedLines ?? [];
    out.push({
      code: 'prog.edited_before_reproducing',
      count: 1,
      steps: [x.firstFix.seq],
      detail: `Changed ${lines.length ? `line ${formatLines(lines)}` : 'the code'} at step ${x.firstFix.seq} before running any test or experiment`,
    });
  }

  const trialSteps = x.offTargetFails.length >= 3 ? x.offTargetFails.map((e) => e.seq) : x.maxStreak.length >= 4 ? x.maxStreak : [];
  if (trialSteps.length) {
    out.push({
      code: 'prog.trial_and_error',
      count: trialSteps.length,
      steps: trialSteps,
      detail:
        x.offTargetFails.length >= 3
          ? `${trialSteps.length} test runs came right after edits that did not touch the faulty code (${where}), and each one still failed`
          : `${trialSteps.length} edit-and-rerun attempts in a row failed without any new evidence (no experiments or logging in between)`,
    });
  }

  if (x.offTargetFinal.length) {
    const lines = x.offTargetFinal.flatMap((h) => (h.ins.length ? h.ins : h.del));
    const steps = x.entries.filter((e) => (chg(e).offTargetLines ?? []).length > 0).map((e) => e.seq);
    out.push({
      code: 'prog.shotgun_changes',
      count: x.offTargetFinal.length,
      steps,
      detail: `The submitted code still changes line ${formatLines(lines)}, unrelated to the bug on ${where}`,
    });
  }

  if (submit && !sa.verified) {
    const lastRun = [...x.runs].reverse().find((e) => ann(e).fullSuite);
    out.push({
      code: 'prog.submitted_without_verifying',
      count: 1,
      steps: [submit.seq],
      detail: lastRun
        ? `Your last full test run (step ${lastRun.seq}) was before your final code change, so the submitted version was never tested`
        : x.runs.length
          ? 'You never ran the full visible test suite on the code you submitted'
          : 'You submitted without running the tests at all',
    });
  }

  if (x.leftoverCount > 0) {
    const steps = x.entries.filter((e) => (chg(e).logDelta ?? 0) > 0).map((e) => e.seq);
    out.push({
      code: 'prog.leftover_debug_code',
      count: x.leftoverCount,
      steps,
      detail: `${plural(x.leftoverCount, 'debug statement')} left in the submitted code (line ${formatLines(x.leftover.lines)})`,
    });
  }

  if (x.regressionRuns.length) {
    const first = x.regressionRuns[0];
    const names = (ann(first).regressions as string[]).map((id) => `"${x.testName(id)}"`);
    out.push({
      code: 'prog.introduced_regression',
      count: x.regressionRuns.length,
      steps: x.regressionRuns.map((e) => e.seq),
      detail: `${listJoin(names)} passed before but failed after your edit (step ${first.seq})`,
    });
  }

  if (submit && x.overfit) {
    const hiddenFail = (sa.failingIds as string[]).filter((id) => !x.cfg.tests.find((t) => t.id === id)?.visible);
    out.push({
      code: 'prog.overfit_to_tests',
      count: 1,
      steps: [submit.seq],
      detail: `All visible tests passed, but hidden edge-case test${hiddenFail.length === 1 ? '' : 's'} ${listJoin(
        hiddenFail.map((id) => `"${x.testName(id)}"`),
      )} failed`,
    });
  }

  if (submit && (!sa.categoryCorrect || !sa.lineCorrect)) {
    const d = submit.payload?.diagnosis ?? {};
    const b = bugs[0];
    out.push({
      code: 'prog.misdiagnosed_root_cause',
      count: 1,
      steps: [submit.seq],
      detail: `You diagnosed "${CATEGORY_LABELS[d.category as keyof typeof CATEGORY_LABELS] ?? d.category}" at line ${d.line}; the root cause was ${b.title.toLowerCase()} (${CATEGORY_LABELS[b.category]}) on line ${b.line}${
        bugs.length > 1 ? ` (and ${bugs[1].title.toLowerCase()} on line ${bugs[1].line})` : ''
      }`,
    });
  }

  if (submit && !x.solved && !x.overfit) {
    out.push({
      code: 'prog.gave_up_unsolved',
      count: 1,
      steps: [submit.seq],
      detail: `Submitted with ${sa.total - sa.passed} of ${sa.total} tests failing`,
    });
  }

  if (x.solved && x.offTargetFinal.length === 0 && x.linesChangedFinal > x.bugs.length + 3) {
    out.push({
      code: 'prog.oversized_fix',
      count: 1,
      steps: x.firstFix ? [x.firstFix.seq] : [],
      detail: `Changed ${x.linesChangedFinal} lines; the root cause needed ${plural(x.bugs.length, 'line')}`,
    });
  }
  return out;
}

function findStrengths(x: Analysis): StrengthInstance[] {
  const out: StrengthInstance[] = [];
  const { sa, submit } = x;
  if (x.reproRun) {
    const a = ann(x.reproRun);
    out.push({
      code: 'prog.reproduced_first',
      steps: [x.reproRun.seq],
      detail: `Ran the tests before changing any code and saw ${a.failed} of ${a.total} failing (step ${x.reproRun.seq}).`,
    });
  } else if (x.reproExp) {
    out.push({
      code: 'prog.reproduced_first',
      steps: [x.reproExp.seq],
      detail: `Called \`${clip(String(x.reproExp.payload?.expression ?? ''), 50)}\` in the console before editing (step ${x.reproExp.seq}).`,
    });
  }
  if (x.firstFix && x.firstFixOnTarget && x.evidence) {
    const e = x.evidence;
    const how =
      e.type === 'flag_line'
        ? `flagged line ${e.payload?.line}`
        : e.type === 'run_experiment'
          ? `tested \`${clip(String(e.payload?.expression ?? ''), 40)}\` in the console`
          : 'logged values on the failing path';
    out.push({
      code: 'prog.evidence_based',
      steps: [e.seq, x.firstFix.seq],
      detail: `You ${how} (step ${e.seq}) and your first code change (step ${x.firstFix.seq}) went straight to the faulty ${bugLinesText(x.bugs)}.`,
    });
  }
  if (x.solved && x.finalHunks.length > 0 && x.offTargetFinal.length === 0 && x.finalHunks.every((h) => minBugDistance(x.bugs, h) <= 1) && x.linesChangedFinal <= x.bugs.length + 2) {
    out.push({
      code: 'prog.minimal_fix',
      steps: x.firstFix ? [x.firstFix.seq] : [],
      detail: `Your final diff changes only ${plural(x.linesChangedFinal, 'line')}, right at the root cause.`,
    });
  }
  if (x.solved && submit && sa.verified && sa.lastFullRunAllPass) {
    out.push({
      code: 'prog.verified_fix',
      steps: sa.lastFullRunSeq ? [sa.lastFullRunSeq] : [],
      detail: `Re-ran all ${sa.visibleTotal} visible tests after your final edit${sa.lastFullRunSeq ? ` (step ${sa.lastFullRunSeq})` : ''} and saw them pass before submitting.`,
    });
  }
  if (x.usefulExps.length) {
    const e = x.usefulExps[0];
    out.push({
      code: 'prog.used_experiments',
      steps: x.usefulExps.map((u) => u.seq),
      detail: `Ran ${plural(x.usefulExps.length, 'console experiment')}, e.g. \`${clip(String(e.payload?.expression ?? ''), 50)}\` -> ${clip(String(e.observation?.value ?? e.observation?.error ?? ''), 40)}.`,
    });
  }
  if (submit && sa.categoryCorrect && sa.lineCorrect) {
    const d = submit.payload?.diagnosis ?? {};
    out.push({
      code: 'prog.correct_diagnosis',
      steps: [submit.seq],
      detail: `Diagnosed "${CATEGORY_LABELS[d.category as keyof typeof CATEGORY_LABELS] ?? d.category}" at line ${d.line}, matching the actual root cause.`,
    });
  }
  return out;
}

function processVerdict(x: Analysis, codes: Set<string>, processScore: number): { label: string; tone: Tone; explanation: string } {
  const sa = x.sa;
  if (!x.solved) {
    const failing = x.submit ? sa.total - sa.passed : x.cfg.tests.length;
    const how = codes.has('prog.overfit_to_tests')
      ? 'Your change satisfies the visible tests but not the hidden edge cases, so the root cause is still there.'
      : `${plural(failing, 'test')} still fail${failing === 1 ? 's' : ''}, so the reported bug is not fixed.`;
    const proc =
      processScore >= 0.75
        ? ' Your investigation habits were solid; keep tracing the failing input until the evidence points to one line.'
        : ' Next time, reproduce first, then gather evidence (console experiments, logs) before changing code.';
    return { label: 'Not solved', tone: 'danger', explanation: how + proc };
  }
  if (codes.has('prog.trial_and_error') || codes.has('prog.edited_before_reproducing')) {
    return {
      label: 'Correct fix, trial-and-error process',
      tone: 'warning',
      explanation: codes.has('prog.edited_before_reproducing')
        ? 'The final code works, but you changed it before reproducing the failure, so your early edits were guesses rather than evidence-based decisions. A correct answer reached by guessing does not reliably transfer to the next bug.'
        : 'The final code works, but you got there through repeated edit-and-rerun attempts away from the fault instead of gathering evidence first. A correct answer reached by guessing does not reliably transfer to the next bug.',
    };
  }
  if (codes.has('prog.submitted_without_verifying')) {
    return {
      label: 'Correct fix, unverified',
      tone: 'warning',
      explanation: 'Your fix passes, but you did not re-run the full test suite after your final edit, so you submitted without knowing it worked.',
    };
  }
  if (!sa.categoryCorrect) {
    return {
      label: 'Correct fix, root cause misidentified',
      tone: 'warning',
      explanation: 'The code now passes every test, but your diagnosis names a different kind of bug than the real root cause, which suggests the fix was not fully understood.',
    };
  }
  const polish = ['prog.shotgun_changes', 'prog.leftover_debug_code', 'prog.introduced_regression', 'prog.oversized_fix', 'prog.misdiagnosed_root_cause'];
  if (polish.some((c) => codes.has(c))) {
    return {
      label: 'Correct fix, process needs polish',
      tone: 'info',
      explanation: 'You reproduced and fixed the bug and verified it, but the submission was not clean (see the mistakes below). Effective debuggers leave a small, tidy diff.',
    };
  }
  return {
    label: 'Effective process',
    tone: 'success',
    explanation: 'You reproduced the failure, localized it with evidence, made a focused fix and verified it with the full test suite before submitting.',
  };
}

function skillEvidence(instance: ScenarioInstance<ProgConfig>, x: Analysis, codes: Set<string>): SkillEvidence[] {
  const W = instance.skillWeights;
  const out: SkillEvidence[] = [];
  const sa = x.sa;
  const trial = codes.has('prog.trial_and_error');
  const anyEvidence = !!(x.evidence || x.usefulExps.some((e) => e.seq < x.firstFixSeq));
  const push = (skillId: string, score: number, reasons: string[]) => {
    const weight = W[skillId] ?? 0;
    if (weight > 0) out.push({ skillId, score: round(clamp(score), 3), weight, reasons });
  };

  // Reproduce
  if (x.reproRun || x.reproExp) push('prog.reproduce', 1, ['Observed the failure before changing any code']);
  else if (x.runs.length) push('prog.reproduce', x.observedBeforeFix.length ? 0.7 : 0.45, ['Your first test run came after you had already changed code']);
  else push('prog.reproduce', 0.1, ['Never ran the tests to observe the failure']);

  // Trace
  {
    let score = 0.45;
    const reasons: string[] = [];
    if (anyEvidence) {
      score += 0.3;
      reasons.push('Inspected values with console experiments, logs or flags before fixing');
    } else reasons.push('Did not inspect any values before changing code');
    if (x.firstFixOnTarget) score += 0.25;
    if (trial) {
      score -= 0.3;
      reasons.unshift('Relied on guess-and-check edits instead of tracing values');
    }
    if (!x.firstFix) score = Math.min(score, 0.35);
    push('prog.trace', score, reasons);
  }

  // Localize
  {
    const reasons: string[] = [];
    const lineOk = x.submit !== null && sa.lineCorrect === true;
    const score =
      0.45 * (x.firstFixOnTarget ? 1 : 0) + 0.25 * (lineOk ? 1 : 0) + 0.15 * (x.offTargetFinal.length === 0 ? 1 : 0) + 0.15 * (x.evidence ? 1 : 0);
    reasons.push(x.firstFixOnTarget ? 'Your first code change went to the faulty line' : 'Your first code change missed the faulty line');
    reasons.push(lineOk ? 'Diagnosis pointed at the right line' : 'Diagnosis pointed at the wrong line');
    if (x.offTargetFinal.length) reasons.push('Unrelated lines were left changed');
    push('prog.localize', score, reasons);
  }

  // Verify
  {
    const reasons: string[] = [];
    let score: number;
    if (x.solved) {
      score = 0.45 + (sa.verified ? 0.25 : 0) + (x.regressionRuns.length ? 0 : 0.1) + (x.leftoverCount ? 0 : 0.1) + (x.offTargetFinal.length ? 0 : 0.1);
      reasons.push(sa.verified ? 'Re-ran the full suite after the final edit' : 'Did not re-run the full suite after the final edit');
      if (x.regressionRuns.length) reasons.push('Introduced a regression along the way');
      if (x.leftoverCount) reasons.push('Left debug logging in the code');
    } else {
      score = 0.1 + (sa.verified ? 0.15 : 0);
      reasons.push(x.overfit ? 'Fix only works for the visible tests' : 'Submitted code still fails tests');
    }
    push('prog.verify', score, reasons);
  }

  // Concepts: one evidence item per concept exercised by the injected bug(s)
  const results = (x.submit?.observation?.results ?? []) as Array<{ id: string; pass: boolean }>;
  const passes = (id: string) => results.some((r) => r.id === id && r.pass);
  const d = x.submit?.payload?.diagnosis ?? {};
  for (const concept of [...new Set(x.bugs.map((b) => b.conceptSkill))]) {
    const cBugs = x.bugs.filter((b) => b.conceptSkill === concept);
    const fixed = cBugs.every((b) => passes(b.repro)) && (x.solved || x.bugs.length > 1);
    const catOk = cBugs.some((b) => b.category === d.category || (b.accept ?? []).includes(d.category));
    const clean = x.offTargetFinal.length === 0 && !codes.has('prog.oversized_fix');
    const score = 0.45 * (fixed ? 1 : 0) + 0.35 * (catOk ? 1 : 0) + 0.2 * (fixed && clean ? 1 : 0);
    const b = cBugs[0];
    push(concept, score, [
      fixed ? `Fixed: ${b.title.toLowerCase()}` : `Not fixed: ${b.title.toLowerCase()}`,
      catOk ? `Named the right kind of bug (${CATEGORY_LABELS[b.category]})` : `Diagnosis category did not match (${CATEGORY_LABELS[b.category]})`,
    ]);
  }
  return out;
}

function timeline(x: Analysis, codes: Set<string>): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const where = bugLinesText(x.bugs);
  const shotgun = codes.has('prog.shotgun_changes');
  const trialSet = new Set(findTrialSeqs(x));
  let prevRun: Ann | null = null;
  const note = (seq: number, verdict: Verdict, text: string) => out.push({ seq, verdict, note: text });

  for (const e of x.entries) {
    const a = ann(e);
    const c = chg(e);
    switch (e.type) {
      case 'run_tests': {
        const counts = `${a.failed} of ${a.total} failing`;
        if (a.syntaxError) note(e.seq, 'wasted', 'Ran the tests, but the code had a syntax error, so no test could run.');
        else if (!a.editedSinceLastRun) {
          if (!prevRun && a.isReproduction) note(e.seq, 'good', `Ran the tests before editing: reproduced the failure (${counts}).`);
          else if (!prevRun) note(e.seq, 'info', `Ran ${a.total === 1 ? 'a single test' : 'the tests'}: ${counts}.`);
          else if (a.logsCaptured > 0 && a.instrumented)
            note(e.seq, e.seq < x.firstFixSeq ? 'good' : 'info', `Re-ran with console.log instrumentation and captured ${plural(a.logsCaptured, 'log line')} from the failing path.`);
          else note(e.seq, 'wasted', `Re-ran the tests without changing the code, so the results could not change (${counts}).`);
        } else if (a.allPass && a.fullSuite) note(e.seq, 'good', `Verified the change: all ${a.total} visible tests pass.`);
        else if (a.allPass) note(e.seq, 'info', `The ${plural(a.total, 'selected test')} pass now; the full suite still needed a run.`);
        else if ((a.regressions ?? []).length)
          note(e.seq, 'mistake', `Your edit broke ${listJoin((a.regressions as string[]).map((id) => `"${x.testName(id)}"`))}, which passed before (${counts}).`);
        else if (!a.changeSinceLastRunTouchesBug)
          note(e.seq, trialSet.has(e.seq) ? 'mistake' : 'wasted', `Re-ran after changing code away from the fault (${where}): still ${counts}.`);
        else if (prevRun && a.failed < prevRun.failed) note(e.seq, 'info', `Progress: failures dropped from ${prevRun.failed} to ${a.failed} after editing near the fault.`);
        else note(e.seq, trialSet.has(e.seq) ? 'mistake' : 'wasted', `Edited near the fault, but the tests still fail (${counts}); that change did not fix the root cause.`);
        prevRun = a;
        break;
      }
      case 'run_experiment': {
        const expr = clip(String(e.payload?.expression ?? ''), 50);
        const val = clip(String(e.observation?.value ?? ''), 40);
        if (a.timedOut) note(e.seq, 'neutral', `\`${expr}\` timed out (possible infinite loop).`);
        else if (!a.ok) note(e.seq, 'neutral', `\`${expr}\` threw ${clip(String(e.observation?.error ?? 'an error'), 60)}.`);
        else if (a.callsBuggyFunction && e.seq < x.firstFixSeq) note(e.seq, 'good', `Tested a hypothesis in the console: \`${expr}\` -> ${val}.`);
        else if (a.callsBuggyFunction) note(e.seq, 'info', `Checked \`${expr}\` -> ${val} in the console.`);
        else if (a.reachesBug) note(e.seq, 'info', `Explored \`${expr}\` -> ${val}; this call runs through the faulty function.`);
        else if ((a.calledFunctions ?? []).length) note(e.seq, 'info', `Explored \`${expr}\` -> ${val}; that function is correct, so this helps rule it out.`);
        else note(e.seq, 'neutral', `Evaluated \`${expr}\` -> ${val}.`);
        break;
      }
      case 'edit': {
        const lines = c.changedLines ?? [];
        const at = lines.length ? `line ${formatLines(lines)}` : 'the code';
        if (c.changeKind === 'logs_added') note(e.seq, e.seq < x.firstFixSeq ? 'good' : 'neutral', `Added console.log on ${at} to inspect values.`);
        else if (c.changeKind === 'logs_removed') note(e.seq, 'good', 'Removed debug logging.');
        else if (c.changeKind !== 'code') note(e.seq, 'neutral', 'Formatting or comment change only; no code behavior changed.');
        else if (a.beforeAnyRun && a.firstFix) note(e.seq, 'mistake', `Changed ${at} before running any test or experiment.`);
        else if (c.touchesBugLines) note(e.seq, 'good', `Edited ${at}, at the faulty ${where}.`);
        else if ((c.offTargetLines ?? []).length)
          note(e.seq, shotgun ? 'mistake' : 'wasted', `Changed line ${formatLines(c.offTargetLines ?? [])}, which is unrelated to the fault on ${where}.`);
        else note(e.seq, 'neutral', `Edited ${at}, close to the fault on ${where}.`);
        break;
      }
      case 'flag_line': {
        if (a.flagged === false) note(e.seq, 'neutral', `Removed the flag from line ${a.line}.`);
        else if (a.distance === 0) note(e.seq, 'good', `Flagged line ${a.line}, the faulty line: good localization.`);
        else if (a.distance === 1) note(e.seq, 'good', `Flagged line ${a.line}, right next to the faulty line.`);
        else if (a.distance <= 3) note(e.seq, 'info', `Flagged line ${a.line}, close to the faulty ${where}.`);
        else note(e.seq, 'neutral', `Flagged line ${a.line}; the fault was on ${where}.`);
        break;
      }
      case 'reset_code':
        note(e.seq, 'neutral', `Reset the code to the original, discarding ${plural(a.discardedLines ?? 0, 'changed line')}.`);
        break;
      case 'submit_fix': {
        const tail = a.verified ? '' : ' The submitted version was never run through the full test suite.';
        if (a.allPass && a.categoryCorrect && a.lineCorrect) note(e.seq, 'good', `Submitted a fix that passes all ${a.total} tests with a correct diagnosis.${tail}`);
        else if (a.allPass) note(e.seq, 'info', `Submitted a passing fix, but the diagnosis missed the root cause on ${where}.${tail}`);
        else if (x.overfit) note(e.seq, 'mistake', `Submitted: visible tests pass, but ${a.hiddenTotal - a.hiddenPassed} hidden edge-case test(s) fail.${tail}`);
        else note(e.seq, 'mistake', `Submitted with ${a.total - a.passed} of ${a.total} tests failing.${tail}`);
        break;
      }
      case 'hint': {
        const level = Number(e.payload?.level ?? 1);
        note(e.seq, 'info', `Used hint level ${level} (${['strategy', 'localization', 'specific line'][Math.min(3, Math.max(1, level)) - 1]}).`);
        break;
      }
      default:
        note(e.seq, 'neutral', e.type.replace(/_/g, ' '));
    }
  }
  return out;
}

function findTrialSeqs(x: Analysis): number[] {
  if (x.offTargetFails.length >= 3) return x.offTargetFails.map((e) => e.seq);
  if (x.maxStreak.length >= 4) return x.maxStreak;
  return [];
}

function metrics(x: Analysis): Metric[] {
  const sa = x.sa;
  return [
    {
      key: 'failed_fix_attempts',
      label: 'Failed fix attempts',
      value: x.failedAfterEdit.length,
      benchmark: x.bugs.length - 1,
      benchmarkLabel: 'Expert',
      better: 'lower',
    },
    { key: 'lines_changed', label: 'Lines changed', value: x.linesChangedFinal, benchmark: x.bugs.length, benchmarkLabel: 'Minimal fix', better: 'lower' },
    { key: 'test_runs', label: 'Test runs', value: x.runs.length, benchmark: x.bugs.length + 1, benchmarkLabel: 'Expert', better: 'lower' },
    { key: 'experiments', label: 'Console experiments', value: x.exps.length, benchmark: x.bugs.length, benchmarkLabel: 'Expert', better: 'higher' },
    {
      key: 'time_to_first_edit',
      label: 'Time to first code change',
      value: x.firstFix ? Math.round(x.firstFix.t / 1000) : 'none',
      unit: x.firstFix ? 's' : undefined,
    },
    { key: 'tests_passing', label: 'Tests passing at submit', value: x.submit ? `${sa.passed}/${sa.total}` : `0/${x.cfg.tests.length}` },
    { key: 'hidden_tests', label: 'Hidden edge-case tests', value: x.submit ? `${sa.hiddenPassed}/${sa.hiddenTotal}` : 'not run' },
    { key: 'debug_left', label: 'Debug statements left', value: x.leftoverCount, benchmark: 0, benchmarkLabel: 'Expert', better: 'lower' },
  ];
}

function expertPath(x: Analysis): { summary: string; steps: string[] } {
  const ranges = functionRanges(x.cfg.referenceCode);
  const steps: string[] = [];
  const repro = x.bugs.map((b) => {
    const t = x.cfg.tests.find((tt) => tt.id === b.repro);
    return { b, t, fn: functionAt(ranges, b.line)?.name ?? 'the function' };
  });
  steps.push(
    `Run all tests before touching the code: ${listJoin(
      repro.map((r) => `"${r.t?.name ?? r.b.repro}" fails (expected ${r.t ? formatValue(r.t.expected) : '?'}, got ${r.b.actual})`),
    )}.`,
  );
  for (const r of repro) {
    steps.push(`Form a hypothesis: the wrong value comes from \`${r.fn}()\`. Confirm it in the console with \`${r.t?.call ?? r.fn + '(...)'}\`.`);
    steps.push(`Trace it: ${r.b.probe} The values go wrong at line ${r.b.line}.`);
    steps.push(`Fix line ${r.b.line} minimally: \`${r.b.buggyLine}\` becomes \`${r.b.fixedLine}\`.`);
    if (x.bugs.length > 1) steps.push('Re-run the tests to confirm this bug is gone before hunting the next one.');
  }
  steps.push(
    `Re-run the full suite: everything passes with no regressions. Remove any console.log, then submit "${CATEGORY_LABELS[x.bugs[0].category]}" at line ${x.bugs[0].line}.`,
  );
  return { summary: `Reproduce, trace, fix ${x.bugs.length === 1 ? 'one line' : 'two lines'}, verify`, steps };
}

export function evaluate(instance: ScenarioInstance<ProgConfig>, state: ProgState, log: LoggedAction[]): ModuleEvaluation {
  const x = analyze(instance, state, log);
  const mistakes = findMistakes(x);
  const codes = new Set(mistakes.map((m) => m.code));
  const strengths = findStrengths(x);
  const sa = x.sa;

  let process = 1;
  for (const m of mistakes) {
    if (m.code === 'prog.shotgun_changes') process -= Math.min(0.2, 0.07 * m.count);
    else if (m.code === 'prog.introduced_regression') process -= Math.min(0.12, 0.06 * m.count);
    else if (m.code === 'prog.misdiagnosed_root_cause') process -= sa.categoryCorrect || sa.lineCorrect ? 0.04 : PENALTY[m.code];
    else if (m.code === 'prog.submitted_without_verifying') process -= x.runs.length ? PENALTY[m.code] : 0.3;
    else process -= PENALTY[m.code] ?? 0.05;
  }
  if (x.runs.length === 0 && x.exps.length === 0) process = Math.min(process, 0.3);
  process = round(clamp(process), 3);

  const testsShare = x.submit ? (x.solved ? 1 : (sa.passed ?? 0) / Math.max(1, sa.total ?? 1)) : 0;
  const accuracy = round(clamp(0.6 * testsShare + 0.25 * (sa.categoryCorrect ? 1 : 0) + 0.15 * (sa.lineCorrect ? 1 : 0)), 3);

  const expertCost = 1 + 3 * x.bugs.length;
  const expAllowance = 2 * x.bugs.length;
  const learnerCost =
    x.runs.length + x.editSessions + x.resets.length + Math.min(x.exps.length, expAllowance) + 0.5 * Math.max(0, x.exps.length - expAllowance);
  const ratio = expertCost / Math.max(expertCost, learnerCost);
  const extraFails = Math.max(0, x.failedAfterEdit.length - (x.bugs.length - 1));
  let efficiency = clamp(ratio ** 0.7 - 0.08 * extraFails, 0.05, 1);
  if (!x.solved) efficiency = Math.min(efficiency, 0.5);
  efficiency = round(efficiency, 3);

  const pv = processVerdict(x, codes, process);
  const outcomeLabel = x.solved
    ? x.bugs.length > 1
      ? 'Both bugs fixed'
      : 'Bug fixed'
    : !x.submit
      ? 'Not submitted'
      : x.overfit
        ? 'Visible tests pass, hidden edge cases fail'
        : 'Bug not fixed';

  return {
    solved: x.solved,
    outcomeLabel,
    accuracy,
    process,
    efficiency,
    safety: null,
    processVerdict: pv,
    skillEvidence: skillEvidence(instance, x, codes),
    mistakes,
    strengths,
    metrics: metrics(x),
    timeline: timeline(x, codes),
    groundTruth: {
      summary:
        x.bugs.length === 1
          ? `Bug: ${x.bugs[0].title} on line ${x.bugs[0].line}`
          : `Bugs: ${x.bugs.map((b) => `${b.title} on line ${b.line}`).join('; ')}`,
      details: x.bugs.flatMap((b) => [
        b.explanation,
        `Line ${b.line} was: \`${b.buggyLine}\``,
        `Fix: \`${b.fixedLine}\` (${CATEGORY_LABELS[b.category]})`,
      ]),
    },
    expertPath: expertPath(x),
  };
}

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

export function hint(instance: ScenarioInstance<ProgConfig>, state: ProgState, _log: LoggedAction[], level: number): HintResult {
  const cfg = instance.config;
  const lvl = Math.min(3, Math.max(1, Math.round(Number.isFinite(level) ? level : 1)));
  const target = cfg.bugs.find((b) => state.testStatus[b.repro] !== true) ?? cfg.bugs[0];
  const repro = cfg.tests.find((t) => t.id === target.repro);
  const ranges = functionRanges(cfg.buggyCode);
  const fn = functionAt(ranges, target.line);
  const toCurrent = lineMapper(cfg.buggyCode, state.code);
  const cur = (line: number) => toCurrent(line) ?? line;
  const two = cfg.bugs.length > 1 ? 'This file has two separate bugs; fix and verify them one at a time. ' : '';
  let text: string;
  if (lvl === 1) {
    if (state.counts.runs === 0) {
      text = `${two}Start by running all the tests before changing anything. Which tests fail? Compare expected vs actual, and look at what the failing inputs have in common.`;
    } else if (state.lastRun && state.lastRun.failed > 0) {
      const names = state.lastRun.results.filter((r) => !r.pass).map((r) => `"${cfg.tests.find((t) => t.id === r.id)?.name ?? r.id}"`);
      text = `${two}Focus on the failing test${names.length === 1 ? '' : 's'}: ${listJoin(names.slice(0, 3))}. Write down what was expected and what came back, then form a hypothesis about which function produces the first wrong value and test it in the console${
        repro ? ` (for example \`${repro.call}\`)` : ''
      }.`;
    } else {
      text = 'All visible tests pass. Make sure you re-ran the full suite after your last edit, remove any console.log calls, then submit with your diagnosis.';
    }
  } else if (lvl === 2) {
    const range = fn ? ` (around lines ${cur(fn.start)}-${cur(fn.end)})` : '';
    text = `${two}The problem is inside \`${fn?.name ?? 'the function under test'}()\`${range}. ${target.probe}`;
  } else {
    const line = cur(target.line);
    const current = state.code.split('\n')[line - 1]?.trim() || target.buggyLine;
    text = `Look closely at line ${line}: \`${current}\`. ${target.examine}`;
  }
  return { level: lvl, maxLevel: 3, text };
}

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

export function reveal(instance: ScenarioInstance<ProgConfig>, state: ProgState): ProgReveal {
  const cfg = instance.config;
  return {
    fileName: cfg.fileName,
    originalCode: cfg.buggyCode,
    finalCode: state.submitted?.code ?? state.code,
    referenceCode: cfg.referenceCode,
    bugs: cfg.bugs.map((b) => ({
      line: b.line,
      title: b.title,
      category: b.category,
      categoryLabel: CATEGORY_LABELS[b.category],
      buggyLine: b.buggyLine,
      fixedLine: b.fixedLine,
      explanation: b.explanation,
    })),
  };
}
