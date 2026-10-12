/**
 * Electrical module tests: circuit physics, generation, engine/evaluator integration,
 * safety detection, hypothesis tracking (incl. a fuzz test), fuse re-blow and hints.
 * Run: node --disable-warning=ExperimentalWarning --test tests/electrical.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LoggedAction, ModuleAction, ScenarioInstance, ScenarioTemplate } from '../shared/types.ts';
import type { Rng } from '../shared/rng.ts';
import { createRng } from '../shared/rng.ts';
import { composeEvaluation } from '../shared/scoring.ts';
import { electricalModule as mod } from '../shared/modules/electrical/index.ts';
import type { ElecState } from '../shared/modules/electrical/engine.ts';
import type { Controls, ElecConfig, ElecTemplateDef } from '../shared/modules/electrical/types.ts';
import { getDef } from '../shared/modules/electrical/circuits.ts';
import { faultById, measure, solve, type World } from '../shared/modules/electrical/sim.ts';

type Inst = ScenarioInstance<ElecConfig>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const templates = mod.templates;
const templateById = (id: string): ScenarioTemplate => {
  const t = templates.find((x) => x.id === id);
  if (!t) throw new Error(`missing template ${id}`);
  return t;
};
const difficulties = (t: ScenarioTemplate) => {
  const out: number[] = [];
  for (let d = t.difficultyRange[0]; d <= t.difficultyRange[1]; d++) out.push(d);
  return out;
};

interface Played {
  state: ElecState;
  log: LoggedAction[];
  errors: string[];
  completed: boolean;
}

/** Applies actions like the server does: rejected actions are not logged. */
function play(instance: Inst, actions: ModuleAction[], strict: boolean): Played {
  let state = mod.initialState(instance);
  const log: LoggedAction[] = [];
  const errors: string[] = [];
  let completed = false;
  for (const action of actions) {
    const seq = log.length + 1;
    const t = seq * 6000;
    const res = mod.applyAction(instance, state, action, { seq, t });
    if (res.error) {
      const msg = `${action.type} ${JSON.stringify(action.payload ?? {})}: ${res.error}`;
      if (strict) throw new Error(`Action ${seq} rejected: ${msg}`);
      errors.push(msg);
      continue;
    }
    state = res.state;
    log.push({ seq, t, type: action.type, payload: action.payload ?? {}, observation: res.observation ?? null, annotations: res.annotations ?? {} });
    if (res.complete) {
      completed = true;
      break;
    }
  }
  return { state, log, errors, completed };
}

/** Applies a single action and fails loudly if it is rejected. */
function step(instance: Inst, state: ElecState, action: ModuleAction, seq: number) {
  const res = mod.applyAction(instance, state, action, { seq, t: seq * 6000 });
  assert.equal(res.error, undefined, `${action.type} rejected: ${res.error}`);
  return res;
}

const overall = (instance: Inst, p: Played) =>
  composeEvaluation(mod.evaluate(instance, p.state, p.log), { hintsUsed: 0, durationSec: p.log.length * 6, actionCount: p.log.length }).overall;

const EXPERT = { careful: 1, safe: 1, systematic: 1 };
const CARELESS = { careful: 0, safe: 0, systematic: 0 };

const controlsOf = (power: boolean, switches: Record<string, boolean> = {}): Controls => ({ power, lockout: false, switches, plugged: {} });
const worldOf = (faults: string[]): World => ({ id: faults.join('+') || 'none', faults, blown: [], relay: {} });

// ---------------------------------------------------------------------------
// Solver physics
// ---------------------------------------------------------------------------

