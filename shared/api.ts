/**
 * Client <-> server API payload types. Shared so both sides agree on shapes.
 */

import type {
  Evaluation,
  HintResult,
  MasteryLevel,
  MistakeDef,
  PublicScenario,
  Role,
  ScenarioTemplate,
  SkillDef,
  StrengthDef,
  Tone,
  Verdict,
} from './types.ts';
import type { Recommendation } from './adaptive.ts';
import type { MistakePattern } from './patterns.ts';
import type { CoachDebrief } from './coach.ts';

export interface UserView {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  createdAt: number;
  isDemo: boolean;
}

export interface AiStatus {
  provider: 'gemini' | 'openai' | 'offline';
  model: string | null;
}

export interface ModuleInfo {
  id: string;
  name: string;
  tagline: string;
  description: string;
  color: string;
  icon: string;
  safetyNotice?: string;
  skills: SkillDef[];
  templates: ScenarioTemplate[];
  mistakes: Record<string, MistakeDef>;
  strengths: Record<string, StrengthDef>;
}

export interface CatalogResponse {
  modules: ModuleInfo[];
  ai: AiStatus;
}

// ---------------------------------------------------------------------------
// Learner profile
// ---------------------------------------------------------------------------

export interface SkillView {
  skillId: string;
  moduleId: string;
  mastery: number;
  level: MasteryLevel;
  evidenceCount: number;
  reviewDue: boolean;
  consistent: boolean;
  note: string;
  recentScores: number[];
  lastPracticedAt: number | null;
  unlocked: boolean;
}

export type AttemptSource = 'recommended' | 'catalog' | 'assignment' | 'skill_focus' | 'retry' | 'simulated';
export type AttemptMode = 'practice' | 'assessment';
export type AttemptStatus = 'active' | 'completed' | 'abandoned';

export interface AttemptSummary {
  id: string;
  userId: string;
  moduleId: string;
  templateId: string;
  title: string;
  difficulty: number;
  status: AttemptStatus;
  mode: AttemptMode;
  source: AttemptSource;
  startedAt: number;
  completedAt: number | null;
  overall: number | null;
  solved: boolean | null;
  processLabel: string | null;
  processTone: Tone | null;
  hintsUsed: number;
  durationSec: number | null;
  mistakeCodes: string[];
  assignmentId: string | null;
}

export interface AchievementView {
  id: string;
  earnedAt: number;
  attemptId: string | null;
}

export interface ProfileStats {
  completed: number;
  solved: number;
  avgScore: number;
  practiceMinutes: number;
  activeDays: number;
}

export interface ProfileResponse {
  user: UserView;
  skills: SkillView[];
  patterns: MistakePattern[];
  achievements: AchievementView[];
  stats: ProfileStats;
  recent: AttemptSummary[];
  activeAttempt: AttemptSummary | null;
  classes: Array<{ id: string; name: string; instructorName: string }>;
}

export interface SkillHistoryPoint {
  t: number;
  attemptId: string;
  mastery: number;
  score: number;
  weight: number;
}

export interface MistakeTrendPoint {
  attemptId: string;
  completedAt: number;
  moduleId: string;
  title: string;
  mistakes: number;
  critical: number;
  overall: number;
}

export interface ProgressResponse {
  skillHistory: Record<string, SkillHistoryPoint[]>;
  attempts: AttemptSummary[];
  mistakeTrend: MistakeTrendPoint[];
}

// ---------------------------------------------------------------------------
// Assignments and recommendations
// ---------------------------------------------------------------------------

export type AssignmentKind = 'practice' | 'baseline' | 'transfer';

export interface AssignmentView {
  id: string;
  classId: string;
  className: string;
  title: string;
  kind: AssignmentKind;
  templateId: string | null;
  difficulty: number | null;
  focusSkills: string[];
  dueAt: number | null;
  note: string | null;
  createdAt: number;
  targetUserId: string | null;
  /** Learner-specific status. */
  status: 'open' | 'in_progress' | 'completed';
  attemptId: string | null;
  score: number | null;
}

