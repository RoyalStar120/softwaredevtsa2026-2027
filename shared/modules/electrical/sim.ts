/**
 * Electrical simulation: turns a circuit + active faults + learner controls into node
 * voltages, branch currents, observable load behaviour, and instrument readings.
 *
 * A "world" is one possible version of reality (a set of faults plus dynamic state such as
 * blown fuses and relay positions). The real scenario is one world; the hypothesis tracker
 * runs the same learner actions through every still-plausible world to judge how much each
 * measurement actually told the learner.
 */

import type { CircuitComp, Controls, ElecTemplateDef, FaultDef, LoadView, MeterMode, MeterReading } from './types.ts';
import { METER_IMPEDANCE, OPEN_R, solveNodal, type Conductance, type CurrentSource } from './solver.ts';

export interface World {
  id: string;
  faults: string[];
  blown: string[];
  relay: Record<string, boolean>;
}

export interface SolveResult {
  v: Record<string, number>;
  current: Record<string, number>;
}

export interface SettleResult extends SolveResult {
  world: World;
  events: string[]; // fuses that blew during this settle
}

export type RawReading = { kind: 'value'; value: number } | { kind: 'OL' } | { kind: 'live'; value: number };

const netCache = new WeakMap<object, Map<string, number>>();
const faultCache = new WeakMap<object, Map<string, FaultDef>>();

function nodeIndex(def: ElecTemplateDef): Map<string, number> {
  let idx = netCache.get(def);
  if (!idx) {
    idx = new Map();
    for (const n of def.circuit.nodes) if (n.id !== def.circuit.ground) idx.set(n.id, idx.size);
    netCache.set(def, idx);
  }
  return idx;
}

export function faultById(def: ElecTemplateDef, id: string): FaultDef {
  let map = faultCache.get(def);
  if (!map) {
    map = new Map(def.faults.map((f) => [f.id, f]));
    faultCache.set(def, map);
  }
  const f = map.get(id);
  if (!f) throw new Error(`Unknown fault ${id}`);
  return f;
}

export function activeFaults(def: ElecTemplateDef, world: World): FaultDef[] {
  return world.faults.map((id) => faultById(def, id));
}

function faultsByTarget(def: ElecTemplateDef, world: World): Map<string, FaultDef[]> {
  const m = new Map<string, FaultDef[]>();
  for (const f of activeFaults(def, world)) {
    const list = m.get(f.target) ?? [];
    list.push(f);
    m.set(f.target, list);
  }
  return m;
}

export function compResistance(
  comp: CircuitComp,
  world: World,
  controls: Controls,
  fb: Map<string, FaultDef[]>,
  ignoreControls = false,
): number {
  const fs = fb.get(comp.id) ?? [];
  if (comp.kind === 'battery') return fs.find((f) => f.type === 'weak')?.internalR ?? comp.r;
  if (fs.some((f) => f.type === 'open')) return OPEN_R;
  if (comp.kind === 'fuse' && world.blown.includes(comp.id)) return OPEN_R;
  if (!ignoreControls) {
    if (comp.control === 'power' && !controls.power) return OPEN_R;
    if ((comp.control === 'switch' || comp.control === 'thermostat') && !controls.switches[comp.id]) return OPEN_R;
    if (comp.control === 'plug' && controls.plugged[comp.id] === false) return OPEN_R;
  }
  if (comp.kind === 'relay_contact' && !world.relay[comp.coil ?? '']) return OPEN_R;
  const short = fs.find((f) => f.type === 'short');
  if (short) return short.value ?? 0.05;
  const hr = fs.find((f) => f.type === 'high_resistance');
  if (hr) return comp.r + (hr.value ?? 10);
  return comp.r;
}

function batteryVoltage(comp: CircuitComp, fb: Map<string, FaultDef[]>): number {
  return fb.get(comp.id)?.find((f) => f.type === 'weak')?.value ?? comp.v ?? 12;
}

export function solve(
  def: ElecTemplateDef,
  world: World,
  controls: Controls,
  opts: { zeroSources?: boolean; meter?: [string, string]; inject?: { from: string; to: string; amps: number } } = {},
): SolveResult {
  const { circuit } = def;
  const index = nodeIndex(def);
  const idx = (id: string) => (id === circuit.ground ? -1 : (index.get(id) as number));
  const fb = faultsByTarget(def, world);
  const els: Conductance[] = [];
  const srcs: CurrentSource[] = [];
  const gOf: Record<string, number> = {};

  for (const c of circuit.comps) {
    const r = Math.max(1e-4, compResistance(c, world, controls, fb));
    const g = 1 / r;
    gOf[c.id] = g;
    els.push({ a: idx(c.a), b: idx(c.b), g });
    if (c.kind === 'battery' && !opts.zeroSources) {
      srcs.push({ a: idx(c.a), b: idx(c.b), i: batteryVoltage(c, fb) / r });
    }
  }
  for (const h of circuit.hidden) {
    const f = (fb.get(h.id) ?? []).find((x) => x.type === 'short');
    if (f) els.push({ a: idx(h.a), b: idx(h.b), g: 1 / (f.value ?? 0.05) });
  }
  if (opts.meter) els.push({ a: idx(opts.meter[0]), b: idx(opts.meter[1]), g: 1 / METER_IMPEDANCE });
  if (opts.inject) srcs.push({ a: idx(opts.inject.from), b: idx(opts.inject.to), i: opts.inject.amps });

  const vv = solveNodal(index.size, els, srcs);
  const v: Record<string, number> = { [circuit.ground]: 0 };
  for (const [id, k] of index) v[id] = vv[k];
  const current: Record<string, number> = {};
  for (const c of circuit.comps) current[c.id] = c.kind === 'battery' ? 0 : (v[c.a] - v[c.b]) * gOf[c.id];
  return { v, current };
}

