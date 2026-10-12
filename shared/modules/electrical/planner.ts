/**
 * Hypothesis-driven expert planner.
 *
 * Given the set of fault hypotheses still consistent with everything observed, the planner
 * greedily picks the test whose possible outcomes split the hypotheses most evenly
 * (minimum expected remaining hypotheses). Repeating this yields an "expert path" that the
 * evaluator compares against the learner's actual measurements, and it powers the most
 * specific level of in-scenario hints.
 */

import type { Controls, ElecTemplateDef, MeterMode, MeterReading } from './types.ts';
import {
  activeFaults,
  benchTest,
  cloneWorld,
  formatBench,
  loadSignature,
  loadViews,
  measure,
  readingsMatch,
  settle,
  toMeterReading,
  type RawReading,
  type World,
} from './sim.ts';

export type Probe =
  | { kind: 'measure'; mode: MeterMode; red: string; black: string }
  | { kind: 'bench'; comp: string }
  | { kind: 'toggle'; comp: string; on: boolean }
  | { kind: 'plug'; comp: string; plugged: boolean };

export interface Observation {
  sig: string;
  raw: RawReading | null;
  mode: MeterMode | 'bench' | null;
}

export interface PlanResult {
  steps: string[];
  measurements: number;
  macros: Probe[][];
  deadPhase: boolean;
  resolved: boolean;
}

function cloneControls(c: Controls): Controls {
  return { power: c.power, lockout: c.lockout, switches: { ...c.switches }, plugged: { ...c.plugged } };
}

/** Applies a probe to one world. Returns the updated world/controls and what was observed. */
export function observeProbe(
  def: ElecTemplateDef,
  world: World,
  controls: Controls,
  probe: Probe,
): { world: World; controls: Controls; obs: Observation } {
  if (probe.kind === 'toggle' || probe.kind === 'plug') {
    const next = cloneControls(controls);
    if (probe.kind === 'toggle') next.switches[probe.comp] = probe.on;
    else next.plugged[probe.comp] = probe.plugged;
    const s = settle(def, world, next);
    return {
      world: s.world,
      controls: next,
      obs: { sig: loadSignature(loadViews(def, s.world, s), s.events), raw: null, mode: null },
    };
  }
  if (probe.kind === 'bench') {
    const raw = benchTest(def, world, probe.comp);
    return { world, controls, obs: { sig: `bench:${raw.kind}`, raw, mode: 'bench' } };
  }
  const raw = measure(def, world, controls, probe.mode, probe.red, probe.black);
  return { world, controls, obs: { sig: `${probe.mode}:${raw.kind}`, raw, mode: probe.mode } };
}

export function observationsMatch(a: Observation, b: Observation): boolean {
  if (a.sig !== b.sig) return false;
  if (!a.raw || !b.raw || !a.mode) return true;
  return readingsMatch(a.raw, b.raw, a.mode === 'bench' ? 'R' : a.mode);
}

/** Groups worlds by observation (tolerance-aware clustering for numeric readings). */
function groupSizes(obs: Observation[]): number[] {
  const groups: Observation[][] = [];
  for (const o of obs) {
    const g = groups.find((grp) => observationsMatch(grp[0], o));
    if (g) g.push(o);
    else groups.push([o]);
  }
  return groups.map((g) => g.length);
}

function candidates(def: ElecTemplateDef, controls: Controls, phase: 'live' | 'dead'): Array<{ probes: Probe[]; cost: number }> {
  const { circuit } = def;
  const out: Array<{ probes: Probe[]; cost: number }> = [];
  const ground = circuit.ground;
  const seenPairs = new Set<string>();
  const pairKey = (a: string, b: string) => [a, b].sort().join('|');
  const nodes = circuit.nodes.filter((n) => n.id !== ground);

  if (phase === 'live') {
    for (const c of circuit.comps) {
      if (c.a === c.b) continue;
      const k = pairKey(c.a, c.b);
      if (seenPairs.has(k)) continue;
      seenPairs.add(k);
      out.push({ probes: [{ kind: 'measure', mode: 'V', red: c.b === ground ? c.a : c.a, black: c.b }], cost: 1 });
    }
    for (const n of nodes) {
      const k = pairKey(n.id, ground);
      if (seenPairs.has(k)) continue;
      seenPairs.add(k);
      out.push({ probes: [{ kind: 'measure', mode: 'V', red: n.id, black: ground }], cost: 1 });
    }
    for (const c of circuit.comps) {
      if (c.control === 'switch' || c.control === 'thermostat') {
        out.push({ probes: [{ kind: 'toggle', comp: c.id, on: !controls.switches[c.id] }], cost: 1.2 });
      }
    }
  } else {
    for (const n of nodes) {
      out.push({ probes: [{ kind: 'measure', mode: 'R', red: n.id, black: ground }], cost: 1 });
      seenPairs.add(pairKey(n.id, ground));
    }
    for (const c of circuit.comps) {
      if (c.kind === 'battery' || c.kind === 'disconnect') continue;
      const k = pairKey(c.a, c.b);
      if (seenPairs.has(k)) continue;
      seenPairs.add(k);
      out.push({ probes: [{ kind: 'measure', mode: 'R', red: c.a, black: c.b }], cost: 1 });
    }
    for (const c of circuit.comps) {
      if (c.replaceable && c.kind !== 'relay_contact') out.push({ probes: [{ kind: 'bench', comp: c.id }], cost: 1.5 });
    }
    for (const c of circuit.comps) {
      if (c.control !== 'plug') continue;
      const plugged = controls.plugged[c.id] !== false;
      for (const n of nodes) {
        out.push({
          probes: [
            { kind: 'plug', comp: c.id, plugged: !plugged },
            { kind: 'measure', mode: 'R', red: n.id, black: ground },
          ],
          cost: 2,
        });
      }
    }
  }
  return out;
}

