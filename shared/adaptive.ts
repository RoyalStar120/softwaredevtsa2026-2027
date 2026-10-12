/**
 * Adaptive Practice Engine - SkillBridge's central innovation.
 *
 * Given a learner's skill profile, mistake patterns and history, it scores every
 * (scenario template x difficulty) candidate and selects the next practice scenario.
 * Every recommendation carries human-readable reasons, so learners and instructors can
 * see exactly WHY a scenario was chosen.
 *
 * Score = 1.2*need + 1.0*zpd + 1.4*pattern + 0.6*reinforce + 0.5*integration
 *       + 0.35*explore + 1.5*focus - recency
 *
 *  need        - how weak the learner is in the skills the template exercises
 *  zpd         - "desirable difficulty": expected success close to ~72%
 *  pattern     - template exercises skills tied to a RECURRING mistake
 *  reinforce   - template revisits skills due for spaced reinforcement
 *  integration - combines several skills the learner has become proficient in
 *  explore     - template not tried yet
 *  focus       - explicit focus request (learner "practice this skill" / instructor objective)
 *  recency     - penalty for repeating the scenario type just practiced
 *
 * The chosen focus skills are passed to the module's generator, which picks a fault /
 * bug configuration that emphasizes them (a DIFFERENT scenario, not the same exercise).
 */

import type { MistakeDef, ScenarioTemplate, SkillDef } from './types.ts';
import type { AttemptDigest, MistakePattern } from './patterns.ts';
import {
  expectedScore,
  LEVEL_THRESHOLDS,
  masteryInfo,
  masteryOf,
  type SkillState,
} from './learnerModel.ts';
import { DAY_MS, listJoin, pct, round, sum } from './util.ts';

export interface Catalog {
  skills: SkillDef[];
  templates: ScenarioTemplate[];
  mistakes: Record<string, MistakeDef>;
  moduleNames: Record<string, string>;
}

export type ReasonKind =
  | 'assignment'
  | 'focus'
  | 'pattern'
  | 'weakness'
  | 'reinforcement'
  | 'integration'
  | 'new'
  | 'challenge';

export interface RecommendationReason {
  kind: ReasonKind;
  text: string;
  skillIds: string[];
}

export interface RecommendationFactors {
  need: number;
  zpd: number;
  pattern: number;
  reinforce: number;
  integration: number;
  explore: number;
  focus: number;
  recency: number;
}

export interface Recommendation {
  templateId: string;
  moduleId: string;
  title: string;
  difficulty: number;
  focusSkills: string[];
  avoidVariants: string[];
  expectedSuccess: number;
  score: number;
  reasons: RecommendationReason[];
  factors: RecommendationFactors;
  locked: boolean;
}

export interface AdaptiveRequest {
  catalog: Catalog;
  skillStates: Record<string, SkillState>;
  /** Completed attempts, NEWEST FIRST. */
  history: AttemptDigest[];
  patterns: MistakePattern[];
  now: number;
  moduleId?: string;
  focusSkills?: string[];
  limit?: number;
  /** Restrict to a single template (used when an instructor assigns a template without a fixed difficulty). */
  templateId?: string;
}

const TARGET_SUCCESS = 0.72;
const ZPD_WIDTH = 0.12;
const PREREQ_THRESHOLD = 0.4; // prerequisite skills must be at least "developing"

const W = { need: 1.2, zpd: 1.0, pattern: 1.4, reinforce: 0.6, integration: 0.5, explore: 0.35, focus: 1.5 };