export function cloneWorld(w: World): World {
  return { id: w.id, faults: [...w.faults], blown: [...w.blown], relay: { ...w.relay } };
}

/** Solves the circuit and lets dynamic behaviour settle (relays pull in, overloaded fuses blow). */
export function settle(def: ElecTemplateDef, world0: World, controls: Controls): SettleResult {
  const world = cloneWorld(world0);
  const events: string[] = [];
  let res = solve(def, world, controls);
  for (let iter = 0; iter < 10; iter++) {
    let changed = false;
    for (const coil of def.circuit.comps) {
      if (coil.kind !== 'relay_coil') continue;
      const effectiveV = Math.abs(res.current[coil.id]) * coil.r; // coil current drives the armature
      const closed = !!world.relay[coil.id];
      const next = closed ? effectiveV >= (coil.dropOut ?? 3) : effectiveV >= (coil.pullIn ?? 7.5);
      if (next !== closed) {
        world.relay[coil.id] = next;
        changed = true;
      }
    }
    for (const fuse of def.circuit.comps) {
      if (fuse.kind !== 'fuse' || world.blown.includes(fuse.id)) continue;
      if (Math.abs(res.current[fuse.id]) > 2 * (fuse.rating ?? 10)) {
        world.blown.push(fuse.id);
        events.push(fuse.id);
        changed = true;
      }
    }
    if (!changed) break;
    res = solve(def, world, controls);
  }
  return { world, v: res.v, current: res.current, events };
}

export function loadViews(def: ElecTemplateDef, world: World, res: SolveResult): LoadView[] {
  const out: LoadView[] = [];
  const fb = faultsByTarget(def, world);
  for (const c of def.circuit.comps) {
    if (c.kind === 'lamp' || c.kind === 'motor') {
      const shorted = (fb.get(c.id) ?? []).some((f) => f.type === 'short');
      const i = res.current[c.id];
      const p = shorted ? 0 : i * i * c.r;
      const intensity = Math.round((p / (c.rating ?? 10)) * 100) / 100;
      const level =
        c.kind === 'lamp'
          ? intensity < 0.05
            ? 'off'
            : intensity < 0.55
              ? 'dim'
              : 'normal'
          : intensity < 0.1
            ? 'stopped'
            : intensity < 0.6
              ? 'slow'
              : 'running';
      out.push({ id: c.id, kind: c.kind, level, intensity });
    } else if (c.kind === 'relay_coil') {
      const on = !!world.relay[c.id];
      out.push({ id: c.id, kind: 'relay', level: on ? 'energized' : 'idle', intensity: on ? 1 : 0 });
    }
  }
  return out;
}

export function loadSignature(loads: LoadView[], events: string[]): string {
  return `${loads.map((l) => `${l.id}:${l.level}`).join(',')}|${[...events].sort().join(',')}`;
}

/** Multimeter reading on a settled world. */
export function measure(
  def: ElecTemplateDef,
  world: World,
  controls: Controls,
  mode: MeterMode,
  red: string,
  black: string,
): RawReading {
  if (red === black) return { kind: 'value', value: 0 };
  const live = solve(def, world, controls, { meter: [red, black] });
  const vdiff = live.v[red] - live.v[black];
  if (mode === 'V') return { kind: 'value', value: vdiff };
  if (Math.abs(vdiff) > 0.5) return { kind: 'live', value: vdiff };
  const r = solve(def, world, controls, { zeroSources: true, inject: { from: black, to: red, amps: 1e-3 } });
  const R = (r.v[red] - r.v[black]) / 1e-3;
  if (!(R < 2e7)) return { kind: 'OL' };
  return { kind: 'value', value: Math.max(0, R) };
}

