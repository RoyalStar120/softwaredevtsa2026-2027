/**
 * Electrical engine: generation, server-authoritative action handling, hypothesis
 * tracking, public views and hints.
 *
 * Every action is applied to the real world AND to every hypothesis world that is still
 * consistent with what the learner has observed. A reading that makes some worlds disagree
 * with reality "rules them out"; a reading that every remaining world predicts identically
 * told the learner nothing new. This is how SkillBridge evaluates the PROCESS, not just the
 * final answer.
 */

import type {
  ActionContext,
  ApplyResult,
  GenerateOptions,
  HintResult,
  LoggedAction,
  ModuleAction,
  PublicScenario,
  ScenarioInstance,
  ScenarioTemplate,
} from '../../types.ts';
import { createRng } from '../../rng.ts';
import { clamp, listJoin, plural } from '../../util.ts';
import type {
  Controls,
  ElecConfig,
  ElecPublicState,
  ElecReveal,
  ElecTemplateDef,
  ElecView,
  FaultDef,
  FaultOption,
  FaultType,
  MeterMode,
  MeterReading,
  PublicComp,
} from './types.ts';
import { CUSTOMERS, getDef } from './circuits.ts';
import {
  activeFaults,
  benchTest,
  cloneWorld,
  faultById,
  formatBench,
  inspect,
  loadSignature,
  loadViews,
  measure,
  readingsMatch,
  settle,
  toMeterReading,
  type World,
} from './sim.ts';
import { bestProbe, describeProbe, planExpert, repairVerb, tpLabel } from './planner.ts';
import { SAFETY_NOTICE } from './content.ts';

export interface ElecState {
  controls: Controls;
  worlds: World[];
  realId: string;
  initialHypotheses: number;
  replaced: Array<{ comp: string; seq: number }>;
  partsCost: number;
  readings: number;
  verifiedDeadSeq: number | null;
  lastReading: MeterReading | null;
  diagnosis: Array<{ comp: string; type: FaultType }>;
  inspected: Record<string, string>;
  bench: Record<string, string>;
  fuseEvents: Array<{ comp: string; seq: number }>;
  measureKeys: string[];
  expert: { steps: string[]; measurements: number; deadPhase: boolean };
  completed: boolean;
}

type Inst = ScenarioInstance<ElecConfig>;

const FAULT_LABELS: Record<string, Partial<Record<FaultType, string>>> = {
  battery: { weak: 'Weak / discharged' },
  fuse: { open: 'Blown (open)' },
  switch: { open: 'Failed open', high_resistance: 'High resistance (pitted contacts)' },
  thermostat: { open: 'Stuck open' },
  lamp: { open: 'Burned out (open filament)', short: 'Shorted socket' },
  motor: { open: 'Open winding', short: 'Shorted winding' },
  wire: { open: 'Broken (open)', high_resistance: 'Corroded / high resistance', short: 'Shorted to chassis' },
  connector: { open: 'Loose / unseated (open)', high_resistance: 'Corroded (high resistance)' },
  relay_coil: { open: 'Open coil' },
  relay_contact: { open: 'Burned contacts (open)', high_resistance: 'Pitted contacts (high resistance)' },
};

export function faultTypeLabel(kind: string, type: FaultType): string {
  return FAULT_LABELS[kind]?.[type] ?? type.replace('_', ' ');
}

