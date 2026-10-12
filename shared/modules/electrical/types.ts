/**
 * Electrical module types. Public view/state types are imported (type-only) by the client.
 */

import type { ScenarioTemplate } from '../../types.ts';

export type CompKind =
  | 'battery'
  | 'disconnect'
  | 'fuse'
  | 'switch'
  | 'thermostat'
  | 'lamp'
  | 'motor'
  | 'wire'
  | 'connector'
  | 'relay_coil'
  | 'relay_contact';

export type FaultType = 'open' | 'high_resistance' | 'short' | 'weak';
export type MeterMode = 'V' | 'R' | 'C';
export type ControlKind = 'power' | 'switch' | 'thermostat' | 'plug';

export interface CircuitNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface CircuitComp {
  id: string;
  kind: CompKind;
  label: string;
  spec: string;
  a: string; // for batteries: negative terminal
  b: string; // for batteries: positive terminal
  /** Nominal resistance in ohms (battery: internal resistance). */
  r: number;
  /** Battery voltage. */
  v?: number;
  /** Fuse current rating (A) or rated power of lamps / motors (W). */
  rating?: number;
  /** Relay coil pull-in / drop-out voltage. */
  pullIn?: number;
  dropOut?: number;
  /** relay_contact: id of the coil that drives it. */
  coil?: string;
  /** Replacement unit (relay coil + contacts are one part). */
  unit?: string;
  cost: number;
  replaceable: boolean;
  control?: ControlKind;
  /** Drawing polyline (viewBox coordinates). */
  pts: Array<[number, number]>;
  /** Draw a chassis-ground symbol at the last point. */
  groundEnd?: boolean;
  /** Friendly name used in symptoms, e.g. "porch light". */
  friendly?: string;
}

/** A possible short path that is not drawn (e.g. wire insulation chafed to chassis). */
export interface HiddenPath {
  id: string;
  a: string;
  b: string;
}

export interface FaultDef {
  id: string;
  /** Component id or hidden path id that changes electrically. */
  target: string;
  /** Component the learner should name in the diagnosis. */
  comp: string;
  type: FaultType;
  /** high_resistance / short: resistance (ohms). weak: battery voltage. */
  value?: number;
  /** weak battery: internal resistance. */
  internalR?: number;
  title: string;
  detail: string;
  clue?: string;
  clueMaxDifficulty?: number;
  emphasis: Record<string, number>;
  minDifficulty: number;
  maxDifficulty: number;
}

export interface CircuitDef {
  width: number;
  height: number;
  ground: string;
  nodes: CircuitNode[];
  comps: CircuitComp[];
  hidden: HiddenPath[];
}

export interface Controls {
  power: boolean;
  lockout: boolean;
  switches: Record<string, boolean>;
  plugged: Record<string, boolean>;
}

export interface ElecTemplateDef {
  template: ScenarioTemplate;
  circuit: CircuitDef;
  faults: FaultDef[];
  initial: { controls: Controls; blown: string[] };
  /** Controls that define "normal operation" for verifying the repair. */
  operating: { switches: Record<string, boolean> };
  /** Control that must be set to reproduce the symptom (e.g. thermostat hot). */
  reproduce?: { comp: string; on: boolean; label: string };
  allowDouble: boolean;
  /** Diagnosis entries accepted as harmless extras, e.g. "F1:open" when a short blew the fuse. */
  acceptableExtras: string[];
  story: (ctx: StoryContext) => { title: string; briefing: string; goal: string; constraints: string[]; objectives: string[] };
}

export interface StoryContext {
  difficulty: number;
  faults: FaultDef[];
  symptom: string;
  workOrder: number;
  customer: string;
}

// ---------------------------------------------------------------------------
// Instance config (hidden ground truth)
// ---------------------------------------------------------------------------

export interface ElecConfig {
  faultIds: string[];
  symptom: string;
}

// ---------------------------------------------------------------------------
// Public (client-visible) shapes
// ---------------------------------------------------------------------------

export interface PublicComp {
  id: string;
  kind: CompKind;
  label: string;
  spec: string;
  a: string;
  b: string;
  cost: number;
  replaceable: boolean;
  repairVerb: string;
  control?: ControlKind;
  pts: Array<[number, number]>;
  groundEnd?: boolean;
  coil?: string;
  unit?: string;
}

export interface FaultOption {
  type: FaultType;
  label: string;
}

export interface ElecView {
  width: number;
  height: number;
  ground: string;
  nodes: CircuitNode[];
  comps: PublicComp[];
  faultOptions: Record<string, FaultOption[]>; // by component id
  reproduce?: { comp: string; on: boolean; label: string };
  safetyNotice: string;
}

export interface LoadView {
  id: string;
  kind: 'lamp' | 'motor' | 'relay';
  level: 'off' | 'dim' | 'normal' | 'stopped' | 'slow' | 'running' | 'idle' | 'energized';
  intensity: number; // 0..1+
}

export interface MeterReading {
  mode: MeterMode;
  red: string;
  black: string;
  display: string;
  value: number | null;
  overload: boolean;
  voltagePresent: boolean;
  beep: boolean;
}

export interface ElecPublicState {
  power: boolean;
  lockout: boolean;
  switches: Record<string, boolean>;
  plugged: Record<string, boolean>;
  loads: LoadView[];
  replaced: Array<{ comp: string; seq: number }>;
  partsCost: number;
  readings: number;
  lastReading: MeterReading | null;
  diagnosis: Array<{ comp: string; type: FaultType }>;
  inspected: Record<string, string>;
  bench: Record<string, string>;
  fuseEvents: Array<{ comp: string; seq: number }>;
}

/** Revealed after completion. */
export interface ElecReveal {
  faults: Array<{ comp: string; type: FaultType; title: string; detail: string }>;
  faultyComps: string[];
  expertSteps: string[];
}