/** Bench test of a component removed from the circuit. Batteries get a load test (volts). */
export function benchTest(def: ElecTemplateDef, world: World, compId: string): RawReading {
  const comp = def.circuit.comps.find((c) => c.id === compId);
  if (!comp) return { kind: 'OL' };
  const fb = faultsByTarget(def, world);
  if (comp.kind === 'battery') {
    const v = batteryVoltage(comp, fb);
    const r = compResistance(comp, world, { power: true, lockout: false, switches: {}, plugged: {} }, fb);
    const loadR = 2; // load tester
    return { kind: 'value', value: (v * loadR) / (loadR + r) };
  }
  const allOn: { power: boolean; lockout: boolean; switches: Record<string, boolean>; plugged: Record<string, boolean> } = {
    power: true,
    lockout: false,
    switches: { [comp.id]: comp.kind === 'switch' }, // switches are tested in the ON position; thermostats cold
    plugged: { [comp.id]: true },
  };
  const R = compResistance(comp, world, allOn, fb, comp.kind === 'switch');
  if (R >= OPEN_R) return { kind: 'OL' };
  return { kind: 'value', value: R };
}

export function readingsMatch(a: RawReading, b: RawReading, mode: MeterMode | 'bench'): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'OL') return true;
  const x = (a as { value: number }).value;
  const y = (b as { value: number }).value;
  if (a.kind === 'live') return true;
  if (mode === 'V') return Math.abs(x - y) <= Math.max(0.15, 0.04 * Math.abs(y));
  if (x < 1 && y < 1) return Math.abs(x - y) <= 0.12;
  return Math.abs(x - y) <= 0.1 * Math.max(x, y);
}

export function formatOhms(R: number): string {
  if (R < 10) return `${R.toFixed(2)} Ω`;
  if (R < 1000) return `${R.toFixed(1)} Ω`;
  if (R < 1e6) return `${(R / 1000).toFixed(2)} kΩ`;
  return `${(R / 1e6).toFixed(2)} MΩ`;
}

export function toMeterReading(mode: MeterMode, red: string, black: string, raw: RawReading): MeterReading {
  if (raw.kind === 'live') {
    return { mode, red, black, display: 'VOLT!', value: null, overload: false, voltagePresent: true, beep: false };
  }
  if (raw.kind === 'OL') {
    return { mode, red, black, display: 'OL', value: null, overload: true, voltagePresent: false, beep: false };
  }
  const v = raw.value;
  if (mode === 'V') {
    const shown = Math.abs(v) < 0.005 ? 0 : v;
    return { mode, red, black, display: `${shown.toFixed(2)} V`, value: Math.round(shown * 100) / 100, overload: false, voltagePresent: false, beep: false };
  }
  if (mode === 'C') {
    if (v > 2000) return { mode, red, black, display: 'OL', value: null, overload: true, voltagePresent: false, beep: false };
    return { mode, red, black, display: formatOhms(v), value: Math.round(v * 100) / 100, overload: false, voltagePresent: false, beep: v < 2 };
  }
  return { mode, red, black, display: formatOhms(v), value: Math.round(v * 100) / 100, overload: false, voltagePresent: false, beep: false };
}

export function formatBench(def: ElecTemplateDef, compId: string, raw: RawReading): string {
  const comp = def.circuit.comps.find((c) => c.id === compId);
  if (comp?.kind === 'battery' && raw.kind === 'value') {
    const pass = raw.value >= 10.5;
    return `${raw.value.toFixed(1)} V under load - ${pass ? 'PASS' : 'FAIL'}`;
  }
  if (raw.kind === 'OL') return 'OL (open)';
  if (raw.kind === 'value') return formatOhms(raw.value);
  return 'n/a';
}

const GENERIC_INSPECTION: Record<string, string> = {
  battery: 'Case is intact and terminals are clean and tight.',
  disconnect: 'Disconnect operates normally.',
  fuse: 'Fuse is seated firmly in its holder.',
  switch: 'Switch toggles with a normal click. No visible damage.',
  thermostat: 'Thermostat housing is intact; connector is seated.',
  lamp: 'Bulb is seated in its socket. No visible damage.',
  motor: 'Fan blades spin freely by hand. No burn marks.',
  wire: 'Insulation looks intact along the visible length.',
  connector: 'Connector halves are latched together.',
  relay_coil: 'Relay is seated in its socket. No visible damage.',
  relay_contact: 'Relay is seated in its socket. No visible damage.',
};

/** Visual inspection result. Clues only show at lower difficulties. */
export function inspect(def: ElecTemplateDef, world: World, compId: string, difficulty: number): string {
  const comp = def.circuit.comps.find((c) => c.id === compId);
  if (!comp) return 'Nothing to inspect.';
  for (const f of activeFaults(def, world)) {
    if ((f.comp === compId || f.target === compId) && f.clue && difficulty <= (f.clueMaxDifficulty ?? 0)) return f.clue;
  }
  if (comp.kind === 'fuse' && world.blown.includes(comp.id)) {
    return difficulty <= 3
      ? 'The fuse element is melted through and the glass is darkened. This fuse is blown.'
      : 'Ceramic fuse body: the element is not visible. You will need to test it.';
  }
  if (comp.kind === 'fuse' && difficulty >= 4) return 'Ceramic fuse body: the element is not visible. You will need to test it.';
  return GENERIC_INSPECTION[comp.kind] ?? 'No visible damage.';
}
