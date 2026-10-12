/**
 * Programming: Debugging module - shared TYPES only.
 *
 * The client imports these with `import type` (erased at build time), so nothing
 * here can leak hidden answers into the browser bundle. Server-only shapes
 * (bug definitions, config, engine state) are declared here too; as types they
 * are equally harmless.
 */

export type DiagnosisCategory =
  | 'off_by_one'
  | 'wrong_operator'
  | 'wrong_initial_value'
  | 'wrong_variable'
  | 'missing_edge_case'
  | 'mutation'
  | 'type_coercion'
  | 'missing_return';

export type ConceptSkillId = 'prog.boundaries' | 'prog.logic' | 'prog.state';

export interface CategoryOption {
  id: DiagnosisCategory;
  label: string;
}

/** A unit test: `call` is a JavaScript expression evaluated against the learner's code. */
export interface TestCase {
  id: string;
  name: string;
  call: string;
  /** JSON-serializable expected value (deep equality, numeric tolerance 1e-6). */
  expected: unknown;
  /** Hidden tests are sent to the client but only run (and shown) on submit. */
  visible: boolean;
}

export interface TestResult {
  id: string;
  pass: boolean;
  /** Display string of the returned value ('' when the call threw). */
  actual: string;
  error?: string;
  logs: string[];
  timedOut?: boolean;
}

export interface BugReport {
  ticket: string;
  title: string;
  reporter: string;
  steps: string[];
  expected: string;
  actual: string;
}

/** PublicScenario.view */
export interface ProgView {
  language: 'javascript';
  fileName: string;
  /** The buggy starting code. */
  code: string;
  functionNames: string[];
  /** All tests (visible + hidden). Hidden ones are run on submit only. */
  tests: TestCase[];
  bugReport: BugReport;
  categories: CategoryOption[];
}

export type RunScope = 'all' | 'single';

export interface RunSummary {
  seq: number;
  scope: RunScope;
  passed: number;
  failed: number;
  total: number;
  results: TestResult[];
}

export interface ProgCounts {
  runs: number;
  experiments: number;
  edits: number;
  resets: number;
  flags: number;
}

/** What `publicState()` returns. */
export interface ProgPublicState {
  code: string;
  flags: number[];
  lastRun: RunSummary | null;
  counts: ProgCounts;
  submitted: { passed: number; total: number } | null;
}

// ---------------------------------------------------------------------------
// Action payloads (client -> server)
// ---------------------------------------------------------------------------

export interface RunTestsPayload {
  code: string;
  scope: RunScope;
  testIds: string[];
  results: TestResult[];
}

export interface ExperimentResult {
  ok: boolean;
  /** Display string of the value. */
  value?: string;
  error?: string;
  logs: string[];
  timedOut?: boolean;
}

export interface RunExperimentPayload {
  code: string;
  expression: string;
  result: ExperimentResult;
}

export interface EditPayload {
  code: string;
}

export interface FlagLinePayload {
  line: number;
  flagged: boolean;
}

export interface Diagnosis {
  line: number;
  category: DiagnosisCategory;
  explanation?: string;
}

export interface SubmitFixPayload {
  code: string;
  /** FULL suite results (visible + hidden). */
  results: TestResult[];
  diagnosis: Diagnosis;
}

export type ProgAction =
  | { type: 'run_tests'; payload: RunTestsPayload }
  | { type: 'run_experiment'; payload: RunExperimentPayload }
  | { type: 'edit'; payload: EditPayload }
  | { type: 'flag_line'; payload: FlagLinePayload }
  | { type: 'reset_code'; payload?: Record<string, never> }
  | { type: 'submit_fix'; payload: SubmitFixPayload };

// ---------------------------------------------------------------------------
// Observations (server -> client via PublicLogEntry.observation)
// ---------------------------------------------------------------------------

