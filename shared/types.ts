/**
 * SkillBridge core platform contracts.
 *
 * The shared platform standardizes HOW skills are tracked, evaluated and improved
 * (accounts, action logging, learner model, adaptive practice, coaching).
 * Each skill module (electrical, programming, ...) supplies its OWN interactions,
 * simulation rules, evaluation criteria, safety checks and feedback guidelines by
 * implementing the `SkillModule` interface below.
 *
 * Everything in /shared is isomorphic: pure, deterministic TypeScript that runs on
 * both the server (authoritative simulation + evaluation) and the browser.
 */

import type { Rng } from './rng.ts';

export type Role = 'learner' | 'instructor';

export type MasteryLevel = 'not_started' | 'novice' | 'developing' | 'proficient' | 'mastered';

export type Severity = 'minor' | 'major' | 'critical';

/** Verdict attached to every logged action in the post-scenario replay. */
export type Verdict = 'good' | 'neutral' | 'info' | 'wasted' | 'mistake' | 'unsafe';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

// ---------------------------------------------------------------------------
// Skills and scenarios
// ---------------------------------------------------------------------------

export interface SkillDef {
  id: string; // globally unique, e.g. "elec.voltage"
  moduleId: string;
  name: string;
  shortName: string;
  description: string;
  prerequisites: string[]; // skill ids
  tier: number; // row in the skill tree (0 = foundation)
  column: number; // horizontal slot inside the tier (for layout)
  kind: 'process' | 'concept' | 'safety';
}

export interface ScenarioTemplate {
  id: string; // e.g. "elec.porch-light"
  moduleId: string;
  title: string;
  summary: string;
  difficultyRange: [number, number]; // inclusive, 1..5
  /** How strongly the template exercises each skill (0..1). */
  skillWeights: Record<string, number>;
  /** Skills whose emphasis a variant can increase when the adaptive engine asks for focus. */
  focusable: string[];
  /** Skills that should be at least "developing" before this template is recommended. */
  prerequisites: string[];
  estimatedMinutes: number;
  tags: string[];
  /** Number of distinct fault / bug configurations this template can generate. */
  variantCount: number;
}

export interface GenerateOptions {
  seed: number;
  difficulty: number;
  /** Skills the adaptive engine wants this instance to emphasize. */
  focusSkills?: string[];
  /** Variant ids the learner has seen recently for this template (avoid repeating). */
  avoidVariants?: string[];
}

/**
 * A concrete, generated scenario. `config` contains the hidden ground truth
 * (faults, bugs) and must never be sent to the client before completion.
 */
export interface ScenarioInstance<C = unknown> {
  templateId: string;
  moduleId: string;
  seed: number;
  difficulty: number;
  variantId: string;
  title: string;
  briefing: string;
  goal: string;
  constraints: string[];
  objectives: string[];
  skillWeights: Record<string, number>;
  focusSkills: string[];
  config: C;
}

/** Learner-safe view of a scenario instance. */
export interface PublicScenario<V = unknown> {
  templateId: string;
  moduleId: string;
  difficulty: number;
  title: string;
  briefing: string;
  goal: string;
  constraints: string[];
  objectives: string[];
  focusSkills: string[];
  skillWeights: Record<string, number>;
  /** Module-specific static public data (circuit layout, starter code, tests ...). */
  view: V;
}

// ---------------------------------------------------------------------------
// Actions and tracking
// ---------------------------------------------------------------------------

export interface ModuleAction {
  type: string;
  payload?: any;
}

export interface ActionContext {
  seq: number; // 1-based step number this action will receive
  t: number; // ms since the attempt started
}

/** One entry in the authoritative, server-side action log. */
export interface LoggedAction {
  seq: number;
  t: number;
  type: string;
  payload: any;
  /** What the learner saw as a result (reading, test results, message ...). */
  observation: any;
  /** Hidden engine annotations used for evaluation (informative?, unsafe?, ...). */
  annotations: Record<string, any>;
}

export interface ApplyResult<S> {
  state: S;
  observation?: any;
  annotations?: Record<string, any>;
  /** Learner-facing event text (e.g. "The fuse blew again!"). */
  message?: string;
  messageTone?: Tone;
  /** If set, the action was rejected and is NOT logged. */
  error?: string;
  /** True when this action completes the scenario (e.g. submit). */
  complete?: boolean;
}