export function recommend(req: AdaptiveRequest): Recommendation[] {
  const { catalog, skillStates, history, patterns, now } = req;
  const skillById = new Map(catalog.skills.map((s) => [s.id, s]));
  const name = (id: string) => skillById.get(id)?.name ?? id;

  let templates = catalog.templates;
  if (req.moduleId) templates = templates.filter((t) => t.moduleId === req.moduleId);
  if (req.templateId) templates = templates.filter((t) => t.id === req.templateId);

  const candidates: Recommendation[] = [];

  for (const t of templates) {
    const weights = Object.entries(t.skillWeights).filter(([, w]) => w > 0);
    const wTotal = sum(weights.map(([, w]) => w)) || 1;
    const moduleHistory = history.filter((h) => h.moduleId === t.moduleId);
    const templateHistory = history.filter((h) => h.templateId === t.id);

    // --- prerequisites (skill tree gating) ---
    const unmet = t.prerequisites.filter((p) => masteryOf(skillStates[p]) < PREREQ_THRESHOLD);
    const locked = unmet.length > 0 && !req.templateId;

    // --- need: weakness in exercised skills (known weaknesses count more than unknowns) ---
    let needAcc = 0;
    for (const [s, w] of weights) {
      const st = skillStates[s];
      const known = st && st.evidenceCount > 0;
      needAcc += w * (1 - masteryOf(st)) * (known ? 1 : 0.55);
    }
    const need = needAcc / wTotal;

    // --- pattern: recurring mistakes whose skills this template exercises ---
    let pattern = 0;
    let patternHit: MistakePattern | null = null;
    for (const p of patterns) {
      if (p.moduleId !== t.moduleId || p.status === 'resolved') continue;
      const overlap = p.skillIds.length ? sum(p.skillIds.map((s) => t.skillWeights[s] ?? 0)) / p.skillIds.length : 0;
      const strength =
        Math.min(1, p.occurrences / 3 + (p.severity === 'critical' ? 0.3 : 0)) * (p.status === 'improving' ? 0.5 : 1);
      const v = overlap * strength;
      if (v > pattern) {
        pattern = v;
        patternHit = p;
      }
    }

    // --- reinforcement: spaced review due, or skill not exercised for several attempts ---
    let reinforce = 0;
    let reinforceSkill: string | null = null;
    let reinforceWhy = '';
    for (const [s, w] of weights) {
      if (w < 0.4) continue;
      const st = skillStates[s];
      if (!st || st.evidenceCount === 0) continue;
      const info = masteryInfo(st, now);
      if (info.level === 'novice') continue;
      const attemptsSince = st.lastPracticedAt
        ? moduleHistory.filter((h) => h.completedAt > (st.lastPracticedAt as number)).length
        : 0;
      const due = info.reviewDue || attemptsSince >= 4;
      if (due && w > reinforce) {
        reinforce = w;
        reinforceSkill = s;
        const days = st.lastPracticedAt ? Math.floor((now - st.lastPracticedAt) / DAY_MS) : 0;
        reinforceWhy =
          attemptsSince >= 4
            ? `not exercised in your last ${attemptsSince} attempts`
            : `last practiced ${days} day${days === 1 ? '' : 's'} ago`;
      }
    }

    // --- explore: template never tried ---
    const explore = templateHistory.length === 0 ? (moduleHistory.length === 0 ? 0.6 : 0.5) : 0;

    // --- focus: explicit request ---
    let focus = 0;
    if (req.focusSkills && req.focusSkills.length) {
      focus = sum(req.focusSkills.map((s) => t.skillWeights[s] ?? 0)) / req.focusSkills.length;
    }

    // --- recency: avoid repeating the scenario type just practiced ---
    let recency = 0;
    const recentIdx = history.slice(0, 3).findIndex((h) => h.templateId === t.id);
    if (recentIdx === 0) recency = 0.7;
    else if (recentIdx === 1) recency = 0.35;
    else if (recentIdx === 2) recency = 0.15;
    if (history.slice(0, 6).filter((h) => h.templateId === t.id).length >= 3) recency += 0.2;

    // --- evaluate each difficulty: desirable difficulty + integration ---
    let best: { d: number; score: number; zpd: number; E: number; integration: number } | null = null;
    for (let d = t.difficultyRange[0]; d <= t.difficultyRange[1]; d++) {
      const E = sum(weights.map(([s, w]) => w * expectedScore(skillStates[s], d))) / wTotal;
      const zpd = Math.exp(-((E - TARGET_SUCCESS) ** 2) / (2 * ZPD_WIDTH ** 2));
      const strong = weights.filter(([, w]) => w >= 0.5).map(([s]) => s);
      let integration = 0;
      if (strong.length >= 3 && d >= 3 && strong.every((s) => (skillStates[s]?.evidenceCount ?? 0) > 0)) {
        const avgM = sum(strong.map((s) => masteryOf(skillStates[s]))) / strong.length;
        if (avgM >= 0.6) integration = avgM;
      }
      const score =
        W.need * need +
        W.zpd * zpd +
        W.pattern * pattern +
        W.reinforce * reinforce +
        W.integration * integration +
        W.explore * explore +
        W.focus * focus -
        recency;
      if (!best || score > best.score) best = { d, score, zpd, E, integration };
    }
    if (!best) continue;

    // --- focus skills passed to the generator ---
    const priority = new Map<string, number>();
    for (const s of t.focusable) {
      const st = skillStates[s];
      let p = (t.skillWeights[s] ?? 0) * (1 - masteryOf(st)) * (st && st.evidenceCount > 0 ? 1 : 0.5);
      if (patternHit && patternHit.skillIds.includes(s)) p += 2;
      if (req.focusSkills?.includes(s)) p += 3;
      if (s === reinforceSkill) p += 0.5;
      priority.set(s, p);
    }
    const focusSkills = [...priority.entries()]
      .filter(([, p]) => p > 0.05)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([s]) => s);

    // --- reasons (most specific first, then by contribution; see sort below) ---
    const reasons: Array<RecommendationReason & { weight: number }> = [];
    if (focus > 0.25 && req.focusSkills) {
      const fs = req.focusSkills.filter((s) => (t.skillWeights[s] ?? 0) > 0);
      reasons.push({
        kind: 'focus',
        weight: W.focus * focus,
        skillIds: fs,
        text: `Emphasizes the skill${fs.length > 1 ? 's' : ''} you chose to practice: ${listJoin(fs.map(name))}.`,
      });
    }
    if (patternHit && pattern > 0.2) {
      const exercised = patternHit.skillIds.filter((s) => (t.skillWeights[s] ?? 0) > 0);
      reasons.push({
        kind: 'pattern',
        weight: W.pattern * pattern,
        skillIds: patternHit.skillIds,
        text: `You've repeated "${patternHit.title}" in ${patternHit.occurrences} of your last ${patternHit.window} ${
          catalog.moduleNames[t.moduleId] ?? ''
        } attempts. This scenario makes you practice ${listJoin(exercised.map(name))} again, in a new situation.`,
      });
    }
    const weakest = weights
      .filter(([s]) => (skillStates[s]?.evidenceCount ?? 0) > 0)
      .map(([s, w]) => ({ s, w, m: masteryOf(skillStates[s]) }))
      .filter((x) => x.w >= 0.5 && x.m < LEVEL_THRESHOLDS.proficient)
      .sort((a, b) => a.m - b.m)[0];
    if (weakest) {
      reasons.push({
        kind: 'weakness',
        weight: W.need * need,
        skillIds: [weakest.s],
        text: `Targets ${name(weakest.s)}, one of your weaker skills (${pct(weakest.m)} mastery).`,
      });
    }
    if (reinforceSkill && reinforce > 0) {
      reasons.push({
        kind: 'reinforcement',
        weight: W.reinforce * reinforce,
        skillIds: [reinforceSkill],
        text: `Refreshes ${name(reinforceSkill)} - ${reinforceWhy}, so it is due for reinforcement.`,
      });
    }
    if (best.integration > 0) {
      const strong = weights.filter(([, w]) => w >= 0.5).map(([s]) => s);
      reasons.push({
        kind: 'integration',
        weight: W.integration * best.integration,
        skillIds: strong,
        text: `Combines skills you've developed (${listJoin(strong.map((s) => skillById.get(s)?.shortName ?? s))}) in a more advanced challenge.`,
      });
    }
    if (explore > 0) {
      reasons.push({
        kind: 'new',
        weight: W.explore * explore,
        skillIds: [],
        text: 'Introduces a scenario type you have not tried yet.',
      });
    }
    // Most specific first: an explicitly chosen focus, then a recurring mistake, then by contribution.
    const rank = (k: string) => (k === 'focus' ? 0 : k === 'pattern' ? 1 : 2);
    reasons.sort((a, b) => rank(a.kind) - rank(b.kind) || b.weight - a.weight);
    reasons.push({
      kind: 'challenge',
      weight: 0,
      skillIds: [],
      text: `Difficulty ${best.d}/5 puts your expected success near ${pct(best.E)} - challenging but achievable.`,
    });

    candidates.push({
      templateId: t.id,
      moduleId: t.moduleId,
      title: t.title,
      difficulty: best.d,
      focusSkills,
      avoidVariants: templateHistory.slice(0, 3).map((h) => h.variantId),
      expectedSuccess: round(best.E, 3),
      score: round(best.score - (locked ? 10 : 0), 4),
      reasons: reasons.map(({ weight: _w, ...r }) => r),
      factors: {
        need: round(need, 3),
        zpd: round(best.zpd, 3),
        pattern: round(pattern, 3),
        reinforce: round(reinforce, 3),
        integration: round(best.integration, 3),
        explore: round(explore, 3),
        focus: round(focus, 3),
        recency: round(recency, 3),
      },
      locked,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, req.limit ?? 3);
}

/** Convenience: best scenario to practice one specific skill. */
export function recommendForSkill(req: Omit<AdaptiveRequest, 'focusSkills'>, skillId: string): Recommendation | null {
  const skill = req.catalog.skills.find((s) => s.id === skillId);
  if (!skill) return null;
  const recs = recommend({ ...req, moduleId: skill.moduleId, focusSkills: [skillId], limit: 1 });
  return recs[0] ?? null;
}
