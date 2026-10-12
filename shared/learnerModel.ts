/**
 * Learner model: maintains a skill-level estimate for every skill, updated from
 * the per-skill evidence that module evaluators extract from each attempt.
 *
 * Model (an Elo / 1-parameter-IRT hybrid with shrinking learning rate):
 *   - Each skill has an ability `rating` on a logit scale.
 *   - Each scenario difficulty d (1..5) maps to an item difficulty b(d).
 *   - Expected performance E = sigmoid(rating - b(d)).
 *   - After an attempt with evidence score x (0..1) and weight w (0..1):
 *       rating += K * uncertainty * w * (x - E)
 *     so succeeding at a HARD scenario raises ability more than succeeding at an easy one,
 *     and failing an easy scenario lowers it more than failing a hard one.
 *   - `uncertainty` shrinks as evidence accumulates, stabilising the estimate.
 *
 * Mastery is defined as expected performance on a standard (difficulty 3) scenario.
 * "Mastered" additionally requires REPEATED strong performance, never a single success.
 * Spaced reinforcement: each skill carries a review interval that grows after strong
 * performance and resets after weak performance.
 */

import type { MasteryLevel } from './types.ts';
import { clamp, DAY_MS, mean, round, sigmoid } from './util.ts';

export interface SkillState {
  skillId: string;
  rating: number;
  uncertainty: number;
  evidenceCount: number;
  recentScores: number[]; // oldest -> newest, max 6
  lastPracticedAt: number | null;
  reviewIntervalDays: number;
  reviewDueAt: number | null;
}

export const PRIOR_RATING = -0.8;
export const LEARNING_RATE = 1.6;
export const MIN_UNCERTAINTY = 0.35;
/** Evidence below this weight updates the rating but does not count as practice. */
export const PRACTICE_WEIGHT = 0.25;

export const LEVEL_THRESHOLDS = { developing: 0.4, proficient: 0.65, mastered: 0.85 };

export const LEVEL_LABELS: Record<MasteryLevel, string> = {
  not_started: 'Not started',
  novice: 'Novice',
  developing: 'Developing',
  proficient: 'Proficient',
  mastered: 'Mastered',
};

export const LEVEL_ORDER: MasteryLevel[] = ['not_started', 'novice', 'developing', 'proficient', 'mastered'];

export function defaultSkillState(skillId: string): SkillState {
  return {
    skillId,
    rating: PRIOR_RATING,
    uncertainty: 1,
    evidenceCount: 0,
    recentScores: [],
    lastPracticedAt: null,
    reviewIntervalDays: 1,
    reviewDueAt: null,
  };
}

/** Scenario difficulty (1..5) on the same logit scale as ability. */
export function difficultyLogit(difficulty: number): number {
  return (difficulty - 3) * 0.9;
}

/** Expected performance on a standard difficulty-3 scenario (0..1). */
export function masteryOf(state: SkillState | undefined): number {
  return sigmoid(state ? state.rating : PRIOR_RATING);
}

export function expectedScore(state: SkillState | undefined, difficulty: number): number {
  return sigmoid((state ? state.rating : PRIOR_RATING) - difficultyLogit(difficulty));
}

export interface MasteryInfo {
  level: MasteryLevel;
  mastery: number;
  reviewDue: boolean;
  consistent: boolean;
  note: string;
}

export function isConsistent(state: SkillState): boolean {
  const last3 = state.recentScores.slice(-3);
  return (
    state.evidenceCount >= 3 &&
    last3.length === 3 &&
    last3.filter((x) => x >= 0.8).length >= 2 &&
    mean(last3) >= 0.75
  );
}

export function masteryInfo(state: SkillState | undefined, now: number): MasteryInfo {
  if (!state || state.evidenceCount === 0) {
    return { level: 'not_started', mastery: 0, reviewDue: false, consistent: false, note: 'No evidence yet.' };
  }
  const m = masteryOf(state);
  const consistent = isConsistent(state);
  const reviewDue = state.reviewDueAt !== null && now > state.reviewDueAt;
  let level: MasteryLevel;
  let note: string;
  if (m < LEVEL_THRESHOLDS.developing) {
    level = 'novice';
    note = 'Building the foundations of this skill.';
  } else if (m < LEVEL_THRESHOLDS.proficient) {
    level = 'developing';
    note = 'Applying the skill with growing reliability.';
  } else if (m < LEVEL_THRESHOLDS.mastered) {
    level = 'proficient';
    note = 'Performs this skill well in most scenarios.';
  } else if (!consistent) {
    level = 'proficient';
    note = 'Strong estimate - mastery needs consistent repeated performance (2 of the last 3 attempts at 80%+).';
  } else {
    level = 'mastered';
    note = 'Demonstrated repeatedly and independently.';
  }
  if (reviewDue && level !== 'novice') note += ' Due for reinforcement.';
  return { level, mastery: m, reviewDue, consistent, note };
}

export interface SkillUpdate {
  skillId: string;
  before: SkillState;
  after: SkillState;
  expected: number;
  score: number;
  weight: number;
  masteryBefore: number;
  masteryAfter: number;
}

export function updateSkill(
  state: SkillState,
  score: number,
  weight: number,
  difficulty: number,
  now: number,
): SkillUpdate {
  const w = clamp(weight);
  const x = clamp(score);
  const expected = expectedScore(state, difficulty);
  const rating = clamp(state.rating + LEARNING_RATE * state.uncertainty * w * (x - expected), -4, 4);
  const uncertainty = Math.max(MIN_UNCERTAINTY, state.uncertainty * (1 - 0.14 * w));
  const counts = w >= PRACTICE_WEIGHT;

  let interval = state.reviewIntervalDays;
  if (counts) {
    if (x >= 0.8) interval = Math.min(30, Math.max(1, interval) * 2.2);
    else if (x < 0.6) interval = 1;
    else interval = Math.max(1, interval * 1.2);
  }

  const after: SkillState = {
    skillId: state.skillId,
    rating: round(rating, 4),
    uncertainty: round(uncertainty, 4),
    evidenceCount: state.evidenceCount + (counts ? 1 : 0),
    recentScores: counts ? [...state.recentScores, round(x, 3)].slice(-6) : state.recentScores,
    lastPracticedAt: counts ? now : state.lastPracticedAt,
    reviewIntervalDays: round(interval, 2),
    reviewDueAt: counts ? now + interval * DAY_MS : state.reviewDueAt,
  };
  return {
    skillId: state.skillId,
    before: state,
    after,
    expected,
    score: x,
    weight: w,
    masteryBefore: masteryOf(state),
    masteryAfter: masteryOf(after),
  };
}

export function levelRank(level: MasteryLevel): number {
  return LEVEL_ORDER.indexOf(level);
}