export interface RunTestsObservation {
  scope: RunScope;
  passed: number;
  failed: number;
  total: number;
  results: TestResult[];
  /** Test name when a single test was run. */
  label?: string;
}

export interface ExperimentObservation {
  expression: string;
  ok: boolean;
  value: string;
  error: string | null;
  logs: string[];
  timedOut: boolean;
}

export interface EditObservation {
  changedLines: number[];
  deletedLines: number;
}

export interface FlagObservation {
  line: number;
  flagged: boolean;
  flags: number[];
}

export interface ResetObservation {
  reset: true;
}

export interface SubmitObservation {
  passed: number;
  total: number;
  allPass: boolean;
  visiblePassed: number;
  visibleTotal: number;
  hiddenPassed: number;
  hiddenTotal: number;
  results: TestResult[];
  diagnosis: Diagnosis;
}

// ---------------------------------------------------------------------------
// Debrief reveal (SkillModule.reveal)
// ---------------------------------------------------------------------------

export interface RevealBug {
  line: number;
  title: string;
  category: DiagnosisCategory;
  categoryLabel: string;
  buggyLine: string;
  fixedLine: string;
  explanation: string;
}

export interface ProgReveal {
  fileName: string;
  originalCode: string;
  finalCode: string;
  referenceCode: string;
  bugs: RevealBug[];
}

// ---------------------------------------------------------------------------
// Server-side (hidden) shapes
// ---------------------------------------------------------------------------

export interface BugSpec {
  id: string;
  /** 1-based line in the reference code. */
  line: number;
  /** Exact substring of the reference line that is replaced. */
  find: string;
  /** Buggy replacement (never adds or removes lines). */
  replace: string;
  category: DiagnosisCategory;
  /** Other diagnosis categories that are also accepted as correct. */
  accept?: DiagnosisCategory[];
  conceptSkill: ConceptSkillId;
  title: string;
  /** Root-cause explanation (debrief only). */
  explanation: string;
  /** One-line symptom used as the bug-report title. */
  symptom: string;
  /** Id of a VISIBLE test that fails because of this bug. */
  repro: string;
  /** Display string the repro call returns with only this bug present. */
  actual: string;
  /** 1 (obvious) .. 5 (subtle). */
  subtlety: number;
  /** Level-2 hint: what to log / inspect. */
  probe: string;
  /** Level-3 hint: what to examine on the faulty line (never the fix itself). */
  examine: string;
}

export interface BugDef extends BugSpec {
  buggyLine: string;
  fixedLine: string;
}

export interface TemplateSpec {
  id: string;
  title: string;
  summary: string;
  difficultyRange: [number, number];
  processWeights: Record<string, number>;
  prerequisites: string[];
  estimatedMinutes: number;
  tags: string[];
  fileName: string;
  /** One sentence describing what the program does (used in the briefing). */
  context: string;
  reporters: string[];
  code: string;
  tests: TestCase[];
  bugs: BugSpec[];
  /**
   * Allowed two-bug variants ("idA+idB", A on the earlier line). Only pairs whose
   * documented symptoms stay identical when combined are listed (verified by tests).
   */
  pairs?: string[];
}

export interface ProgConfig {
  fileName: string;
  functionNames: string[];
  referenceCode: string;
  buggyCode: string;
  bugs: BugDef[];
  tests: TestCase[];
  bugReport: BugReport;
}

export interface ProgState {
  code: string;
  flags: number[];
  counts: ProgCounts;
  /** Any test run or experiment so far. */
  observed: boolean;
  /** Seq of the first real code change (logs/comments/whitespace excluded). */
  firstFixSeq: number | null;
  lastRunCode: string | null;
  lastFullRun: { seq: number; norm: string; allPass: boolean } | null;
  /** Last known pass/fail per test id. */
  testStatus: Record<string, boolean>;
  lastRun: RunSummary | null;
  submitted: { seq: number; passed: number; total: number; code: string; diagnosis: Diagnosis } | null;
}