/** Failure modes the diagnosis form accepts for a component kind. */
export function faultTypesFor(kind: string): FaultType[] {
  return Object.keys(FAULT_LABELS[kind] ?? {}) as FaultType[];
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function cloneControls(c: Controls): Controls {
  return { power: c.power, lockout: c.lockout, switches: { ...c.switches }, plugged: { ...c.plugged } };
}

function compLabel(def: ElecTemplateDef, id: string): string {
  return def.circuit.comps.find((c) => c.id === id)?.label ?? id;
}

/** Describes which loads are affected, e.g. "the porch light won't come on". */
export function describeSymptom(def: ElecTemplateDef, world: World, controls: Controls): string {
  const s = settle(def, world, controls);
  const loads = loadViews(def, s.world, s);
  const named = (id: string) => def.circuit.comps.find((c) => c.id === id)?.friendly ?? compLabel(def, id);
  const lamps = loads.filter((l) => l.kind === 'lamp' || l.kind === 'motor');
  const bad = lamps.filter((l) => l.level !== 'normal' && l.level !== 'running');
  if (bad.length === 0) return 'everything seems to work right now';
  const phrase = (l: (typeof lamps)[number]) =>
    l.level === 'dim' ? `the ${named(l.id)} is very dim` : l.level === 'slow' ? `the ${named(l.id)} only turns slowly` : l.kind === 'motor' ? `the ${named(l.id)} won't run` : `the ${named(l.id)} won't come on`;
  if (bad.length === lamps.length && lamps.length > 1) {
    const sameLevel = bad.every((l) => l.level === bad[0].level);
    if (sameLevel) return bad[0].level === 'dim' ? 'all the lights are very dim' : 'nothing comes on at all';
  }
  const good = lamps.filter((l) => !bad.includes(l));
  const goodPart = good.length ? `, but the ${listJoin(good.map((l) => named(l.id)))} ${good.length > 1 ? 'work' : 'works'} fine` : '';
  return `${listJoin(bad.map(phrase))}${goodPart}`;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export function generateElectrical(template: ScenarioTemplate, opts: GenerateOptions): Inst {
  const def = getDef(template.id);
  const rng = createRng((opts.seed ^ hashString(template.id)) >>> 0);
  const d = clamp(Math.round(opts.difficulty), template.difficultyRange[0], template.difficultyRange[1]);
  const focus = opts.focusSkills ?? [];
  let pool = def.faults.filter((f) => f.minDifficulty <= d && d <= f.maxDifficulty);
  const avoid = new Set((opts.avoidVariants ?? []).flatMap((v) => v.split('+')));
  const fresh = pool.filter((f) => !avoid.has(f.id));
  if (fresh.length) pool = fresh;
  const weight = (f: FaultDef) => 1 + 3 * focus.reduce((s, k) => s + (f.emphasis[k] ?? 0), 0);
  const primary = rng.weighted(pool, weight);
  const faults: FaultDef[] = [primary];
  if (def.allowDouble && d >= 5) {
    const second = def.faults.filter(
      (f) => f.comp !== primary.comp && f.target !== primary.target && f.minDifficulty <= d && f.maxDifficulty >= d,
    );
    if (second.length) faults.push(rng.weighted(second, weight));
  }

  // Skill emphasis: template weights blended with the chosen faults' emphasis.
  const skillWeights: Record<string, number> = {};
  for (const [s, w] of Object.entries(template.skillWeights)) skillWeights[s] = w * 0.7;
  for (const f of faults) {
    for (const [s, w] of Object.entries(f.emphasis)) skillWeights[s] = Math.max(skillWeights[s] ?? 0, w);
  }
  for (const s of Object.keys(skillWeights)) skillWeights[s] = Math.round(clamp(skillWeights[s]) * 100) / 100;

  const realWorld: World = { id: faults.map((f) => f.id).join('+'), faults: faults.map((f) => f.id), blown: [...def.initial.blown], relay: {} };
  const symptom = describeSymptom(def, realWorld, def.initial.controls);
  const story = def.story({
    difficulty: d,
    faults,
    symptom,
    workOrder: 1000 + rng.int(0, 8999),
    customer: rng.pick(CUSTOMERS),
  });

  return {
    templateId: template.id,
    moduleId: 'electrical',
    seed: opts.seed,
    difficulty: d,
    variantId: realWorld.id,
    title: story.title,
    briefing: story.briefing,
    goal: story.goal,
    constraints: story.constraints,
    objectives: story.objectives,
    skillWeights,
    focusSkills: focus.filter((s) => s in template.skillWeights),
    config: { faultIds: faults.map((f) => f.id), symptom },
  };
}

export function publicScenarioElectrical(instance: Inst): PublicScenario<ElecView> {
  const def = getDef(instance.templateId);
  const faultOptions: Record<string, FaultOption[]> = {};
  const comps: PublicComp[] = def.circuit.comps.map((c) => {
    const opts = FAULT_LABELS[c.kind] ?? {};
    if (c.kind !== 'disconnect') {
      faultOptions[c.id] = (Object.keys(opts) as FaultType[]).map((t) => ({ type: t, label: opts[t] as string }));
    }
    return {
      id: c.id,
      kind: c.kind,
      label: c.label,
      spec: c.spec,
      a: c.a,
      b: c.b,
      cost: c.cost,
      replaceable: c.replaceable,
      repairVerb: c.replaceable ? repairVerb(c.kind) : '',
      control: c.control,
      pts: c.pts,
      groundEnd: c.groundEnd,
      coil: c.coil,
      unit: c.unit,
    };
  });
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
    skillWeights: instance.skillWeights,
    view: {
      width: def.circuit.width,
      height: def.circuit.height,
      ground: def.circuit.ground,
      nodes: def.circuit.nodes,
      comps,
      faultOptions,
      reproduce: def.reproduce,
      safetyNotice: SAFETY_NOTICE,
    },
  };
}

// ---------------------------------------------------------------------------
// Hypotheses
// ---------------------------------------------------------------------------

function buildHypotheses(def: ElecTemplateDef, realIds: string[]): World[] {
  const sets: string[][] = def.faults.map((f) => [f.id]);
  if (realIds.length > 1) {
    for (let i = 0; i < def.faults.length; i++) {
      for (let j = i + 1; j < def.faults.length; j++) {
        const a = def.faults[i];
        const b = def.faults[j];
        if (a.comp === b.comp || a.target === b.target) continue;
        sets.push([a.id, b.id]);
      }
    }
  }
  if (def.initial.blown.length) sets.push([]);
  const realKey = realIds.join('+');
  if (!sets.some((s) => s.join('+') === realKey)) sets.push(realIds);
  return sets.map((fs) => ({ id: fs.join('+') || 'none', faults: fs, blown: [...def.initial.blown], relay: {} }));
}

export function initialStateElectrical(instance: Inst): ElecState {
  const def = getDef(instance.templateId);
  const controls = cloneControls(def.initial.controls);
  const realId = instance.config.faultIds.join('+');
  const hyps = buildHypotheses(def, instance.config.faultIds).map((w) => {
    const s = settle(def, w, controls);
    return { world: s.world, sig: loadSignature(loadViews(def, s.world, s), []) };
  });
  const realSig = hyps.find((h) => h.world.id === realId)!.sig;
  const worlds = hyps.filter((h) => h.sig === realSig).map((h) => h.world);
  const plan = planExpert(def, worlds, controls, realId);
  return {
    controls,
    worlds,
    realId,
    initialHypotheses: worlds.length,
    replaced: [],
    partsCost: 0,
    readings: 0,
    verifiedDeadSeq: null,
    lastReading: null,
    diagnosis: [],
    inspected: {},
    bench: {},
    fuseEvents: [],
    measureKeys: [],
    expert: { steps: plan.steps, measurements: plan.measurements, deadPhase: plan.deadPhase },
    completed: false,
  };
}

function realWorld(state: ElecState): World {
  const w = state.worlds.find((x) => x.id === state.realId);
  if (!w) throw new Error('Real world missing from hypothesis set');
  return w;
}

function configSig(state: ElecState): string {
  const real = realWorld(state);
  return JSON.stringify([state.controls.power, state.controls.switches, state.controls.plugged, state.replaced.map((r) => r.comp).sort(), real.blown.slice().sort(), real.relay]);
}

function compHasFault(def: ElecTemplateDef, w: World, comp: string): boolean {
  const unit = def.circuit.comps.find((c) => c.id === comp)?.unit;
  return activeFaults(def, w).some((f) => {
    if (f.comp === comp || f.target === comp) return true;
    if (!unit) return false;
    const fc = def.circuit.comps.find((c) => c.id === f.comp);
    return fc?.unit === unit;
  });
}

function isOperating(def: ElecTemplateDef, c: Controls): boolean {
  if (!c.power) return false;
  for (const [k, v] of Object.entries(def.operating.switches)) if (!!c.switches[k] !== v) return false;
  for (const comp of def.circuit.comps) if (comp.control === 'plug' && c.plugged[comp.id] === false) return false;
  return true;
}

function loadsHealthy(def: ElecTemplateDef, w: World, controls: Controls): boolean {
  const s = settle(def, w, controls);
  if (s.events.length) return false;
  return loadViews(def, s.world, s).every((l) => l.kind === 'relay' || l.level === 'normal' || l.level === 'running');
}

/** Re-settles every world after a change of controls/parts and filters by observed load behaviour. */
function settleAll(def: ElecTemplateDef, state: ElecState, controls: Controls) {
  const results = state.worlds.map((w) => {
    const s = settle(def, w, controls);
    return { s, sig: loadSignature(loadViews(def, s.world, s), s.events) };
  });
  const realRes = results.find((r) => r.s.world.id === state.realId)!;
  const kept = results.filter((r) => r.sig === realRes.sig).map((r) => r.s.world);
  const loads = loadViews(def, realRes.s.world, realRes.s);
  return { kept, loads, events: realRes.s.events, eliminated: state.worlds.length - kept.length };
}

function lineSideNodes(def: ElecTemplateDef): Set<string> {
  const qs = def.circuit.comps.find((c) => c.control === 'power');
  return new Set(qs ? [qs.a] : []);
}

function compEnergized(def: ElecTemplateDef, state: ElecState, compId: string): boolean {
  const comp = def.circuit.comps.find((c) => c.id === compId);
  if (!comp) return false;
  if (state.controls.power) return true;
  if (comp.kind === 'battery') return false;
  // Use a loaded measurement (meter impedance) so floating nodes between two opens don't count as live.
  const real = realWorld(state);
  const g = def.circuit.ground;
  const v = (node: string) => {
    if (node === g) return 0;
    const r = measure(def, real, state.controls, 'V', node, g);
    return r.kind === 'value' ? Math.abs(r.value) : 0;
  };
  return v(comp.a) > 1 || v(comp.b) > 1;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const MODE_NAMES: Record<MeterMode, string> = { V: 'DC voltage', R: 'Resistance', C: 'Continuity' };

export function applyActionElectrical(
  instance: Inst,
  state0: ElecState,
  action: ModuleAction,
  ctx: ActionContext,
): ApplyResult<ElecState> {
  const def = getDef(instance.templateId);
  const state: ElecState = structuredClone(state0);
  const p = action.payload ?? {};
  const err = (error: string): ApplyResult<ElecState> => ({ state: state0, error });
  if (state.completed) return err('This work order is already complete.');
  const compOf = (id: unknown) => def.circuit.comps.find((c) => c.id === id);
  const aliveBefore = state.worlds.length;

  switch (action.type) {
    case 'set_power': {
      const on = !!p.on;
      if (on === state.controls.power) return err(`Main power is already ${on ? 'ON' : 'OFF'}.`);
      if (on && state.controls.lockout) return err('Remove your lockout tag before restoring power.');
      const controls = { ...cloneControls(state.controls), power: on };
      const r = settleAll(def, state, controls);
      state.controls = controls;
      state.worlds = r.kept;
      state.verifiedDeadSeq = null;
      for (const f of r.events) state.fuseEvents.push({ comp: f, seq: ctx.seq });
      const blewNote = r.events.length ? ` ${listJoin(r.events.map((f) => compLabel(def, f)))} blew!` : '';
      return {
        state,
        observation: { loads: r.loads, events: r.events, summary: `Switched main power ${on ? 'ON' : 'OFF'}.${blewNote}` },
        annotations: {
          powerOn: on,
          aliveBefore,
          aliveAfter: r.kept.length,
          eliminated: r.eliminated,
          fuseBlew: r.events,
          operatingOk: isOperating(def, controls) && loadsHealthy(def, realWorld(state), controls),
        },
        message: r.events.length ? `Pop! ${listJoin(r.events.map((f) => compLabel(def, f)))} blew as soon as power was restored.` : undefined,
        messageTone: r.events.length ? 'danger' : undefined,
      };
    }

    case 'set_lockout': {
      const applied = !!p.applied;
      if (applied === state.controls.lockout) return err(`Lockout tag is already ${applied ? 'applied' : 'removed'}.`);
      if (applied && state.controls.power) return err('Switch the disconnect OFF before applying a lockout tag.');
      state.controls = { ...cloneControls(state.controls), lockout: applied };
      return {
        state,
        observation: { lockout: applied, summary: `${applied ? 'Applied' : 'Removed'} lockout tag on the disconnect.` },
        annotations: { lockout: applied },
      };
    }

    case 'toggle': {
      const comp = compOf(p.comp);
      if (!comp || (comp.control !== 'switch' && comp.control !== 'thermostat')) return err('That component cannot be toggled.');
      const on = p.on === undefined ? !state.controls.switches[comp.id] : !!p.on;
      const controls = cloneControls(state.controls);
      controls.switches[comp.id] = on;
      const r = settleAll(def, state, controls);
      state.controls = controls;
      state.worlds = r.kept;
      for (const f of r.events) state.fuseEvents.push({ comp: f, seq: ctx.seq });
      const stateWord = comp.control === 'thermostat' ? (on ? 'HOT (closed)' : 'COLD (open)') : on ? 'ON' : 'OFF';
      const blewNote = r.events.length ? ` ${listJoin(r.events.map((f) => compLabel(def, f)))} blew!` : '';
      return {
        state,
        observation: { loads: r.loads, events: r.events, summary: `Set ${comp.label} to ${stateWord}.${blewNote}` },
        annotations: {
          comp: comp.id,
          on,
          powerOn: controls.power,
          aliveBefore,
          aliveAfter: r.kept.length,
          eliminated: r.eliminated,
          fuseBlew: r.events,
          reproduce: !!def.reproduce && def.reproduce.comp === comp.id && def.reproduce.on === on,
          operatingOk: isOperating(def, controls) && loadsHealthy(def, realWorld(state), controls),
        },
        message: r.events.length ? `Pop! ${listJoin(r.events.map((f) => compLabel(def, f)))} blew.` : undefined,
        messageTone: r.events.length ? 'danger' : undefined,
      };
    }

    case 'set_plug': {
      const comp = compOf(p.comp);
      if (!comp || comp.control !== 'plug') return err('That connector cannot be unplugged.');
      const plugged = !!p.plugged;
      const controls = cloneControls(state.controls);
      controls.plugged[comp.id] = plugged;
      const r = settleAll(def, state, controls);
      state.controls = controls;
      state.worlds = r.kept;
      for (const f of r.events) state.fuseEvents.push({ comp: f, seq: ctx.seq });
      return {
        state,
        observation: { loads: r.loads, events: r.events, summary: `${plugged ? 'Reconnected' : 'Unplugged'} ${comp.label}.` },
        annotations: {
          comp: comp.id,
          plugged,
          powerOn: controls.power,
          aliveBefore,
          aliveAfter: r.kept.length,
          eliminated: r.eliminated,
          fuseBlew: r.events,
          operatingOk: isOperating(def, controls) && loadsHealthy(def, realWorld(state), controls),
        },
      };
    }

    case 'measure': {
      const mode = p.mode as MeterMode;
      const red = String(p.red ?? '');
      const black = String(p.black ?? '');
      if (!['V', 'R', 'C'].includes(mode)) return err('Choose a meter mode.');
      const nodeIds = new Set(def.circuit.nodes.map((n) => n.id));
      if (!nodeIds.has(red) || !nodeIds.has(black)) return err('Place both probes on test points first.');
      const real = realWorld(state);
      const raw = measure(def, real, state.controls, mode, red, black);
      const reading = toMeterReading(mode, red, black, raw);
      const kept = state.worlds.filter((w) => readingsMatch(measure(def, w, state.controls, mode, red, black), raw, mode));
      const pairKey = [red, black].sort().join('~');
      const key = `${mode === 'C' ? 'R' : mode}|${pairKey}|${configSig(state)}`;
      const redundant = state.measureKeys.includes(key);
      const line = lineSideNodes(def);
      const verification =
        mode === 'V' &&
        !state.controls.power &&
        red !== black &&
        raw.kind === 'value' &&
        Math.abs(raw.value) < 0.5 &&
        !(line.has(red) && line.has(black)) &&
        !line.has(red) &&
        !line.has(black);
      const battery = def.circuit.comps.find((c) => c.kind === 'battery');
      const acrossSource =
        !!battery && ((red === battery.b && black === battery.a) || (red === battery.a && black === battery.b));
      const nominal = battery?.v ?? 12;
      const sourceEvidence =
        mode === 'V' && state.controls.power && raw.kind === 'value' && (acrossSource || Math.abs(raw.value) >= 0.85 * nominal);
      const annotations = {
        mode,
        red,
        black,
        powerOn: state.controls.power,
        lockout: state.controls.lockout,
        display: reading.display,
        value: reading.value,
        voltagePresent: raw.kind === 'live',
        aliveBefore,
        aliveAfter: kept.length,
        eliminated: aliveBefore - kept.length,
        redundant,
        sameNode: red === black,
        verification,
        acrossSource,
        sourceEvidence,
        contact: mode !== 'V',
        verifiedDead: state.verifiedDeadSeq !== null,
      };
      state.worlds = kept;
      state.readings += 1;
      state.lastReading = reading;
      if (!redundant) state.measureKeys.push(key);
      if (verification) state.verifiedDeadSeq = ctx.seq;
      return {
        state,
        observation: {
          reading,
          summary: `${MODE_NAMES[mode]} ${tpLabel(def, red)} → ${tpLabel(def, black)}: ${reading.display}${reading.beep ? ' (beep)' : ''}`,
        },
        annotations,
        message: raw.kind === 'live' ? 'The meter shows a voltage warning: this circuit is live!' : undefined,
        messageTone: raw.kind === 'live' ? 'danger' : undefined,
      };
    }

    case 'inspect': {
      const comp = compOf(p.comp);
      if (!comp) return err('Select a component to inspect.');
      const real = realWorld(state);
      const text = inspect(def, real, comp.id, instance.difficulty);
      const kept = state.worlds.filter((w) => inspect(def, w, comp.id, instance.difficulty) === text);
      const generic = inspect(def, { id: 'x', faults: [], blown: [], relay: {} }, comp.id, instance.difficulty);
      state.worlds = kept;
      state.inspected[comp.id] = text;
      return {
        state,
        observation: { comp: comp.id, text, summary: `Inspected ${comp.label}: ${text}` },
        annotations: { comp: comp.id, clueFound: text !== generic, aliveBefore, aliveAfter: kept.length, eliminated: aliveBefore - kept.length },
      };
    }

    case 'bench_test': {
      const comp = compOf(p.comp);
      if (!comp || !comp.replaceable || comp.kind === 'relay_contact') return err('That component cannot be bench-tested.');
      const live = compEnergized(def, state, comp.id);
      const real = realWorld(state);
      const raw = benchTest(def, real, comp.id);
      const display = formatBench(def, comp.id, raw);
      const kept = state.worlds.filter((w) => readingsMatch(benchTest(def, w, comp.id), raw, 'R'));
      const key = `B|${comp.id}|${state.replaced.filter((r) => r.comp === comp.id).length}`;
      const redundant = state.measureKeys.includes(key);
      if (!redundant) state.measureKeys.push(key);
      state.worlds = kept;
      state.bench[comp.id] = display;
      state.readings += 1;
      return {
        state,
        observation: { comp: comp.id, display, summary: `Bench-tested ${comp.label}: ${display}` },
        annotations: {
          comp: comp.id,
          contact: true,
          live,
          powerOn: state.controls.power,
          lockout: state.controls.lockout,
          verifiedDead: state.verifiedDeadSeq !== null,
          display,
          aliveBefore,
          aliveAfter: kept.length,
          eliminated: aliveBefore - kept.length,
          redundant,
        },
      };
    }

    case 'replace': {
      const comp = compOf(p.comp);
      if (!comp || !comp.replaceable) return err('That component cannot be replaced.');
      const live = compEnergized(def, state, comp.id);
      const real = realWorld(state);
      const unitComps = comp.unit ? def.circuit.comps.filter((c) => c.unit === comp.unit).map((c) => c.id) : [comp.id];
      const wasFaulty = unitComps.some((id) => compHasFault(def, real, id));
      const wasBlownFuse = comp.kind === 'fuse' && real.blown.includes(comp.id);
      const faultyIn = state.worlds.filter((w) => unitComps.some((id) => compHasFault(def, w, id)) || (comp.kind === 'fuse' && w.blown.includes(comp.id)));
      const provenGood = faultyIn.length === 0;
      const evidenceBased = faultyIn.length === state.worlds.length;
      const shortPresent = wasBlownFuse && activeFaults(def, real).some((f) => f.type === 'short');
      const sourceStillSuspect = state.worlds.some((w) => activeFaults(def, w).some((f) => f.type === 'weak'));

      // The repair clears faults on the unit in every world.
      const clear = (w: World): World => {
        const nw = cloneWorld(w);
        nw.faults = nw.faults.filter((id) => {
          const f = faultById(def, id);
          const fc = def.circuit.comps.find((c) => c.id === f.comp);
          return !(unitComps.includes(f.comp) || unitComps.includes(f.target) || (comp.unit && fc?.unit === comp.unit));
        });
        if (comp.kind === 'fuse') nw.blown = nw.blown.filter((b) => b !== comp.id);
        return nw;
      };
      state.worlds = state.worlds.map(clear);
      const r = settleAll(def, state, state.controls);
      state.worlds = r.kept;
      state.replaced.push({ comp: comp.id, seq: ctx.seq });
      state.partsCost += comp.cost;
      for (const f of r.events) state.fuseEvents.push({ comp: f, seq: ctx.seq });
      const verb = repairVerb(comp.kind);
      return {
        state,
        observation: { comp: comp.id, cost: comp.cost, loads: r.loads, events: r.events, summary: `${verb} ${comp.label} ($${comp.cost}).` },
        annotations: {
          comp: comp.id,
          cost: comp.cost,
          contact: true,
          live,
          powerOn: state.controls.power,
          lockout: state.controls.lockout,
          verifiedDead: state.verifiedDeadSeq !== null,
          wasFaulty,
          wasBlownFuse,
          shortPresent,
          sourceStillSuspect,
          provenGood,
          evidenceBased,
          aliveBefore,
          candidatesWithPart: faultyIn.length,
          aliveAfter: r.kept.length,
          fuseBlew: r.events,
          operatingOk: isOperating(def, state.controls) && loadsHealthy(def, realWorld(state), state.controls),
        },
        message: live ? 'Warning: you worked on an energized component.' : undefined,
        messageTone: live ? 'danger' : undefined,
      };
    }

    case 'diagnose': {
      const list = Array.isArray(p.faults) ? (p.faults as Array<{ comp: string; type: FaultType }>) : [];
      if (list.length === 0) return err('Select at least one failed part and failure mode.');
      if (list.length > 3) return err('Record at most three faults.');
      const clean: Array<{ comp: string; type: FaultType }> = [];
      for (const f of list) {
        const comp = compOf(f.comp);
        if (!comp || !FAULT_LABELS[comp.kind]?.[f.type]) return err('Invalid diagnosis entry.');
        clean.push({ comp: comp.id, type: f.type });
      }
      state.diagnosis = clean;
      const text = clean.map((f) => `${compLabel(def, f.comp)}: ${faultTypeLabel(compOf(f.comp)!.kind, f.type).toLowerCase()}`).join('; ');
      return { state, observation: { diagnosis: clean, summary: `Recorded diagnosis: ${text}.` }, annotations: { entries: clean.length } };
    }

    case 'complete_work_order': {
      const real = realWorld(state);
      const operating: Controls = { power: true, lockout: false, switches: { ...state.controls.switches, ...def.operating.switches }, plugged: {} };
      const working = loadsHealthy(def, real, operating);
      state.completed = true;
      return {
        state,
        observation: { summary: 'Completed the work order.' },
        annotations: { working, hasDiagnosis: state.diagnosis.length > 0 },
        complete: true,
      };
    }

    default:
      return err(`Unknown action "${action.type}".`);
  }
}

export function publicStateElectrical(instance: Inst, state: ElecState): ElecPublicState {
  const def = getDef(instance.templateId);
  const s = settle(def, realWorld(state), state.controls);
  return {
    power: state.controls.power,
    lockout: state.controls.lockout,
    switches: state.controls.switches,
    plugged: Object.fromEntries(def.circuit.comps.filter((c) => c.control === 'plug').map((c) => [c.id, state.controls.plugged[c.id] !== false])),
    loads: loadViews(def, s.world, s),
    replaced: state.replaced,
    partsCost: state.partsCost,
    readings: state.readings,
    lastReading: state.lastReading,
    diagnosis: state.diagnosis,
    inspected: state.inspected,
    bench: state.bench,
    fuseEvents: state.fuseEvents,
  };
}

export function describeElectricalAction(entry: LoggedAction): string {
  if (entry.type === 'hint') return `Used a hint (level ${entry.payload?.level ?? '?'})`;
  const s = entry.observation?.summary;
  if (typeof s === 'string') return s.replace(/\.$/, '');
  return entry.type.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

export function hintElectrical(instance: Inst, state: ElecState, _log: LoggedAction[], level: number): HintResult {
  const def = getDef(instance.templateId);
  const maxLevel = 3;
  const lvl = clamp(Math.round(level), 1, maxLevel);
  const label = (id: string) => compLabel(def, id);

  if (lvl === 1) {
    let text: string;
    if (def.reproduce && state.controls.switches[def.reproduce.comp] !== def.reproduce.on && state.readings === 0) {
      text = `${def.reproduce.label} first to reproduce the complaint. Does the relay click? Does the fan run? That tells you whether the control circuit or the load circuit has the problem.`;
    } else if (def.initial.blown.length) {
      text = 'A fuse that blows instantly means too much current: a short to ground. Don\'t install another fuse yet. Isolate the circuit, lock out, verify 0 V, and use resistance readings to GND. Unplugging branches tells you which side the short is on.';
    } else {
      text = 'Work systematically from the source toward the load. With power ON, a good wire, fuse or closed switch has almost 0 V across it, while an open part has the full supply across it. Pick test points that split the suspect section in half.';
    }
    return { level: lvl, maxLevel, text };
  }

  const comps = new Set<string>();
  for (const w of state.worlds) for (const f of activeFaults(def, w)) comps.add(f.comp);
  const candidates = [...comps].map(label);

  if (lvl === 2) {
    if (state.worlds.length <= 1) {
      return { level: lvl, maxLevel, text: 'Your readings already point to a single cause. Isolate safely (power OFF, lockout, verify 0 V), repair it, then restore power and verify the circuit works.' };
    }
    return {
      level: lvl,
      maxLevel,
      text: `Based on everything you've observed, ${plural(state.worlds.length, 'possibility', 'possibilities')} remain, involving ${listJoin(candidates, 'or')}. Choose a test where those possibilities would give different readings.`,
    };
  }

  // Level 3: the planner's best next test from the current state.
  if (state.worlds.length <= 1) {
    const real = realWorld(state);
    const target = activeFaults(def, real)[0];
    const name = target ? label(target.comp) : 'the faulty part';
    return {
      level: lvl,
      maxLevel,
      text: `Your evidence points to ${name}. Switch the disconnect OFF, apply your lockout, verify 0 V, ${repairVerb(def.circuit.comps.find((c) => c.id === target?.comp)?.kind ?? '').toLowerCase()} it, then restore power and confirm normal operation.`,
    };
  }
  const phase = state.controls.power ? 'live' : 'dead';
  let choice = bestProbe(def, state.worlds, state.controls, phase);
  if (!choice && phase === 'live') {
    return {
      level: lvl,
      maxLevel,
      text: 'Live voltage readings cannot narrow this down any further. Switch OFF at the disconnect, lock out, verify 0 V, and then use resistance tests, bench tests or unplugging to isolate the fault.',
    };
  }
  if (!choice) choice = bestProbe(def, state.worlds, state.controls, 'live');
  if (!choice) return { level: lvl, maxLevel, text: `Inspect the remaining candidates: ${listJoin(candidates)}.` };
  const steps = choice.probes.map((pr) => describeProbe(def, pr, state.controls.power));
  return { level: lvl, maxLevel, text: `Try this next: ${steps.join(', then ')}. Predict what each remaining possibility would show before you look.` };
}

export function revealElectrical(instance: Inst, state: ElecState): ElecReveal {
  const def = getDef(instance.templateId);
  const faults = instance.config.faultIds.map((id) => faultById(def, id));
  return {
    faults: faults.map((f) => ({ comp: f.comp, type: f.type, title: f.title, detail: f.detail })),
    faultyComps: [...new Set(faults.map((f) => f.comp))],
    expertSteps: state.expert.steps,
  };
}