function runMacro(
  def: ElecTemplateDef,
  world: World,
  controls: Controls,
  probes: Probe[],
): { world: World; controls: Controls; obs: Observation } {
  let w = world;
  let c = controls;
  const sigs: string[] = [];
  let last: Observation = { sig: '', raw: null, mode: null };
  for (const p of probes) {
    const r = observeProbe(def, w, c, p);
    w = r.world;
    c = r.controls;
    sigs.push(r.obs.sig);
    last = r.obs;
  }
  return { world: w, controls: c, obs: { sig: sigs.join('>'), raw: last.raw, mode: last.mode } };
}

export interface GreedyChoice {
  probes: Probe[];
  expectedRemaining: number;
  phase: 'live' | 'dead';
}

/** Best next diagnostic step for the current state, or null when nothing can split the hypotheses. */
export function bestProbe(
  def: ElecTemplateDef,
  alive: World[],
  controls: Controls,
  phase: 'live' | 'dead',
): GreedyChoice | null {
  if (alive.length <= 1) return null;
  let best: GreedyChoice | null = null;
  let bestScore = Infinity;
  for (const cand of candidates(def, controls, phase)) {
    const obs = alive.map((w) => runMacro(def, w, controls, cand.probes).obs);
    const sizes = groupSizes(obs);
    if (sizes.length <= 1) continue;
    const expected = sizes.reduce((s, n) => s + n * n, 0) / alive.length;
    const score = expected + 0.01 * cand.cost;
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = { probes: cand.probes, expectedRemaining: expected, phase };
    }
  }
  return best;
}

export function tpLabel(def: ElecTemplateDef, nodeId: string): string {
  return def.circuit.nodes.find((n) => n.id === nodeId)?.label ?? nodeId;
}

export function describePair(def: ElecTemplateDef, red: string, black: string): string {
  const comp = def.circuit.comps.find((c) => (c.a === red && c.b === black) || (c.a === black && c.b === red));
  const pair = `${tpLabel(def, red)} → ${tpLabel(def, black)}`;
  return comp ? `across ${comp.label} (${pair})` : `from ${pair}`;
}

const MODE_LABEL: Record<MeterMode, string> = { V: 'DC voltage', R: 'resistance', C: 'continuity' };

export function describeProbe(def: ElecTemplateDef, p: Probe, powerOn: boolean): string {
  const label = (id: string) => def.circuit.comps.find((c) => c.id === id)?.label ?? id;
  switch (p.kind) {
    case 'measure':
      return `With power ${powerOn ? 'ON' : 'OFF and locked out'}, measure ${MODE_LABEL[p.mode]} ${describePair(def, p.red, p.black)}`;
    case 'bench':
      return `Remove ${label(p.comp)} and bench-test it`;
    case 'toggle':
      return `Turn ${label(p.comp)} ${p.on ? 'ON' : 'OFF'} and watch the loads`;
    case 'plug':
      return `${p.plugged ? 'Reconnect' : 'Unplug'} ${label(p.comp)}`;
  }
}

function hypothesisTitle(def: ElecTemplateDef, w: World): string {
  const fs = activeFaults(def, w);
  return fs.length ? fs.map((f) => f.title).join(' + ') : 'no permanent fault (one-time surge)';
}

export function repairVerb(kind: string): string {
  switch (kind) {
    case 'wire':
      return 'Repair';
    case 'connector':
      return 'Clean and reseat';
    case 'battery':
      return 'Replace';
    default:
      return 'Replace';
  }
}

/**
 * Builds the expert path from a starting state. `alive` must already be filtered by the
 * initial symptom observation; `realId` identifies the true world.
 */
