/**
 * Programming: Debugging module tests (self-contained: executes code with node:vm).
 * Run: node --disable-warning=ExperimentalWarning --test tests/programming.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import type { ExecResult, LoggedAction, ModuleAction, ScenarioInstance } from '../shared/types.ts';
import { createRng } from '../shared/rng.ts';
import { programmingModule as mod } from '../shared/modules/programming/index.ts';
import type { ProgConfig, ProgState, TestCase } from '../shared/modules/programming/types.ts';
import { formatLogArgs, formatValue, gradeTests } from '../shared/modules/programming/grading.ts';
import { TEMPLATE_DATA, TEMPLATE_DATA_BY_ID, injectBugs } from '../shared/modules/programming/templates/index.ts';
import { generateVariant } from '../shared/modules/programming/engine.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function vmExec(code: string, expressions: string[]): ExecResult[] {
  return expressions.map((expr) => {
    const logs: string[] = [];
    const log = (...args: unknown[]) => logs.push(formatLogArgs(args));
    const context = vm.createContext({ console: { log, info: log, warn: log, error: log, debug: log, table: log } });
    try {
      vm.runInContext(code, context, { timeout: 1000 });
      const value = vm.runInContext(`(${expr})`, context, { timeout: 1000 });
      return { ok: true, value, logs };
    } catch (e) {
      const err = e as { name?: string; message?: string };
      const message = String(err?.message ?? e);
      return { ok: false, error: `${err?.name ?? 'Error'}: ${message}`, logs, timedOut: /timed out/i.test(message) };
    }
  });
}

type Inst = ScenarioInstance<ProgConfig>;
type Step = ModuleAction | { type: 'hint'; payload: { level: number } };

function play(instance: Inst, actions: Step[]): { state: ProgState; log: LoggedAction[]; completed: boolean } {
  let state = mod.initialState(instance) as ProgState;
  const log: LoggedAction[] = [];
  let completed = false;
  for (const action of actions) {
    const seq = log.length + 1;
    const t = seq * 7000;
    if (action.type === 'hint') {
      log.push({ seq, t, type: 'hint', payload: action.payload, observation: null, annotations: {} });
      continue;
    }
    const res = mod.applyAction(instance, state, action, { seq, t });
    if (res.error) throw new Error(`Action ${seq} (${action.type}) rejected: ${res.error}`);
    // Round-trip through JSON like the server's storage would.
    state = JSON.parse(JSON.stringify(res.state));
    log.push(JSON.parse(JSON.stringify({ seq, t, type: action.type, payload: action.payload ?? {}, observation: res.observation ?? null, annotations: res.annotations ?? {} })));
    if (res.complete) {
      completed = true;
      break;
    }
  }
  return { state, log, completed };
}

const visibleOf = (cfg: ProgConfig) => cfg.tests.filter((t) => t.visible);
const results = (code: string, tests: TestCase[]) => gradeTests(tests, vmExec(code, tests.map((t) => t.call)));
const runAction = (cfg: ProgConfig, code: string): ModuleAction => ({
  type: 'run_tests',
  payload: { code, scope: 'all', testIds: visibleOf(cfg).map((t) => t.id), results: results(code, visibleOf(cfg)) },
});
const submitAction = (cfg: ProgConfig, code: string, line: number, category: string): ModuleAction => ({
  type: 'submit_fix',
  payload: { code, results: results(code, cfg.tests), diagnosis: { line, category } },
});
const template = (id: string) => TEMPLATE_DATA_BY_ID.get(id)!.template;
const replaceLine = (code: string, line: number, text: string) => {
  const lines = code.split('\n');
  lines[line - 1] = text;
  return lines.join('\n');
};

function expertActions(instance: Inst): Step[] {
  const cfg = instance.config;
  const ref = cfg.referenceCode.split('\n');
  let code = cfg.buggyCode;
  const acts: Step[] = [runAction(cfg, code)];
  for (const bug of cfg.bugs) {
    const repro = cfg.tests.find((t) => t.id === bug.repro)!;
    const [r] = vmExec(code, [repro.call]);
    acts.push({ type: 'run_experiment', payload: { code, expression: repro.call, result: { ok: r.ok, value: formatValue(r.value), logs: r.logs } } });
    acts.push({ type: 'flag_line', payload: { line: bug.line, flagged: true } });
    code = replaceLine(code, bug.line, ref[bug.line - 1]);
    acts.push({ type: 'edit', payload: { code } });
    acts.push(runAction(cfg, code));
  }
  acts.push(submitAction(cfg, code, cfg.bugs[0].line, cfg.bugs[0].category));
  return acts;
}

// ---------------------------------------------------------------------------
// Module contract
// ---------------------------------------------------------------------------

test('module shape follows the SkillModule contract', () => {
  assert.equal(mod.id, 'programming');
  assert.equal(mod.name, 'Programming: Debugging');
  assert.equal(mod.color, '#7C5CFF');
  assert.equal(mod.icon, 'code');
  assert.equal(mod.submitActionType, 'submit_fix');
  assert.deepEqual(
    mod.skills.map((s) => s.id).sort(),
    ['prog.boundaries', 'prog.localize', 'prog.logic', 'prog.reproduce', 'prog.state', 'prog.trace', 'prog.verify'],
  );
  assert.ok(mod.templates.length >= 6);
  for (const t of mod.templates) {
    assert.ok(t.id.startsWith('prog.'));
    assert.equal(t.moduleId, 'programming');
    assert.ok(t.variantCount >= 6, `${t.id} variantCount`);
    for (const s of Object.keys(t.skillWeights)) assert.ok(mod.skills.some((k) => k.id === s), `${t.id}: unknown skill ${s}`);
    for (const s of t.focusable) assert.ok((t.skillWeights[s] ?? 0) > 0, `${t.id}: focusable ${s} not weighted`);
  }
  for (const code of Object.keys(mod.mistakes)) assert.ok(code.startsWith('prog.') && mod.mistakes[code].code === code);
  for (const code of Object.keys(mod.strengths)) assert.ok(code.startsWith('prog.') && mod.strengths[code].code === code);
  for (const code of ['prog.reproduced_first', 'prog.evidence_based', 'prog.minimal_fix', 'prog.verified_fix']) assert.ok(mod.strengths[code], code);
  assert.ok(mod.knowledge.length >= 8);
  for (const fn of ['reveal', 'simulateLearner'] as const) assert.equal(typeof mod[fn], 'function');
});

// ---------------------------------------------------------------------------
// Template data integrity
// ---------------------------------------------------------------------------

for (const data of TEMPLATE_DATA) {
  const { spec, bugs } = data;
  test(`${spec.id}: reference passes every test`, () => {
    const failing = results(spec.code, spec.tests).filter((r) => !r.pass).map((r) => `${r.id} -> ${r.actual || r.error}`);
    assert.deepEqual(failing, []);
    assert.ok(spec.tests.filter((t) => t.visible).length >= 4);
    assert.ok(spec.tests.filter((t) => !t.visible).length >= 1);
    assert.equal(new Set(spec.tests.map((t) => t.id)).size, spec.tests.length);
  });

  test(`${spec.id}: every bug preserves lines and fails a visible test with the documented symptom`, () => {
    const refLines = spec.code.split('\n');
    assert.ok(refLines.length >= 10 && refLines.length <= 32, `${spec.id} has ${refLines.length} lines`);
    assert.equal(new Set(bugs.map((b) => b.id)).size, bugs.length);
    for (const bug of bugs) {
      const line = refLines[bug.line - 1] ?? '';
      assert.equal(line.split(bug.find).length - 1, 1, `${bug.id}: find must occur exactly once on line ${bug.line}: ${line}`);
      const buggy = injectBugs(spec.code, [bug]);
      assert.equal(buggy.split('\n').length, refLines.length, `${bug.id}: line count changed`);
      assert.notEqual(buggy, spec.code, `${bug.id}: no change`);
      const visible = spec.tests.filter((t) => t.visible);
      const res = results(buggy, visible);
      assert.ok(res.some((r) => !r.pass), `${bug.id}: no visible test fails`);
      const repro = spec.tests.find((t) => t.id === bug.repro);
      assert.ok(repro && repro.visible, `${bug.id}: repro must be a visible test`);
      const r = res.find((x) => x.id === bug.repro)!;
      assert.equal(r.pass, false, `${bug.id}: repro ${bug.repro} passes`);
      assert.equal(r.actual, bug.actual, `${bug.id}: repro actual mismatch`);
      assert.equal(bug.fixedLine, line.trim());
      assert.ok(bug.subtlety >= 1 && bug.subtlety <= 5);
    }
  });

  if (spec.difficultyRange[1] >= 4) {
    test(`${spec.id}: two-bug variants are valid and keep their documented symptoms`, () => {
      const pairs = data.variants.filter((x) => x.bugs.length === 2);
      assert.equal(pairs.length, (spec.pairs ?? []).length, 'every listed pair must resolve');
      for (const v of pairs) {
        assert.notEqual(v.bugs[0].line, v.bugs[1].line);
        const code = injectBugs(spec.code, v.bugs);
        assert.equal(code.split('\n').length, spec.code.split('\n').length);
        for (const bug of v.bugs) {
          const repro = spec.tests.find((t) => t.id === bug.repro)!;
          const [exec] = vmExec(code, [repro.call]);
          assert.equal(exec.ok ? formatValue(exec.value) : exec.error, bug.actual, `${v.id}: ${bug.id} symptom changed`);
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

test('generate() is deterministic and varied', () => {
  const t = template('prog.gradebook');
  const a = mod.generate(t, { seed: 42, difficulty: 2 });
  const b = mod.generate(t, { seed: 42, difficulty: 2 });
  assert.deepEqual(a, b);
  const seen = new Set<string>();
  for (let s = 1; s <= 60; s++) seen.add(mod.generate(t, { seed: s, difficulty: 2 }).variantId);
  assert.ok(seen.size >= 3, `only ${seen.size} variants`);
  assert.equal(a.config.buggyCode.split('\n').length, a.config.referenceCode.split('\n').length);
});

test('generate() honors focusSkills', () => {
  const t = template('prog.username');
  const logicShare = (focusSkills?: string[]) => {
    let hits = 0;
    for (let s = 1; s <= 300; s++) {
      const inst = mod.generate(t, { seed: s, difficulty: 2, focusSkills });
      if (inst.config.bugs.some((b) => b.conceptSkill === 'prog.logic')) hits++;
    }
    return hits / 300;
  };
  const base = logicShare();
  const focused = logicShare(['prog.logic']);
  assert.ok(focused > base + 0.1, `focus ${focused} vs base ${base}`);
  const inst = mod.generate(t, { seed: 3, difficulty: 2, focusSkills: ['prog.logic', 'elec.voltage'] });
  assert.deepEqual(inst.focusSkills, ['prog.logic']);
});

test('generate() avoids recently seen variants', () => {
  for (const data of TEMPLATE_DATA) {
    for (let s = 1; s <= 10; s++) {
      const d = data.template.difficultyRange[0];
      const first = mod.generate(data.template, { seed: s, difficulty: d });
      const second = mod.generate(data.template, { seed: s, difficulty: d, avoidVariants: [first.variantId] });
      assert.notEqual(second.variantId, first.variantId, `${data.template.id} seed ${s}`);
    }
  }
});

test('difficulty >= 4 can inject two bugs; weights follow the injected bugs', () => {
  let twoBug = 0;
  for (const id of ['prog.inventory', 'prog.streak', 'prog.cart', 'prog.sensor']) {
    const t = template(id);
    for (let s = 1; s <= 40; s++) {
      for (const d of [t.difficultyRange[0], t.difficultyRange[1]]) {
        const inst = mod.generate(t, { seed: s, difficulty: d });
        const concepts = new Set(inst.config.bugs.map((b) => b.conceptSkill));
        for (const c of ['prog.boundaries', 'prog.logic', 'prog.state']) {
          if (concepts.has(c as never)) assert.ok(inst.skillWeights[c] >= 0.8, `${inst.variantId} ${c}`);
          else assert.ok((inst.skillWeights[c] ?? 0) <= 0.2, `${inst.variantId} ${c} should be reduced`);
        }
        if (inst.config.bugs.length === 2) {
          twoBug++;
          assert.ok(d >= 4);
          assert.notEqual(inst.config.bugs[0].line, inst.config.bugs[1].line);
          assert.ok(inst.variantId.includes('+'));
        }
      }
    }
  }
  assert.ok(twoBug > 20, `only ${twoBug} two-bug instances`);
  for (let s = 1; s <= 30; s++) assert.equal(mod.generate(template('prog.gradebook'), { seed: s, difficulty: 3 }).config.bugs.length, 1);
});

test('publicScenario() never leaks bug definitions or the reference code', () => {
  for (const data of TEMPLATE_DATA) {
    for (const v of data.variants) {
      const inst = generateVariant(data.template, v.id, { seed: 5, difficulty: data.template.difficultyRange[1] });
      const pub = mod.publicScenario(inst);
      const json = JSON.stringify(pub);
      const view = pub.view as { code: string; tests: unknown[] };
      assert.equal(view.code, inst.config.buggyCode);
      assert.equal(view.tests.length, inst.config.tests.length);
      assert.ok(!json.includes(inst.config.referenceCode));
      for (const key of ['explanation', 'fixedLine', 'probe', 'examine', 'referenceCode', 'subtlety']) assert.ok(!json.includes(`"${key}"`), key);
      for (const b of inst.config.bugs) assert.ok(!json.includes(b.explanation));
      assert.deepEqual(pub.skillWeights, data.template.skillWeights, 'public weights must not reveal the bug concept');
    }
  }
});

// ---------------------------------------------------------------------------
// Scripted attempts
// ---------------------------------------------------------------------------

test('expert sequence: solved, effective process, all key strengths', () => {
  for (const data of TEMPLATE_DATA) {
    for (const v of data.variants) {
      const inst = generateVariant(data.template, v.id, { seed: 11, difficulty: data.template.difficultyRange[1] });
      const steps = expertActions(inst);
      steps.splice(1, 0, { type: 'hint', payload: { level: 1 } });
      const { state, log, completed } = play(inst, steps);
      assert.ok(completed);
      const ev = mod.evaluate(inst, state, log);
      const label = `${data.template.id}/${v.id}`;
      assert.equal(ev.solved, true, label);
      assert.deepEqual(ev.mistakes.map((m) => m.code), [], label);
      assert.ok(ev.process >= 0.9, `${label} process ${ev.process}`);
      assert.ok(ev.accuracy >= 0.99, `${label} accuracy ${ev.accuracy}`);
      assert.ok(ev.efficiency >= 0.9, `${label} efficiency ${ev.efficiency}`);
      assert.equal(ev.processVerdict.tone, 'success', label);
      const codes = ev.strengths.map((s) => s.code);
      for (const c of ['prog.reproduced_first', 'prog.evidence_based', 'prog.minimal_fix', 'prog.verified_fix', 'prog.used_experiments', 'prog.correct_diagnosis']) {
        assert.ok(codes.includes(c), `${label} missing ${c}`);
      }
      assert.equal(ev.timeline.length, log.length);
      assert.deepEqual(ev.timeline.map((e) => e.seq), log.map((e) => e.seq));
      for (const e of ev.timeline) assert.ok(e.note.length > 10, `${label} empty note`);
      assert.equal(ev.safety, null);
      assert.ok(ev.groundTruth.summary.includes(`line ${inst.config.bugs[0].line}`));
      assert.ok(ev.expertPath && ev.expertPath.steps.length >= 4);
      for (const e of ev.skillEvidence) {
        assert.equal(e.weight, inst.skillWeights[e.skillId]);
        assert.ok(e.score >= 0 && e.score <= 1 && e.reasons.length > 0);
      }
      for (const b of inst.config.bugs) assert.ok(ev.skillEvidence.some((e) => e.skillId === b.conceptSkill && e.weight >= 0.8));
      assert.equal(typeof ev.metrics[0].benchmark, 'number');
      assert.deepEqual(mod.evaluate(inst, state, log), ev, 'evaluate must be deterministic');
      assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
    }
  }
});

test('shotgun sequence: edits first, guesses, leaves junk, submits unverified', () => {
  const inst = generateVariant(template('prog.gradebook'), 'loop-bound', { seed: 1, difficulty: 2 });
  const cfg = inst.config;
  let code = cfg.buggyCode;
  const steps: Step[] = [];
  code = replaceLine(code, 16, "  if (avg >= 80) return \"B\";");
  steps.push({ type: 'edit', payload: { code } }, runAction(cfg, code));
  code = replaceLine(code, 23, '  let avg = average(scores);');
  steps.push({ type: 'edit', payload: { code } }, runAction(cfg, code));
  code = replaceLine(code, 18, "  if (avg >= 60) { return 'D'; }");
  steps.push({ type: 'edit', payload: { code } }, runAction(cfg, code));
  const lines = code.split('\n');
  lines[7] = '  for (let i = 0; i < scores.length; i++) {';
  lines.splice(9, 0, "    console.log('sum', sum);");
  code = lines.join('\n');
  steps.push({ type: 'edit', payload: { code } });
  steps.push(submitAction(cfg, code, 12, 'wrong_initial_value'));
  const { state, log } = play(inst, steps);
  const ev = mod.evaluate(inst, state, log);
  const codes = ev.mistakes.map((m) => m.code);
  for (const c of [
    'prog.edited_before_reproducing',
    'prog.trial_and_error',
    'prog.shotgun_changes',
    'prog.submitted_without_verifying',
    'prog.leftover_debug_code',
    'prog.misdiagnosed_root_cause',
  ]) {
    assert.ok(codes.includes(c), `missing ${c}; got ${codes.join(', ')}`);
  }
  assert.equal(ev.solved, true);
  assert.equal(ev.processVerdict.label, 'Correct fix, trial-and-error process');
  assert.equal(ev.processVerdict.tone, 'warning');
  assert.ok(ev.process < 0.4, `process ${ev.process}`);
  assert.ok(!ev.strengths.some((s) => ['prog.minimal_fix', 'prog.verified_fix', 'prog.reproduced_first'].includes(s.code)));
  assert.ok(ev.timeline.some((e) => e.verdict === 'mistake'));
});

test('unsolved and overfit submissions are detected', () => {
  const inst = generateVariant(template('prog.username'), 'max-len', { seed: 2, difficulty: 3 });
  const cfg = inst.config;
  // Hard-codes the visible 16-character example instead of fixing the comparison.
  const hacked = replaceLine(cfg.buggyCode, 13, "  if (name.length >= 16 && name !== 'abcdefghijklmnop') return 'too long';");
  assert.ok(results(hacked, visibleOf(cfg)).every((r) => r.pass));
  const steps: Step[] = [runAction(cfg, cfg.buggyCode), { type: 'edit', payload: { code: hacked } }, runAction(cfg, hacked), submitAction(cfg, hacked, 13, 'off_by_one')];
  const over = play(inst, steps);
  const ev = mod.evaluate(inst, over.state, over.log);
  assert.equal(ev.solved, false);
  assert.ok(ev.mistakes.some((m) => m.code === 'prog.overfit_to_tests'));
  assert.ok(!ev.mistakes.some((m) => m.code === 'prog.gave_up_unsolved'));
  assert.equal(ev.outcomeLabel, 'Visible tests pass, hidden edge cases fail');

  const unsolved = play(inst, [runAction(cfg, cfg.buggyCode), submitAction(cfg, cfg.buggyCode, 13, 'off_by_one')]);
  const ev2 = mod.evaluate(inst, unsolved.state, unsolved.log);
  assert.equal(ev2.solved, false);
  assert.equal(ev2.processVerdict.tone, 'danger');
  assert.ok(ev2.mistakes.some((m) => m.code === 'prog.gave_up_unsolved'));
  assert.ok(ev2.accuracy < 0.9);
});

test('invalid actions are rejected without changing state', () => {
  const inst = mod.generate(template('prog.cart'), { seed: 9, difficulty: 2 }) as Inst;
  const cfg = inst.config;
  const state = mod.initialState(inst) as ProgState;
  const ctx = { seq: 1, t: 0 };
  const bad: ModuleAction[] = [
    { type: 'run_tests', payload: { scope: 'all', results: [] } },
    { type: 'run_tests', payload: { code: cfg.buggyCode, scope: 'all', results: [{ id: 'nope', pass: true, actual: '', logs: [] }] } },
    { type: 'run_experiment', payload: { code: cfg.buggyCode, expression: '', result: { ok: true, value: '1', logs: [] } } },
    { type: 'edit', payload: { code: cfg.buggyCode } },
    { type: 'flag_line', payload: { line: 0, flagged: true } },
    { type: 'reset_code' },
    { type: 'submit_fix', payload: { code: cfg.buggyCode, results: [] } },
    { type: 'submit_fix', payload: { code: cfg.buggyCode, results: [], diagnosis: { line: 3, category: 'bogus' } } },
    { type: 'teleport' },
  ];
  for (const a of bad) {
    const res = mod.applyAction(inst, state, a, ctx);
    assert.ok(res.error, `${a.type} should be rejected`);
    assert.equal(res.state, state);
  }
  const done = play(inst, [submitAction(cfg, cfg.buggyCode, 9, 'type_coercion')]);
  assert.ok(mod.applyAction(inst, done.state, runAction(cfg, cfg.buggyCode), { seq: 2, t: 1 }).error);
});

test('hints escalate without revealing the fix; describeAction covers every action', () => {
  for (const data of TEMPLATE_DATA) {
    for (const v of data.variants.filter((x) => x.bugs.length === 1)) {
      const inst = generateVariant(data.template, v.id, { seed: 3, difficulty: data.template.difficultyRange[0] });
      const state = mod.initialState(inst) as ProgState;
      const bug = inst.config.bugs[0];
      for (const level of [1, 2, 3]) {
        const h = mod.hint(inst, state, [], level);
        assert.equal(h.level, level);
        assert.equal(h.maxLevel, 3);
        assert.ok(h.text.length > 20);
        assert.ok(!h.text.includes(bug.fixedLine), `${v.id} L${level} reveals the fix`);
      }
      assert.ok(mod.hint(inst, state, [], 3).text.includes(`line ${bug.line}`));
    }
  }
  const inst = generateVariant(template('prog.streak'), 'last-run', { seed: 4, difficulty: 3 });
  const steps = expertActions(inst);
  steps.splice(2, 0, { type: 'hint', payload: { level: 2 } });
  const withReset: Step[] = [...steps.slice(0, 3), { type: 'edit', payload: { code: inst.config.buggyCode + '\n// note' } }, { type: 'reset_code' }, ...steps.slice(3)];
  const { log } = play(inst, withReset);
  for (const e of log) assert.ok(mod.describeAction(e).length > 5, e.type);
  assert.match(mod.describeAction(log[0]), /^Ran all tests: \d+\/\d+ passed$/);
  assert.ok(log.some((e) => e.type === 'reset_code' && mod.describeAction(e) === 'Reset code to original'));
  assert.match(mod.describeAction(log[log.length - 1]), /^Submitted fix: \d+\/\d+ tests passed/);
  const revealed = mod.reveal!(inst, play(inst, steps).state) as { bugs: unknown[]; referenceCode: string };
  assert.equal(revealed.bugs.length, 1);
  assert.equal(revealed.referenceCode, inst.config.referenceCode);
});

// ---------------------------------------------------------------------------
// Simulated learners
// ---------------------------------------------------------------------------

test('simulateLearner sequences apply cleanly and strong bots outperform weak ones', () => {
  const personas = [
    { ability: 0.95, traits: { careful: 0.9, safe: 0.9, systematic: 0.95 } },
    { ability: 0.55, traits: { careful: 0.5, safe: 0.5, systematic: 0.5 } },
    { ability: 0.1, traits: { careful: 0.1, safe: 0.2, systematic: 0.05 } },
  ];
  const totals = personas.map(() => 0);
  let count = 0;
  for (const data of TEMPLATE_DATA) {
    for (let s = 1; s <= 3; s++) {
      const d = data.template.difficultyRange[0] + ((s - 1) % (data.template.difficultyRange[1] - data.template.difficultyRange[0] + 1));
      const inst = mod.generate(data.template, { seed: 100 + s, difficulty: d }) as Inst;
      personas.forEach((p, i) => {
        const actions = mod.simulateLearner!(inst, { rng: createRng(s * 31 + i), ability: p.ability, traits: p.traits, exec: vmExec });
        const { state, log, completed } = play(inst, actions);
        assert.ok(completed, `${inst.variantId} persona ${i} did not submit`);
        const ev = mod.evaluate(inst, state, log);
        for (const k of ['accuracy', 'process', 'efficiency'] as const) assert.ok(ev[k] >= 0 && ev[k] <= 1, `${k}=${ev[k]}`);
        assert.equal(ev.timeline.length, log.length);
        totals[i] += 0.45 * ev.accuracy + 0.35 * ev.process + 0.2 * ev.efficiency;
      });
      count++;
    }
  }
  const avg = totals.map((t) => t / count);
  assert.ok(avg[0] > avg[2] + 0.2, `strong ${avg[0]} vs weak ${avg[2]}`);
  assert.ok(avg[0] > 0.8, `strong bots average ${avg[0]}`);
  // Without an executor the bot still produces valid sequences.
  const inst = mod.generate(template('prog.sensor'), { seed: 8, difficulty: 3 }) as Inst;
  const actions = mod.simulateLearner!(inst, { rng: createRng(1), ability: 0.6, traits: { careful: 0.6, safe: 0.5, systematic: 0.6 } });
  assert.ok(play(inst, actions).completed);
});