const seriesLoop: ElecTemplateDef = {
  template: {
    id: 'test.loop',
    moduleId: 'electrical',
    title: 'Series loop',
    summary: '',
    difficultyRange: [1, 1],
    skillWeights: {},
    focusable: [],
    prerequisites: [],
    estimatedMinutes: 1,
    tags: [],
    variantCount: 1,
  },
  circuit: {
    width: 100,
    height: 100,
    ground: 'G',
    nodes: [
      { id: 'G', label: 'GND', x: 0, y: 100 },
      { id: 'A', label: 'TP1', x: 0, y: 0 },
    ],
    comps: [
      { id: 'B1', kind: 'battery', label: 'Battery', spec: '12 V', a: 'G', b: 'A', r: 0.05, v: 12, cost: 0, replaceable: false, pts: [[0, 100], [0, 0]] },
      { id: 'L1', kind: 'lamp', label: 'Lamp', spec: '12 V 10 W', a: 'A', b: 'G', r: 14.4, rating: 10, cost: 0, replaceable: false, pts: [[0, 0], [100, 0]] },
    ],
    hidden: [],
  },
  faults: [],
  initial: { controls: controlsOf(true), blown: [] },
  operating: { switches: {} },
  allowDouble: false,
  acceptableExtras: [],
  story: () => ({ title: '', briefing: '', goal: '', constraints: [], objectives: [] }),
};

test('solver: a 12 V series loop puts ~12 V across a 14.4 Ω lamp', () => {
  const world = worldOf([]);
  const r = measure(seriesLoop, world, controlsOf(true), 'V', 'A', 'G');
  assert.equal(r.kind, 'value');
  if (r.kind === 'value') assert.ok(Math.abs(r.value - 12) < 0.1, `lamp voltage ${r.value}`);
  const s = solve(seriesLoop, world, controlsOf(true));
  assert.ok(Math.abs(s.current.L1 - 12 / 14.45) < 0.01, `lamp current ${s.current.L1}`);
});

test('solver: open parts read OL in resistance mode; good parts read their resistance', () => {
  const porch = getDef('elec.porch-light');
  const dead = controlsOf(false, { S1: true });
  const open = measure(porch, worldOf(['e1-l1-open']), dead, 'R', 'N6', 'N7');
  assert.equal(open.kind, 'OL');
  const good = measure(porch, worldOf([]), dead, 'R', 'N6', 'N7');
  assert.equal(good.kind, 'value');
  if (good.kind === 'value') assert.ok(Math.abs(good.value - 14.4) < 1.5, `lamp resistance ${good.value}`);
});

test('solver: a node floating between two opens reads < 0.5 V with the 10 MΩ meter attached', () => {
  const porch = getDef('elec.porch-light');
  const world = worldOf(['e1-f1-blown', 'e1-s1-open']);
  const live = controlsOf(true, { S1: true });
  const unloaded = solve(porch, world, live).v.N3;
  assert.ok(unloaded > 1, `without a meter the floating node sits at a divider voltage (${unloaded})`);
  const r = measure(porch, world, live, 'V', 'N3', 'N0');
  assert.equal(r.kind, 'value');
  if (r.kind === 'value') assert.ok(Math.abs(r.value) < 0.5, `metered floating node ${r.value}`);
});

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

test('generate() is deterministic for the same seed', () => {
  for (const t of templates) {
    for (const d of difficulties(t)) {
      const a = mod.generate(t, { seed: 4242, difficulty: d });
      const b = mod.generate(t, { seed: 4242, difficulty: d });
      assert.deepEqual(a, b, `${t.id} d${d}`);
    }
  }
});

test('generate() honors focusSkills (statistically)', () => {
  const t = templateById('elec.porch-light');
  const def = getDef(t.id);
  const resistanceHits = (focusSkills?: string[]) => {
    let hits = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const inst = mod.generate(t, { seed, difficulty: 2, focusSkills });
      if (inst.config.faultIds.some((id) => (faultById(def, id).emphasis['elec.resistance'] ?? 0) > 0)) hits++;
    }
    return hits;
  };
  const base = resistanceHits();
  const focused = resistanceHits(['elec.resistance']);
  assert.ok(focused > base, `focused ${focused} vs unfocused ${base}`);
});