export function planExpert(
  def: ElecTemplateDef,
  alive0: World[],
  controls0: Controls,
  realId: string,
): PlanResult {
  let alive = alive0.map(cloneWorld);
  let controls = cloneControls(controls0);
  const steps: string[] = [];
  const macros: Probe[][] = [];
  let measurements = 0;
  let phase: 'live' | 'dead' = controls.power ? 'live' : 'dead';
  let deadPhase = phase === 'dead';
  const label = (id: string) => def.circuit.comps.find((c) => c.id === id)?.label ?? id;

  if (def.reproduce && phase === 'live' && controls.switches[def.reproduce.comp] !== def.reproduce.on) {
    const probe: Probe = { kind: 'toggle', comp: def.reproduce.comp, on: def.reproduce.on };
    const real = alive.find((w) => w.id === realId)!;
    const realObs = observeProbe(def, real, controls, probe);
    const next = alive.map((w) => ({ w, r: observeProbe(def, w, controls, probe) }));
    alive = next.filter((x) => observationsMatch(x.r.obs, realObs.obs)).map((x) => x.r.world);
    controls = realObs.controls;
    macros.push([probe]);
    const loads = loadViews(def, realObs.world, settle(def, realObs.world, controls));
    steps.push(
      `${def.reproduce.label} to reproduce the complaint: ${loads.map((l) => `${label(l.id)} ${l.level}`).join(', ')}.`,
    );
  } else {
    const real = alive.find((w) => w.id === realId)!;
    const s = settle(def, real, controls);
    const loads = loadViews(def, s.world, s);
    steps.push(`Observe the symptom with the circuit operating: ${loads.map((l) => `${label(l.id)} ${l.level}`).join(', ')}.`);
  }

  for (let guard = 0; guard < 14 && alive.length > 1; guard++) {
    let choice = bestProbe(def, alive, controls, phase);
    if (!choice && phase === 'live') {
      phase = 'dead';
      deadPhase = true;
      controls = { ...cloneControls(controls), power: false, lockout: true };
      alive = alive.map((w) => settle(def, w, controls).world);
      steps.push('Switch the main disconnect OFF, apply your lockout tag, and verify 0 V on the load side.');
      choice = bestProbe(def, alive, controls, phase);
    }
    if (!choice) break;
    const real = alive.find((w) => w.id === realId)!;
    const realRun = runMacro(def, real, controls, choice.probes);
    const kept: World[] = [];
    for (const w of alive) {
      const r = runMacro(def, w, controls, choice.probes);
      if (observationsMatch(r.obs, realRun.obs)) kept.push(r.world);
    }
    alive = kept;
    const powerOn = controls.power;
    controls = realRun.controls;
    macros.push(choice.probes);

    const parts: string[] = [];
    for (const p of choice.probes) {
      if (p.kind === 'measure') {
        measurements++;
        const reading = realRun.obs.raw ? toMeterReading(p.mode, p.red, p.black, realRun.obs.raw) : null;
        parts.push(`${describeProbe(def, p, powerOn)}: reads ${reading?.display ?? '?'}`);
      } else if (p.kind === 'bench') {
        measurements++;
        parts.push(`${describeProbe(def, p, powerOn)}: ${realRun.obs.raw ? formatBench(def, p.comp, realRun.obs.raw) : '?'}`);
      } else {
        parts.push(describeProbe(def, p, powerOn));
      }
    }
    const remain =
      alive.length === 1
        ? `Only one explanation fits: ${hypothesisTitle(def, alive[0])}.`
        : `${alive.length} possibilities remain.`;
    steps.push(`${parts.join(', then ')}. ${remain}`);
  }

  const resolved = alive.length === 1;
  if (!resolved && alive.length > 1) {
    steps.push(
      `These possibilities can't be told apart by measurement alone: ${alive.map((w) => hypothesisTitle(def, w)).join('; ')}. Inspect the candidates.`,
    );
  }

  const real = alive.find((w) => w.id === realId) ?? alive0.find((w) => w.id === realId)!;
  if (!deadPhase) steps.push('Switch the main disconnect OFF, apply your lockout tag, and verify 0 V on the load side.');
  const repaired = new Set<string>();
  for (const f of activeFaults(def, real)) {
    if (repaired.has(f.comp)) continue;
    repaired.add(f.comp);
    const comp = def.circuit.comps.find((c) => c.id === f.comp);
    steps.push(`${repairVerb(comp?.kind ?? '')} ${comp?.label ?? f.comp} (${f.title.toLowerCase()}).`);
  }
  for (const fuse of real.blown) {
    if (!repaired.has(fuse)) steps.push(`Replace ${label(fuse)}, which blew because of the fault.`);
  }
  steps.push('Remove the lockout, restore power, operate the circuit and confirm every load works normally.');

  return { steps, measurements, macros, deadPhase, resolved };
}

export function readingFor(def: ElecTemplateDef, world: World, controls: Controls, p: Extract<Probe, { kind: 'measure' }>): MeterReading {
  return toMeterReading(p.mode, p.red, p.black, measure(def, world, controls, p.mode, p.red, p.black));
}