export interface HintResult {
  level: number;
  maxLevel: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** Feedback guideline for a known mistake (supplied by each module). */
export interface MistakeDef {
  code: string;
  title: string;
  severity: Severity;
  skillIds: string[];
  /** Why the decision is ineffective or unsafe. */
  why: string;
  /** What an effective practitioner does instead. */
  instead: string;
  /** Optional real-world consequence. */
  realWorld?: string;
}

export interface StrengthDef {
  code: string;
  title: string;
  skillIds: string[];
  why: string;
}

export interface MistakeInstance {
  code: string;
  count: number;
  steps: number[]; // seq numbers of the offending actions
  detail: string; // grounded, specific description
}

export interface StrengthInstance {
  code: string;
  steps: number[];
  detail: string;
}

export interface SkillEvidence {
  skillId: string;
  score: number; // 0..1 performance on this skill in this attempt
  weight: number; // 0..1 how strongly the attempt exercised the skill
  reasons: string[];
}

export interface Metric {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  benchmark?: number | string;
  benchmarkLabel?: string;
  better?: 'lower' | 'higher';
}

export interface TimelineEntry {
  seq: number;
  verdict: Verdict;
  note: string;
}

/** What a module's evaluator returns. Deterministic: same log -> same evaluation. */
export interface ModuleEvaluation {
  solved: boolean;
  outcomeLabel: string;
  accuracy: number; // 0..1  correctness of the final answer / repair
  process: number; // 0..1  quality of the procedure and strategy
  efficiency: number; // 0..1  economy of actions relative to an expert
  safety: number | null; // 0..1, null when not applicable to the module
  processVerdict: { label: string; tone: Tone; explanation: string };
  skillEvidence: SkillEvidence[];
  mistakes: MistakeInstance[];
  strengths: StrengthInstance[];
  metrics: Metric[];
  timeline: TimelineEntry[];
  groundTruth: { summary: string; details: string[] };
  expertPath?: { summary: string; steps: string[] };
}

/** Module evaluation composed with platform-level scoring. */
export interface Evaluation extends ModuleEvaluation {
  overall: number; // 0..100
  hintsUsed: number;
  durationSec: number;
  actionCount: number;
}

// ---------------------------------------------------------------------------
// Coaching knowledge
// ---------------------------------------------------------------------------

export interface KnowledgeTopic {
  id: string;
  title: string;
  keywords: string[];
  answer: string;
}

// ---------------------------------------------------------------------------
// Simulated learners (used to generate realistic demo data through the real engines)
// ---------------------------------------------------------------------------

export interface ExecResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  logs: string[];
  timedOut?: boolean;
}

export interface BotContext {
  rng: Rng;
  /** 0..1 overall competence of the simulated learner at this point in time. */
  ability: number;
  traits: { careful: number; safe: number; systematic: number };
  /** Trusted code executor (server-side only) for modules that run code. */
  exec?: (code: string, expressions: string[]) => ExecResult[];
}

// ---------------------------------------------------------------------------
// The module contract
// ---------------------------------------------------------------------------

export interface SkillModule<C = any, S = any> {
  id: string;
  name: string;
  tagline: string;
  description: string;
  color: string;
  icon: string;
  /** Shown prominently for safety-sensitive modules. */
  safetyNotice?: string;
  skills: SkillDef[];
  templates: ScenarioTemplate[];
  mistakes: Record<string, MistakeDef>;
  strengths: Record<string, StrengthDef>;
  knowledge: KnowledgeTopic[];
  /** The action type that finishes the scenario. */
  submitActionType: string;

  generate(template: ScenarioTemplate, opts: GenerateOptions): ScenarioInstance<C>;
  publicScenario(instance: ScenarioInstance<C>): PublicScenario;
  initialState(instance: ScenarioInstance<C>): S;
  publicState(instance: ScenarioInstance<C>, state: S): unknown;
  applyAction(
    instance: ScenarioInstance<C>,
    state: S,
    action: ModuleAction,
    ctx: ActionContext,
  ): ApplyResult<S>;
  hint(instance: ScenarioInstance<C>, state: S, log: LoggedAction[], level: number): HintResult;
  evaluate(instance: ScenarioInstance<C>, state: S, log: LoggedAction[]): ModuleEvaluation;
  /** Human-readable one-line description of a logged action (for logs, replay and coaching). */
  describeAction(entry: LoggedAction): string;
  /** Post-completion data revealed in the debrief (faulty parts, original vs fixed code ...). */
  reveal?(instance: ScenarioInstance<C>, state: S): unknown;
  /** Produces a plausible action sequence for a simulated learner (demo data / testing). */
  simulateLearner?(instance: ScenarioInstance<C>, ctx: BotContext): ModuleAction[];
}
