/**
 * Simulated electrical learner. Produces plausible action sequences whose quality depends
 * on ability and traits (careful / safe / systematic). Used to generate realistic demo data
 * THROUGH the real engine and evaluator, and as an integration test of the module.
 */

import type { BotContext, ModuleAction, ScenarioInstance } from '../../types.ts';
import type { ElecConfig } from './types.ts';
import { getDef } from './circuits.ts';
import { faultById } from './sim.ts';
import { faultTypesFor, initialStateElectrical } from './engine.ts';
import { planExpert, type Probe } from './planner.ts';

export function simulateElectricalLearner(instance: ScenarioInstance<ElecConfig>, ctx: BotContext): ModuleAction[] {
  const def = getDef(instance.templateId);
  const { rng, ability, traits } = ctx;
  const state0 = initialStateElectrical(instance);
  const plan = planExpert(def, state0.worlds, state0.controls, state0.realId);
  const realFaults = instance.config.faultIds.map((id) => faultById(def, id));
  const ground = def.circuit.ground;
  const nodes = def.circuit.nodes.filter((n) => n.id !== ground);
  const replaceable = def.circuit.comps.filter((c) => c.replaceable && c.kind !== 'relay_contact');
  const actions: ModuleAction[] = [];
  let power = state0.controls.power;
  let lockout = false;
  const skill = (t: number) => 0.15 + 0.85 * (0.5 * t + 0.5 * ability); // probability of good behaviour

  const isLive = (p: Probe) => p.kind === 'measure' && p.mode === 'V';
  const liveMacros = plan.macros.filter((m) => m.every((p) => p.kind === 'toggle' || isLive(p)));
  const deadMacros = plan.macros.filter((m) => !m.every((p) => p.kind === 'toggle' || isLive(p)));
  const toAction = (p: Probe): ModuleAction => {
    switch (p.kind) {
      case 'measure':
        return { type: 'measure', payload: { mode: p.mode, red: p.red, black: p.black } };
      case 'bench':
        return { type: 'bench_test', payload: { comp: p.comp } };
      case 'toggle':
        return { type: 'toggle', payload: { comp: p.comp, on: p.on } };
      case 'plug':
        return { type: 'set_plug', payload: { comp: p.comp, plugged: p.plugged } };
    }
  };
  const randomVoltage = (): ModuleAction => {
    const n = rng.pick(nodes);
    return { type: 'measure', payload: { mode: 'V', red: n.id, black: rng.chance(0.7) ? ground : rng.pick(nodes).id } };
  };
  const isolate = (careful: boolean) => {
    if (power) {
      actions.push({ type: 'set_power', payload: { on: false } });
      power = false;
    }
    if (!lockout && (careful || rng.chance(skill(traits.safe)))) {
      actions.push({ type: 'set_lockout', payload: { applied: true } });
      lockout = true;
    }
    if (careful || rng.chance(skill(traits.safe))) {
      const loadNode = nodes.find((n) => n.id !== def.circuit.comps.find((c) => c.control === 'power')?.a) ?? nodes[0];
      actions.push({ type: 'measure', payload: { mode: 'V', red: loadNode.id, black: ground } });
    }
  };
  const restore = () => {
    if (lockout) {
      actions.push({ type: 'set_lockout', payload: { applied: false } });
      lockout = false;
    }
    if (!power) {
      actions.push({ type: 'set_power', payload: { on: true } });
      power = true;
    }
    for (const [comp, on] of Object.entries(def.operating.switches)) actions.push({ type: 'toggle', payload: { comp, on } });
  };

  const systematic = rng.chance(skill(traits.systematic));
  const safe = rng.chance(skill(traits.safe));
  const careful = rng.chance(skill(traits.careful));

  // 1. Reproduce / observe
  if (def.reproduce && rng.chance(skill(traits.systematic))) {
    actions.push({ type: 'toggle', payload: { comp: def.reproduce.comp, on: def.reproduce.on } });
  }
  if (rng.chance(0.35)) actions.push({ type: 'inspect', payload: { comp: rng.pick(replaceable).id } });

  // 2. Live diagnosis
  if (systematic) {
    for (const m of liveMacros) for (const p of m) if (p.kind !== 'toggle' || !def.reproduce || p.comp !== def.reproduce.comp) actions.push(toAction(p));
    if (!careful && rng.chance(0.5)) actions.push(randomVoltage());
  } else {
    const k = rng.int(2, 6);
    for (let i = 0; i < k; i++) actions.push(randomVoltage());
    if (rng.chance(0.5)) for (const m of liveMacros.slice(0, 1)) for (const p of m) actions.push(toAction(p));
    if (rng.chance(0.4)) actions.push(actions[actions.length - 1]); // repeat a reading
  }

  // 3. Unsafe habit: resistance test on a live circuit
  if (!safe && rng.chance(0.7)) {
    const c = rng.pick(replaceable);
    actions.push({ type: 'measure', payload: { mode: 'R', red: c.a, black: c.b } });
  }

  // 4. Guessing: replace a random good part
  if (!careful && rng.chance(0.75)) {
    const good = replaceable.filter((c) => !realFaults.some((f) => f.comp === c.id) && c.kind !== 'battery' && !def.initial.blown.includes(c.id));
    if (good.length) {
      if (safe) isolate(false);
      actions.push({ type: 'replace', payload: { comp: rng.pick(good).id } });
    }
  }

  // 5. Careless fuse swap before finding the short
  if (def.initial.blown.length && !careful && rng.chance(0.6)) {
    if (safe) isolate(false);
    actions.push({ type: 'replace', payload: { comp: def.initial.blown[0] } });
    restore();
  }

  // 6. Isolate for contact work
  if (safe) isolate(careful);
  else if (power && rng.chance(0.5)) {
    actions.push({ type: 'set_power', payload: { on: false } });
    power = false;
  }

  // 7. Dead-phase diagnosis
  if (systematic) {
    for (const m of deadMacros) for (const p of m) actions.push(toAction(p));
  } else if (deadMacros.length) {
    for (const m of deadMacros.slice(0, Math.max(1, deadMacros.length - 1))) for (const p of m) actions.push(toAction(p));
  }
  for (const c of def.circuit.comps) {
    if (c.control === 'plug') actions.push({ type: 'set_plug', payload: { comp: c.id, plugged: true } });
  }

  // 8. Repair
  const done = new Set<string>();
  for (const f of realFaults) {
    if (done.has(f.comp)) continue;
    done.add(f.comp);
    actions.push({ type: 'replace', payload: { comp: f.comp } });
  }
  for (const fuse of def.initial.blown) actions.push({ type: 'replace', payload: { comp: fuse } });

  // 9. Verify
  if (careful || rng.chance(0.5)) restore();

  // 10. Diagnose
  if (careful || rng.chance(0.6)) {
    const correct = rng.chance(0.45 + 0.55 * ability);
    const entries = correct
      ? realFaults.map((f) => ({ comp: f.comp, type: f.type }))
      : [(() => {
          const c = rng.pick(replaceable.filter((r) => faultTypesFor(r.kind).length > 0));
          return { comp: c.id, type: rng.pick(faultTypesFor(c.kind)) };
        })()];
    actions.push({ type: 'diagnose', payload: { faults: entries } });
  }
  actions.push({ type: 'complete_work_order', payload: {} });
  return actions;
}