test('generate() respects avoidVariants', () => {
  for (const t of templates) {
    for (let seed = 1; seed <= 8; seed++) {
      const d = t.difficultyRange[0];
      const first = mod.generate(t, { seed, difficulty: d });
      const second = mod.generate(t, { seed, difficulty: d, avoidVariants: [first.variantId] });
      assert.notEqual(second.variantId, first.variantId, `${t.id} seed ${seed}`);
    }
  }
});

test('a difficulty-5 workshop instance can have two faults', () => {
  const t = templateById('elec.workshop-lights');
  let doubles = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const inst = mod.generate(t, { seed, difficulty: 5 });
    if (inst.config.faultIds.length === 2) {
      doubles++;
      const [a, b] = inst.config.faultIds.map((id) => faultById(getDef(t.id), id));
      assert.notEqual(a.comp, b.comp);
    }
  }
  assert.ok(doubles > 0, 'no two-fault instances at difficulty 5');
});

test('publicScenario() never leaks the hidden configuration', () => {
  for (const t of templates) {
    for (const d of difficulties(t)) {
      for (let seed = 1; seed <= 4; seed++) {
        const inst = mod.generate(t, { seed, difficulty: d });
        const json = JSON.stringify(mod.publicScenario(inst));
        assert.ok(!json.includes('faultIds'), `${t.id}: faultIds leaked`);
        assert.ok(!json.includes('"config"'), `${t.id}: config leaked`);
        for (const id of inst.config.faultIds) {
          const f = faultById(getDef(t.id), id);
          assert.ok(!json.includes(id), `${t.id}: fault id ${id} leaked`);
          assert.ok(!json.includes(f.title), `${t.id}: fault title "${f.title}" leaked`);
          assert.ok(!json.includes(f.detail), `${t.id}: fault detail leaked`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Engine + evaluator integration (simulated learners)
// ---------------------------------------------------------------------------

test('expert simulated learners: valid, complete, solved, safe, effective (overall >= 90)', () => {
  for (const t of templates) {
    for (const d of difficulties(t)) {
      for (const seed of [1, 2, 3]) {
        const inst = mod.generate(t, { seed: seed * 977 + d, difficulty: d });
        const actions = mod.simulateLearner!(inst, { rng: createRng(seed * 31 + d), ability: 1, traits: EXPERT });
        const label = `${t.id} d${d} seed ${seed} (${inst.variantId})`;
        const p = play(inst, actions, true);
        assert.ok(p.completed, `${label}: did not complete`);
        const ev = mod.evaluate(inst, p.state, p.log);
        assert.equal(ev.solved, true, `${label}: not solved (${ev.outcomeLabel})`);
        assert.equal(ev.safety, 1, `${label}: safety ${ev.safety}; mistakes ${ev.mistakes.map((m) => m.code).join(', ')}`);
        assert.equal(ev.processVerdict.tone, 'success', `${label}: ${ev.processVerdict.label}; mistakes ${ev.mistakes.map((m) => m.code).join(', ')}`);
        const score = overall(inst, p);
        assert.ok(score >= 90, `${label}: overall ${score}`);
        assert.equal(ev.timeline.length, p.log.length, `${label}: timeline length`);
      }
    }
  }
});

test('careless simulated learners never beat the expert on the same instance', () => {
  for (const t of templates) {
    for (const d of [t.difficultyRange[0], t.difficultyRange[1]]) {
      for (const seed of [1, 2]) {
        const inst = mod.generate(t, { seed: seed * 613 + d, difficulty: d });
        const expert = play(inst, mod.simulateLearner!(inst, { rng: createRng(seed), ability: 1, traits: EXPERT }), true);
        const best = overall(inst, expert);
        for (const botSeed of [11, 12, 13]) {
          const careless = play(inst, mod.simulateLearner!(inst, { rng: createRng(botSeed * seed), ability: 0.05, traits: CARELESS }), false);
          const score = overall(inst, careless);
          assert.ok(score <= best, `${t.id} d${d}: careless ${score} > expert ${best}`);
        }
      }
    }
  }
});

test('simulated learners of any ability only produce actions the engine accepts', () => {
  const problems: string[] = [];
  for (const t of templates) {
    for (const d of difficulties(t)) {
      const inst = mod.generate(t, { seed: 55 + d, difficulty: d });
      for (const ability of [0.05, 0.3, 0.6, 0.9]) {
        for (const botSeed of [1, 2, 3, 4]) {
          const traits = { careful: ability, safe: 1 - ability / 2, systematic: ability };
          const p = play(inst, mod.simulateLearner!(inst, { rng: createRng(botSeed * 7 + d), ability, traits }), false);
          if (p.errors.length) problems.push(`${t.id} d${d} ability ${ability} seed ${botSeed}: ${p.errors[0]}`);
          if (!p.completed) problems.push(`${t.id} d${d} ability ${ability} seed ${botSeed}: did not complete`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// Safety detection
// ---------------------------------------------------------------------------

function porchInstance(seed = 1): Inst {
  return mod.generate(templateById('elec.porch-light'), { seed, difficulty: 1 });
}

test('safety: resistance test across live battery terminals is flagged critical', () => {
  const inst = porchInstance();
  const p = play(inst, [{ type: 'measure', payload: { mode: 'R', red: 'N1', black: 'N0' } }], true);
  assert.equal(p.log[0].annotations.voltagePresent, true);
  assert.equal(p.log[0].observation.reading.display, 'VOLT!');
  const ev = mod.evaluate(inst, p.state, p.log);
  assert.ok(ev.mistakes.some((m) => m.code === 'elec.live_resistance_test'));
  assert.ok((ev.safety ?? 1) <= 0.5);
  assert.equal(ev.timeline[0].verdict, 'unsafe');
});

test('safety: replacing a part with power ON is flagged critical', () => {
  const inst = porchInstance(2);
  const p = play(inst, [{ type: 'replace', payload: { comp: 'L1' } }], true);
  assert.equal(p.log[0].annotations.live, true);
  const ev = mod.evaluate(inst, p.state, p.log);
  assert.ok(ev.mistakes.some((m) => m.code === 'elec.live_part_replacement'));
});

test('safety: contact work after switching off but before verifying 0 V is flagged', () => {
  const inst = porchInstance(3);
  const p = play(
    inst,
    [
      { type: 'set_power', payload: { on: false } },
      { type: 'measure', payload: { mode: 'R', red: 'N6', black: 'N7' } },
    ],
    true,
  );
  assert.equal(p.log[1].annotations.voltagePresent, false);
  const ev = mod.evaluate(inst, p.state, p.log);
  const codes = ev.mistakes.map((m) => m.code);
  assert.ok(codes.includes('elec.no_zero_energy_verification'), codes.join(', '));
  assert.ok(!codes.includes('elec.live_resistance_test'));
});

test('safety: off + lockout + verified 0 V makes resistance testing safe', () => {
  const inst = porchInstance(4);
  const p = play(
    inst,
    [
      { type: 'set_power', payload: { on: false } },
      { type: 'set_lockout', payload: { applied: true } },
      { type: 'measure', payload: { mode: 'V', red: 'N3', black: 'N0' } },
      { type: 'measure', payload: { mode: 'R', red: 'N6', black: 'N7' } },
    ],
    true,
  );
  assert.equal(p.log[2].annotations.verification, true);
  const ev = mod.evaluate(inst, p.state, p.log);
  const safetyCodes = ['elec.live_resistance_test', 'elec.live_part_replacement', 'elec.not_isolated', 'elec.no_zero_energy_verification', 'elec.no_lockout'];
  assert.deepEqual(ev.mistakes.map((m) => m.code).filter((c) => safetyCodes.includes(c)), []);
  assert.equal(ev.safety, 1);
});

test('lockout requires the disconnect to be OFF, and blocks restoring power', () => {
  const inst = porchInstance(5);
  let state = mod.initialState(inst);
  assert.ok(mod.applyAction(inst, state, { type: 'set_lockout', payload: { applied: true } }, { seq: 1, t: 0 }).error);
  state = step(inst, state, { type: 'set_power', payload: { on: false } }, 1).state;
  state = step(inst, state, { type: 'set_lockout', payload: { applied: true } }, 2).state;
  assert.ok(mod.applyAction(inst, state, { type: 'set_power', payload: { on: true } }, { seq: 3, t: 0 }).error);
});

// ---------------------------------------------------------------------------
// Hypothesis tracking
// ---------------------------------------------------------------------------

test('hypotheses: an informative reading shrinks the hypothesis set; a repeat is redundant', () => {
  let checked = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const inst = porchInstance(seed);
    const state0 = mod.initialState(inst);
    if (state0.worlds.length <= 1) continue;
    const def = getDef(inst.templateId);
    let found: { red: string; black: string } | null = null;
    outer: for (const a of def.circuit.nodes) {
      for (const b of def.circuit.nodes) {
        if (a.id === b.id) continue;
        const res = step(inst, state0, { type: 'measure', payload: { mode: 'V', red: a.id, black: b.id } }, 1);
        if (res.state.worlds.length < state0.worlds.length) {
          found = { red: a.id, black: b.id };
          assert.ok(res.annotations?.eliminated > 0);
          assert.ok(res.state.worlds.some((w) => w.id === res.state.realId));
          break outer;
        }
      }
    }
    assert.ok(found, `seed ${seed}: no informative voltage reading found`);
    const first = step(inst, state0, { type: 'measure', payload: { mode: 'V', ...found } }, 1);
    assert.equal(first.annotations?.redundant, false);
    const again = step(inst, first.state, { type: 'measure', payload: { mode: 'V', ...found } }, 2);
    assert.equal(again.annotations?.redundant, true);
    assert.equal(again.annotations?.eliminated, 0);
    checked++;
  }
  assert.ok(checked > 0, 'no multi-hypothesis porch instance found');
});

function randomAction(rng: Rng, def: ElecTemplateDef, state: ElecState): ModuleAction {
  const nodes = def.circuit.nodes.map((n) => n.id);
  const comps = def.circuit.comps;
  const switches = comps.filter((c) => c.control === 'switch' || c.control === 'thermostat');
  const plugs = comps.filter((c) => c.control === 'plug');
  const benchable = comps.filter((c) => c.replaceable && c.kind !== 'relay_contact');
  const replaceable = comps.filter((c) => c.replaceable);
  const r = rng.next();
  if (r < 0.42) return { type: 'measure', payload: { mode: rng.pick(['V', 'R', 'C'] as const), red: rng.pick(nodes), black: rng.pick(nodes) } };
  if (r < 0.52 && switches.length) return { type: 'toggle', payload: { comp: rng.pick(switches).id, on: rng.chance(0.5) } };
  if (r < 0.58 && plugs.length) return { type: 'set_plug', payload: { comp: rng.pick(plugs).id, plugged: rng.chance(0.5) } };
  if (r < 0.68) return { type: 'set_power', payload: { on: !state.controls.power } };
  if (r < 0.74) return { type: 'set_lockout', payload: { applied: !state.controls.lockout } };
  if (r < 0.83) return { type: 'inspect', payload: { comp: rng.pick(comps).id } };
  if (r < 0.92) return { type: 'bench_test', payload: { comp: rng.pick(benchable).id } };
  if (r < 0.98) return { type: 'replace', payload: { comp: rng.pick(replaceable).id } };
  return { type: 'diagnose', payload: { faults: [{ comp: rng.pick(benchable).id, type: 'open' }] } };
}

test('hypotheses: the true world is never eliminated (fuzz, ~200 random actions per instance)', () => {
  for (const t of templates) {
    for (const d of [t.difficultyRange[0], t.difficultyRange[1]]) {
      const inst = mod.generate(t, { seed: 900 + d, difficulty: d });
      const def = getDef(t.id);
      const rng = createRng(31337 + d);
      let state = mod.initialState(inst);
      const log: LoggedAction[] = [];
      for (let i = 0; i < 200; i++) {
        const action = randomAction(rng, def, state);
        const seq = log.length + 1;
        const res = (() => {
          try {
            return mod.applyAction(inst, state, action, { seq, t: seq * 1000 });
          } catch (e) {
            throw new Error(`${t.id} d${d}: ${action.type} ${JSON.stringify(action.payload)} threw at step ${i}: ${(e as Error).stack}`);
          }
        })();
        if (res.error) continue;
        state = res.state;
        log.push({ seq, t: seq * 1000, type: action.type, payload: action.payload ?? {}, observation: res.observation ?? null, annotations: res.annotations ?? {} });
        assert.ok(
          state.worlds.some((w) => w.id === state.realId),
          `${t.id} d${d}: true world eliminated by ${action.type} ${JSON.stringify(action.payload)} at step ${i}`,
        );
        assert.doesNotThrow(() => mod.publicState(inst, state));
      }
      const done = step(inst, state, { type: 'complete_work_order', payload: {} }, log.length + 1);
      log.push({ seq: log.length + 1, t: 0, type: 'complete_work_order', payload: {}, observation: done.observation, annotations: done.annotations ?? {} });
      assert.doesNotThrow(() => mod.evaluate(inst, done.state, log));
      assert.ok(log.length > 50, `${t.id}: too few valid fuzz actions (${log.length})`);
    }
  }
});

// ---------------------------------------------------------------------------
// Tripping fuse
// ---------------------------------------------------------------------------

test('tripping fuse: a new fuse installed before the short is fixed blows again', () => {
  const t = templateById('elec.tripping-fuse');
  const inst = mod.generate(t, { seed: 21, difficulty: 3 });
  const p = play(
    inst,
    [
      { type: 'set_power', payload: { on: false } },
      { type: 'set_lockout', payload: { applied: true } },
      { type: 'measure', payload: { mode: 'V', red: 'N3', black: 'N0' } },
      { type: 'replace', payload: { comp: 'F1' } },
      { type: 'set_lockout', payload: { applied: false } },
      { type: 'set_power', payload: { on: true } },
    ],
    true,
  );
  assert.equal(p.log[3].annotations.shortPresent, true);
  const powerOn = p.log[5];
  assert.ok(Array.isArray(powerOn.annotations.fuseBlew) && powerOn.annotations.fuseBlew.includes('F1'), 'F1 should blow again');
  assert.ok(p.state.fuseEvents.some((f) => f.comp === 'F1' && f.seq === powerOn.seq));
  const ev = mod.evaluate(inst, p.state, p.log);
  assert.ok(ev.mistakes.some((m) => m.code === 'elec.fuse_reblown'), ev.mistakes.map((m) => m.code).join(', '));
});

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

test('hints: levels 1-3 give text, and level 3 never names the fault while several hypotheses remain', () => {
  for (const t of templates) {
    for (const d of difficulties(t)) {
      for (const seed of [1, 2]) {
        const inst = mod.generate(t, { seed: seed * 17 + d, difficulty: d });
        const state = mod.initialState(inst);
        const def = getDef(t.id);
        for (const level of [1, 2, 3]) {
          const h = mod.hint(inst, state, [], level);
          assert.equal(h.level, level);
          assert.equal(h.maxLevel, 3);
          assert.ok(h.text.length > 20, `${t.id} L${level}: empty hint`);
        }
        if (state.worlds.length > 1) {
          const text = mod.hint(inst, state, [], 3).text;
          for (const id of inst.config.faultIds) {
            const title = faultById(def, id).title;
            assert.ok(!text.includes(title), `${t.id} d${d}: level-3 hint reveals "${title}"`);
          }
        }
      }
    }
  }
});