export interface RecommendationsResponse {
  assignments: AssignmentView[];
  top: Recommendation[];
  byModule: Record<string, Recommendation[]>;
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

export interface StartAttemptRequest {
  templateId?: string;
  moduleId?: string;
  difficulty?: number;
  focusSkills?: string[];
  source?: AttemptSource;
  assignmentId?: string;
}

export interface PublicLogEntry {
  seq: number;
  t: number;
  type: string;
  description: string;
  observation: any;
  message?: string;
  messageTone?: Tone;
}

export interface ActiveAttemptResponse {
  attempt: AttemptSummary;
  scenario: PublicScenario;
  publicState: unknown;
  log: PublicLogEntry[];
  hints: HintResult[];
  maxHintLevel: number;
  recommendation: Recommendation | null;
  safetyNotice?: string;
  serverTime: number;
}

export interface ActionResponse {
  ok: boolean;
  error?: string;
  entry?: PublicLogEntry | null;
  publicState?: unknown;
  message?: string;
  messageTone?: Tone;
  complete?: boolean;
}

export interface HintResponse {
  hint: HintResult;
  hints: HintResult[];
  entry: PublicLogEntry;
}

export interface SkillChange {
  skillId: string;
  name: string;
  moduleId: string;
  weight: number;
  score: number;
  masteryBefore: number;
  masteryAfter: number;
  levelBefore: MasteryLevel;
  levelAfter: MasteryLevel;
  reasons: string[];
}

export interface DebriefLogEntry extends PublicLogEntry {
  verdict: Verdict | null;
  note: string | null;
}

export interface CoachMessage {
  id: string;
  role: 'learner' | 'coach';
  content: string;
  provider: string;
  t: number;
}

export interface DebriefResponse {
  attempt: AttemptSummary;
  learner: UserView;
  scenario: PublicScenario;
  evaluation: Evaluation;
  log: DebriefLogEntry[];
  skillChanges: SkillChange[];
  patterns: MistakePattern[];
  newAchievements: string[];
  coach: { debrief: CoachDebrief; narrative: string | null; provider: string };
  messages: CoachMessage[];
  next: Recommendation[];
  reveal: unknown;
  canChat: boolean;
}

export interface CoachReplyResponse {
  messages: CoachMessage[];
  provider: string;
}

// ---------------------------------------------------------------------------
// Instructor
// ---------------------------------------------------------------------------

export interface ClassSummary {
  id: string;
  name: string;
  code: string;
  studentCount: number;
  createdAt: number;
  openAssignments: number;
  attemptsThisWeek: number;
  avgScore: number | null;
}

export interface RosterStudent {
  user: UserView;
  completed: number;
  avgScore: number | null;
  firstScores: number | null; // avg of first 2 attempts
  recentScores: number | null; // avg of last 3 attempts
  lastActiveAt: number | null;
  activePatterns: number;
  skills: Record<string, { mastery: number; level: MasteryLevel; evidenceCount: number }>;
}

export interface ClassMistakeStat {
  code: string;
  moduleId: string;
  title: string;
  severity: string;
  skillIds: string[];
  occurrences: number;
  students: number;
  studentIds: string[];
}

export interface AssignmentProgress extends Omit<AssignmentView, 'status' | 'attemptId' | 'score'> {
  completedCount: number;
  inProgressCount: number;
  assignedCount: number;
  avgScore: number | null;
}

export interface EvidenceSummary {
  /** Students who completed both a baseline and a transfer assessment. */
  prePost: Array<{ userId: string; name: string; baseline: number; transfer: number }>;
  baselineAvg: number | null;
  transferAvg: number | null;
  /** Average number of mistakes on the Nth attempt across students (error reduction). */
  mistakesByAttemptIndex: Array<{ index: number; avgMistakes: number; avgScore: number; n: number }>;
  /** Share of recurring mistake patterns that have been resolved. */
  patternsResolved: number;
  patternsTotal: number;
  sampleSize: number;
  simulatedShare: number;
}

export interface ClassDetailResponse {
  klass: ClassSummary;
  skills: SkillDef[];
  roster: RosterStudent[];
  mistakes: ClassMistakeStat[];
  assignments: AssignmentProgress[];
  evidence: EvidenceSummary;
  recentAttempts: Array<AttemptSummary & { studentName: string }>;
}

export interface StudentDetailResponse {
  user: UserView;
  profile: ProfileResponse;
  progress: ProgressResponse;
  recommendations: Recommendation[];
  classes: Array<{ id: string; name: string }>;
}

export interface CreateAssignmentRequest {
  title: string;
  kind: AssignmentKind;
  templateId?: string | null;
  difficulty?: number | null;
  focusSkills?: string[];
  dueAt?: number | null;
  note?: string | null;
  studentIds?: string[]; // empty / undefined = whole class
}
