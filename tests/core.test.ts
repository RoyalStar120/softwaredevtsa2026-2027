/**
 * Core platform tests: learner model, mistake-pattern detection, adaptive engine,
 * platform scoring, achievements and the offline coach.
 * Run: node --disable-warning=ExperimentalWarning --test tests/core.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Evaluation, ModuleEvaluation, ScenarioTemplate, Tone } from '../shared/types.ts';
import { defaultSkillState, masteryInfo, updateSkill, type SkillState } from '../shared/learnerModel.ts';
import { detectPatterns, type AttemptDigest, type MistakePattern } from '../shared/patterns.ts';
import { recommend, type AdaptiveRequest, type Recommendation } from '../shared/adaptive.ts';
import { composeEvaluation } from '../shared/scoring.ts';
import { checkAchievements, type AchievementContext } from '../shared/achievements.ts';
import { debriefToMarkdown, offlineAnswer, offlineDebrief, type CoachContext } from '../shared/coach.ts';
import { ALL_MISTAKES, ALL_SKILLS, ALL_STRENGTHS, buildCatalog, getModule } from '../shared/modules/index.ts';
import { DAY_MS } from '../shared/util.ts';

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 9, 1, 12);
const HOUR = 3_600_000;
const catalog = buildCatalog();

const EDIT_FIRST = 'prog.edited_before_reproducing'; // major
const TRIAL = 'prog.trial_and_error'; // major
const LIVE_R = 'elec.live_resistance_test'; // critical

function templateById(id: string): ScenarioTemplate {
  const t = catalog.templates.find((x) => x.id === id);
  if (!t) throw new Error(`missing template ${id}`);
  return t;
}

let attemptSeq = 0;

/** Hand-built attempt digest with realistic defaults. */
function digest(over: Partial<AttemptDigest> = {}): AttemptDigest {
  attemptSeq++;
  const moduleId = over.moduleId ?? 'programming';
  return {
    attemptId: `att-${attemptSeq}`,
    moduleId,
    templateId: moduleId === 'electrical' ? 'elec.porch-light' : 'prog.gradebook',
    variantId: `v${attemptSeq}`,
    difficulty: 2,
    completedAt: NOW - attemptSeq * HOUR,
    overall: 72,
    solved: true,
    hintsUsed: 0,
    safety: moduleId === 'electrical' ? 1 : null,
    efficiency: 0.7,
    mistakes: [],
    strengths: [],
    focusSkills: [],
    ...over,
  };
}

function mistake(code: string) {
  const def = ALL_MISTAKES[code];
  if (!def) throw new Error(`unknown mistake ${code}`);
  return { code, count: 1, severity: def.severity };
}

/** Newest-first history in one module; `made[i]` says whether attempt i (0 = newest) made the mistake. */
function series(moduleId: string, code: string, made: boolean[], templateId?: string): AttemptDigest[] {
  return made.map((has, i) =>
    digest({
      moduleId,
      ...(templateId ? { templateId } : {}),
      completedAt: NOW - (i + 1) * HOUR,
      mistakes: has ? [mistake(code)] : [],
      overall: has ? 58 : 84,
    }),
  );
}

/** Every catalog skill at the same rating, with practice history and no review due. */
function uniformStates(rating: number): Record<string, SkillState> {
  const out: Record<string, SkillState> = {};
  for (const s of catalog.skills) {
    out[s.id] = {
      ...defaultSkillState(s.id),
      rating,
      uncertainty: 0.5,
      evidenceCount: 5,
      recentScores: [0.7, 0.7, 0.7, 0.7, 0.7],
      lastPracticedAt: NOW - 2 * DAY_MS,
      reviewIntervalDays: 7,
      reviewDueAt: NOW + 5 * DAY_MS,
    };
  }
  return out;
}

function req(over: Partial<AdaptiveRequest> = {}): AdaptiveRequest {
  return { catalog, skillStates: {}, history: [], patterns: [], now: NOW, ...over };
}

/** Structural invariants every recommendation list must satisfy. */
function assertWellFormed(recs: Recommendation[]) {
  for (const r of recs) {
    const t = templateById(r.templateId);
    assert.equal(r.moduleId, t.moduleId);
    assert.ok(r.difficulty >= t.difficultyRange[0] && r.difficulty <= t.difficultyRange[1], `${r.templateId} d${r.difficulty}`);
    assert.ok(r.expectedSuccess >= 0 && r.expectedSuccess <= 1, `${r.templateId} expectedSuccess ${r.expectedSuccess}`);
    assert.ok(r.focusSkills.length <= 2);
    for (const s of r.focusSkills) assert.ok(t.focusable.includes(s), `${r.templateId}: ${s} is not focusable`);
    assert.ok(r.reasons.length >= 1);
    assert.equal(r.reasons.at(-1)?.kind, 'challenge', `${r.templateId} must end with a 'challenge' reason`);
    for (const reason of r.reasons) assert.ok(reason.text.length > 10, `${r.templateId}: empty ${reason.kind} reason`);
  }
  for (let i = 1; i < recs.length; i++) assert.ok(recs[i - 1].score >= recs[i].score, 'recommendations sorted by score');
}

function moduleEval(over: Partial<ModuleEvaluation> = {}): ModuleEvaluation {
  return {
    solved: true,
    outcomeLabel: 'Circuit restored',
    accuracy: 1,
    process: 1,
    efficiency: 1,
    safety: 1,
    processVerdict: { label: 'Effective process', tone: 'success', explanation: 'Isolated, verified zero energy, then tested.' },
    skillEvidence: [
      { skillId: 'elec.voltage', score: 1, weight: 0.8, reasons: ['Every voltage reading narrowed the fault down'] },
      { skillId: 'elec.safety', score: 1, weight: 0.6, reasons: ['Locked out and verified 0 V before contact'] },
    ],
    mistakes: [],
    strengths: [],
    metrics: [],
    timeline: [],
    groundTruth: { summary: 'Lamp L1 has an open filament.', details: ['L1 reads OL with the circuit isolated.'] },
    ...over,
  };
}

const META = { hintsUsed: 0, durationSec: 312.4, actionCount: 14 };
const verdict = (tone: Tone, label = 'Process verdict') => ({ label, tone, explanation: 'Fixture verdict.' });

// ---------------------------------------------------------------------------
// Learner model
// ---------------------------------------------------------------------------

test('learner model: no evidence means not started', () => {
  assert.equal(masteryInfo(defaultSkillState('prog.trace'), NOW).level, 'not_started');
  assert.equal(masteryInfo(undefined, NOW).level, 'not_started');
});

test('updateSkill: success on a hard scenario raises the rating more than success on an easy one', () => {
  const s0 = defaultSkillState('prog.trace');
  const easy = updateSkill(s0, 1, 1, 1, NOW);
  const hard = updateSkill(s0, 1, 1, 5, NOW);
  const gainEasy = easy.after.rating - s0.rating;
  const gainHard = hard.after.rating - s0.rating;
  assert.ok(gainEasy > 0, `easy success should still raise the rating (${gainEasy})`);
  assert.ok(gainHard > gainEasy, `hard +${gainHard} should beat easy +${gainEasy}`);
  assert.ok(hard.expected < easy.expected, 'hard scenarios have a lower expected score');
  assert.ok(hard.masteryAfter > hard.masteryBefore);

  // Same for an experienced learner; a lighter evidence weight moves the rating less.
  const mid: SkillState = { ...s0, rating: 0.6, uncertainty: 0.5, evidenceCount: 6, recentScores: [0.7, 0.8, 0.75] };
  assert.ok(updateSkill(mid, 1, 1, 5, NOW).after.rating - mid.rating > updateSkill(mid, 1, 1, 1, NOW).after.rating - mid.rating);
  assert.ok(updateSkill(s0, 1, 0.3, 5, NOW).after.rating - s0.rating < gainHard);
});

test('updateSkill: failure lowers the rating, most of all on an easy scenario', () => {
  const s: SkillState = {
    ...defaultSkillState('elec.voltage'),
    rating: 0.5,
    uncertainty: 0.6,
    evidenceCount: 4,
    recentScores: [0.7, 0.8, 0.6, 0.75],
  };
  const failEasy = updateSkill(s, 0, 1, 1, NOW).after;
  const failHard = updateSkill(s, 0, 1, 5, NOW).after;
  assert.ok(failEasy.rating < s.rating);
  assert.ok(failHard.rating < s.rating);
  assert.ok(failEasy.rating < failHard.rating, `failing easy (${failEasy.rating}) should cost more than failing hard (${failHard.rating})`);

  const fresh = defaultSkillState('elec.voltage');
  const u = updateSkill(fresh, 0, 1, 3, NOW);
  assert.ok(u.after.rating < fresh.rating);
  assert.ok(u.masteryAfter < u.masteryBefore);
});

test('updateSkill: a single perfect attempt is never "mastered", even from a strong prior', () => {
  const priors: SkillState[] = [defaultSkillState('prog.localize'), { ...defaultSkillState('prog.localize'), rating: 3.5 }];
  for (const prior of priors) {
    for (let d = 1; d <= 5; d++) {
      const info = masteryInfo(updateSkill(prior, 1, 1, d, NOW).after, NOW);
      assert.notEqual(info.level, 'mastered', `prior rating ${prior.rating}, difficulty ${d}`);
      assert.equal(info.consistent, false);
    }
  }
});

test('updateSkill: repeated strong performance at difficulty 4-5 reaches "mastered" (and weak attempts lose it)', () => {
  let s = defaultSkillState('elec.isolation');
  let t = NOW;
  const levels: string[] = [];
  for (let i = 0; i < 8; i++) {
    t += DAY_MS;
    s = updateSkill(s, 0.95, 1, i % 2 === 0 ? 4 : 5, t).after;
    levels.push(masteryInfo(s, t).level);
  }
  assert.notEqual(levels[0], 'mastered');
  assert.equal(levels.at(-1), 'mastered', levels.join(' > '));
  assert.equal(s.evidenceCount, 8);
  assert.ok(s.uncertainty < 1, 'uncertainty shrinks with evidence');

  // Two weak attempts break the "2 of the last 3 at 80%+" consistency requirement.
  for (let i = 0; i < 2; i++) {
    t += DAY_MS;
    s = updateSkill(s, 0.3, 1, 3, t).after;
  }
  const info = masteryInfo(s, t);
  assert.notEqual(info.level, 'mastered');
  assert.equal(info.consistent, false);
});

test('updateSkill: review intervals grow after scores >= 0.8 and reset after scores < 0.6', () => {
  const s0 = defaultSkillState('prog.verify');
  const a = updateSkill(s0, 0.9, 1, 3, NOW).after;
  const b = updateSkill(a, 0.85, 1, 3, NOW + DAY_MS).after;
  const reset = updateSkill(b, 0.4, 1, 3, NOW + 2 * DAY_MS).after;
  assert.ok(a.reviewIntervalDays > s0.reviewIntervalDays, `${s0.reviewIntervalDays} -> ${a.reviewIntervalDays}`);
  assert.ok(b.reviewIntervalDays > a.reviewIntervalDays, `${a.reviewIntervalDays} -> ${b.reviewIntervalDays}`);
  assert.equal(reset.reviewIntervalDays, 1);

  // Middling scores grow the interval only gently.
  const middling = updateSkill(b, 0.7, 1, 3, NOW + 2 * DAY_MS).after;
  assert.ok(middling.reviewIntervalDays > b.reviewIntervalDays && middling.reviewIntervalDays < b.reviewIntervalDays * 2);

  // The due date follows the interval and drives `reviewDue`.
  assert.ok(a.reviewDueAt !== null && Math.abs(a.reviewDueAt - (NOW + a.reviewIntervalDays * DAY_MS)) < 60_000);
  assert.equal(masteryInfo(a, NOW + HOUR).reviewDue, false);
  assert.equal(masteryInfo(a, NOW + (a.reviewIntervalDays + 1) * DAY_MS).reviewDue, true);

  // Intervals and ratings stay bounded.
  let s = s0;
  for (let i = 0; i < 15; i++) s = updateSkill(s, 1, 1, 5, NOW).after;
  assert.ok(s.reviewIntervalDays <= 30);
  assert.ok(s.rating <= 4);

  // Evidence below the practice weight nudges the rating but does not count as practice.
  const light = updateSkill(b, 0.2, 0.1, 3, NOW + 2 * DAY_MS).after;
  assert.equal(light.reviewIntervalDays, b.reviewIntervalDays);
  assert.equal(light.evidenceCount, b.evidenceCount);
  assert.deepEqual(light.recentScores, b.recentScores);
  assert.equal(light.lastPracticedAt, b.lastPracticedAt);
});

// ---------------------------------------------------------------------------
// Mistake patterns
// ---------------------------------------------------------------------------

test('detectPatterns: a mistake in 2 of the last 5 attempts is an active pattern', () => {
  const history = series('programming', EDIT_FIRST, [true, false, true, false, false]);
  const patterns = detectPatterns(history, ALL_MISTAKES);
  assert.equal(patterns.length, 1);
  const p = patterns[0];
  assert.equal(p.code, EDIT_FIRST);
  assert.equal(p.status, 'active');
  assert.equal(p.occurrences, 2);
  assert.equal(p.window, 5);
  assert.equal(p.absentStreak, 0);
  assert.equal(p.moduleId, 'programming');
  assert.equal(p.title, ALL_MISTAKES[EDIT_FIRST].title);
  assert.equal(p.severity, ALL_MISTAKES[EDIT_FIRST].severity);
  assert.deepEqual(p.skillIds, ALL_MISTAKES[EDIT_FIRST].skillIds);
  assert.equal(p.lastSeenAt, history[0].completedAt);
});

test('detectPatterns: absent from the latest 2 attempts -> resolved; latest 1 -> improving', () => {
  const patternFor = (made: boolean[]) =>
    detectPatterns(series('programming', EDIT_FIRST, made), ALL_MISTAKES).find((p) => p.code === EDIT_FIRST);

  const resolved = patternFor([false, false, true, true, false]);
  assert.equal(resolved?.status, 'resolved');
  assert.equal(resolved?.absentStreak, 2);
  assert.equal(resolved?.occurrences, 2);
  assert.equal(patternFor([false, true, true])?.status, 'improving');
  assert.equal(patternFor([true, true, true, true, true])?.status, 'active');
  // A single occurrence is a slip, not a pattern.
  assert.equal(patternFor([true, false, false, false, false]), undefined);
  // Occurrences older than the 5-attempt window are forgotten.
  assert.equal(patternFor([false, false, false, false, false, true, true]), undefined);
});

test('detectPatterns: windows are per module, unknown codes are ignored, active/critical patterns sort first', () => {
  // Two programming attempts with the mistake, separated by six electrical attempts.
  const prog1 = digest({ moduleId: 'programming', completedAt: NOW - HOUR, mistakes: [mistake(EDIT_FIRST)] });
  const elec = Array.from({ length: 6 }, (_, i) => digest({ moduleId: 'electrical', completedAt: NOW - (2 + i) * HOUR }));
  const prog2 = digest({ moduleId: 'programming', completedAt: NOW - 9 * HOUR, mistakes: [mistake(EDIT_FIRST)] });
  const cross = detectPatterns([prog1, ...elec, prog2], ALL_MISTAKES);
  assert.equal(cross.length, 1);
  assert.equal(cross[0].status, 'active');
  assert.equal(cross[0].window, 2);

  const unknown = { code: 'zzz.not_a_mistake', count: 1, severity: 'minor' as const };
  assert.deepEqual(detectPatterns([digest({ mistakes: [unknown] }), digest({ mistakes: [unknown] })], ALL_MISTAKES), []);

  const mixed = [
    digest({ moduleId: 'electrical', completedAt: NOW - 1 * HOUR, mistakes: [mistake(LIVE_R)] }),
    digest({ moduleId: 'programming', completedAt: NOW - 2 * HOUR, mistakes: [mistake(EDIT_FIRST)] }),
    digest({ moduleId: 'electrical', completedAt: NOW - 3 * HOUR, mistakes: [mistake(LIVE_R)] }),
    digest({ moduleId: 'programming', completedAt: NOW - 4 * HOUR, mistakes: [mistake(EDIT_FIRST)] }),
    digest({ moduleId: 'programming', completedAt: NOW - 5 * HOUR, mistakes: [mistake(TRIAL)] }),
    digest({ moduleId: 'programming', completedAt: NOW - 6 * HOUR, mistakes: [mistake(TRIAL)] }),
  ];
  assert.deepEqual(
    detectPatterns(mixed, ALL_MISTAKES).map((p) => [p.code, p.status]),
    [
      [LIVE_R, 'active'],
      [EDIT_FIRST, 'active'],
      [TRIAL, 'resolved'],
    ],
  );
});

// ---------------------------------------------------------------------------
// Adaptive engine
// ---------------------------------------------------------------------------

test('recommend: a brand-new learner gets introductory (difficulty 1-2) templates with no prerequisites', () => {
  const all = recommend(req({ limit: 100 }));
  assert.equal(all.length, catalog.templates.length);
  assertWellFormed(all);
  for (const r of all) {
    const t = templateById(r.templateId);
    if (t.prerequisites.length > 0) {
      assert.equal(r.locked, true, `${t.id} has unmet prerequisites for a new learner`);
    } else {
      assert.equal(r.locked, false, t.id);
      assert.ok(r.difficulty <= 2, `${t.id} recommended at difficulty ${r.difficulty}`);
      assert.ok(r.reasons.some((x) => x.kind === 'new'), `${t.id} should be introduced as new`);
    }
  }
  const lockedFlags = all.map((r) => r.locked);
  const firstLocked = lockedFlags.indexOf(true);
  assert.ok(firstLocked === -1 || lockedFlags.lastIndexOf(false) < firstLocked, 'unlocked templates rank above locked ones');

  for (const moduleId of [undefined, 'programming', 'electrical']) {
    const open = catalog.templates.filter((t) => (!moduleId || t.moduleId === moduleId) && t.prerequisites.length === 0);
    const top = recommend(req({ moduleId, limit: Math.min(3, open.length) }));
    assert.ok(top.length > 0);
    assertWellFormed(top);
    for (const r of top) {
      assert.equal(r.locked, false, `${moduleId ?? 'all'}: ${r.templateId}`);
      assert.deepEqual(templateById(r.templateId).prerequisites, [], `${moduleId ?? 'all'}: ${r.templateId}`);
      assert.ok(r.difficulty <= 2, `${moduleId ?? 'all'}: ${r.templateId} d${r.difficulty}`);
    }
  }

  // An explicit template assignment (instructor) is never locked.
  const locked = catalog.templates.find((t) => t.prerequisites.length > 0);
  assert.ok(locked);
  assert.equal(recommend(req({ templateId: locked.id }))[0].locked, false);
});

test('recommend: an active critical pattern on elec.live_resistance_test steers the top electrical recommendation', () => {
  const history = series('electrical', LIVE_R, [true, true, false], 'elec.porch-light');
  const patterns = detectPatterns(history, ALL_MISTAKES);
  const p = patterns.find((x) => x.code === LIVE_R);
  assert.ok(p);
  assert.equal(p.status, 'active');
  assert.equal(p.severity, 'critical');

  const states = uniformStates(0);
  const recs = recommend(req({ skillStates: states, history, patterns, moduleId: 'electrical' }));
  assertWellFormed(recs);
  const top = recs[0];
  const why = top.reasons.find((r) => r.kind === 'pattern');
  assert.ok(why, `${top.templateId} should cite the pattern: ${JSON.stringify(top.reasons)}`);
  assert.ok(why.skillIds.includes('elec.safety'));
  assert.ok(why.text.includes(p.title));
  assert.ok(
    top.focusSkills.includes('elec.safety') || top.focusSkills.includes('elec.resistance'),
    `${top.templateId} focus ${top.focusSkills.join(', ')}`,
  );
  assert.ok(top.factors.pattern > 0.2);

  // Same learner without the pattern: that template scores lower and cites no pattern.
  const without = recommend(req({ skillStates: states, history, patterns: [], moduleId: 'electrical', limit: 10 }));
  const same = without.find((r) => r.templateId === top.templateId);
  assert.ok(same);
  assert.ok(same.score < top.score);
  assert.ok(!same.reasons.some((r) => r.kind === 'pattern'));

  // Patterns never leak into another module's recommendations.
  for (const r of recommend(req({ skillStates: states, history, patterns, moduleId: 'programming', limit: 10 }))) {
    assert.equal(r.factors.pattern, 0, r.templateId);
  }

  // Once resolved, the pattern no longer drives recommendations.
  const healed = series('electrical', LIVE_R, [false, false, true, true], 'elec.porch-light');
  const healedPatterns = detectPatterns(healed, ALL_MISTAKES);
  assert.equal(healedPatterns.find((x) => x.code === LIVE_R)?.status, 'resolved');
  for (const r of recommend(req({ skillStates: states, history: healed, patterns: healedPatterns, moduleId: 'electrical', limit: 10 }))) {
    assert.equal(r.factors.pattern, 0, r.templateId);
    assert.ok(!r.reasons.some((x) => x.kind === 'pattern'), r.templateId);
  }
});

test('recommend: recency penalizes the template that was just attempted', () => {
  const states = uniformStates(0);
  const gradebook = (completedAt: number) => digest({ templateId: 'prog.gradebook', variantId: 'gb-variant', completedAt });
  const username = (completedAt: number) => digest({ templateId: 'prog.username', variantId: 'un-variant', completedAt });
  // Same two attempts, opposite order.
  const justGradebook = recommend(
    req({ skillStates: states, history: [gradebook(NOW - HOUR), username(NOW - 2 * HOUR)], moduleId: 'programming', limit: 20 }),
  );
  const justUsername = recommend(
    req({ skillStates: states, history: [username(NOW - HOUR), gradebook(NOW - 2 * HOUR)], moduleId: 'programming', limit: 20 }),
  );
  assertWellFormed(justGradebook);
  assertWellFormed(justUsername);

  const gbA = justGradebook.find((r) => r.templateId === 'prog.gradebook');
  const gbB = justUsername.find((r) => r.templateId === 'prog.gradebook');
  assert.ok(gbA && gbB);
  assert.ok(gbA.factors.recency > gbB.factors.recency);
  assert.ok(gbA.score < gbB.score);
  assert.notEqual(justGradebook[0].templateId, 'prog.gradebook');
  assert.notEqual(justUsername[0].templateId, 'prog.username');
  // The variant just seen is passed on so the generator avoids repeating it.
  assert.deepEqual(gbA.avoidVariants, ['gb-variant']);
});

test('recommend: higher skill ratings push the recommended difficulty up', () => {
  const ladder = [-1.5, -0.5, 0.3, 1.1, 2.0, 3.0];
  for (const t of catalog.templates) {
    const ds = ladder.map((rating) => {
      const [r] = recommend(req({ skillStates: uniformStates(rating), templateId: t.id }));
      assert.ok(r, t.id);
      return r.difficulty;
    });
    for (let i = 1; i < ds.length; i++) assert.ok(ds[i] >= ds[i - 1], `${t.id}: ${ds.join(' -> ')}`);
    assert.ok(ds[ds.length - 1] > ds[0], `${t.id}: ${ds.join(' -> ')}`);
  }

  const meanDifficulty = (recs: Recommendation[]) => recs.reduce((s, r) => s + r.difficulty, 0) / recs.length;
  const novice = recommend(req({ limit: 100 }));
  const expert = recommend(req({ skillStates: uniformStates(2.5), limit: 100 }));
  assert.ok(meanDifficulty(expert) > meanDifficulty(novice) + 1, `${meanDifficulty(novice)} vs ${meanDifficulty(expert)}`);
});

test('recommend: explicit focusSkills put templates that emphasize the skill first', () => {
  const states = uniformStates(0.5); // evenly matched learner, nothing locked
  const weightOf = (r: Recommendation, skill: string) => templateById(r.templateId).skillWeights[skill] ?? 0;

  for (const focus of ['elec.resistance', 'prog.verify']) {
    const recs = recommend(req({ skillStates: states, focusSkills: [focus], limit: 100 }));
    assertWellFormed(recs);
    const exercises = recs.map((r) => weightOf(r, focus) > 0);
    const lastYes = exercises.lastIndexOf(true);
    const firstNo = exercises.indexOf(false);
    assert.ok(lastYes >= 0);
    assert.ok(firstNo === -1 || lastYes < firstNo, `${focus}: ${recs.map((r) => r.templateId).join(', ')}`);

    const top = recs[0];
    const why = top.reasons.find((r) => r.kind === 'focus');
    assert.ok(why && why.skillIds.includes(focus), `${focus}: ${JSON.stringify(top.reasons)}`);
    if (templateById(top.templateId).focusable.includes(focus)) assert.equal(top.focusSkills[0], focus);
  }

  // The template with the strongest emphasis wins when everything else is equal.
  const strongest = [...catalog.templates].sort(
    (a, b) => (b.skillWeights['elec.resistance'] ?? 0) - (a.skillWeights['elec.resistance'] ?? 0),
  )[0];
  assert.equal(recommend(req({ skillStates: states, focusSkills: ['elec.resistance'], limit: 1 }))[0].templateId, strongest.id);
});

test('recommend: every recommendation explains itself and ends with a challenge reason', () => {
  const profiles: Array<Record<string, SkillState>> = [{}, uniformStates(-1), uniformStates(0.5), uniformStates(2.5)];
  for (const skillStates of profiles) {
    const recs = recommend(req({ skillStates, limit: 100 }));
    assert.equal(recs.length, catalog.templates.length);
    assertWellFormed(recs);
  }
});

// ---------------------------------------------------------------------------
// Platform scoring
// ---------------------------------------------------------------------------

test('composeEvaluation: a perfect, safe, unassisted attempt scores 100', () => {
  const ev = composeEvaluation(moduleEval(), META);
  assert.equal(ev.overall, 100);
  assert.equal(ev.hintsUsed, 0);
  assert.equal(ev.actionCount, 14);
  assert.equal(ev.durationSec, 312);
  assert.equal(composeEvaluation(moduleEval({ safety: null }), META).overall, 100);
});

test('composeEvaluation: caps at 60 for danger tone or safety < 0.5, 80 for warning, 55 when unsolved', () => {
  const overall = (over: Partial<ModuleEvaluation>) => composeEvaluation(moduleEval(over), META).overall;
  assert.equal(overall({ processVerdict: verdict('danger') }), 60);
  assert.equal(overall({ safety: 0.4 }), 60);
  assert.ok(overall({ safety: 0.5 }) > 60);
  assert.equal(overall({ processVerdict: verdict('warning') }), 80);
  assert.equal(overall({ solved: false }), 55);
  assert.equal(overall({ solved: false, processVerdict: verdict('danger') }), 55);
  assert.ok(overall({ processVerdict: verdict('info') }) > 80);
  // Caps only limit the score; they never raise a weak attempt.
  assert.ok(overall({ accuracy: 0.2, process: 0.2, efficiency: 0.2, safety: 0.2, processVerdict: verdict('warning') }) < 30);
  // Modules without a safety dimension are never safety-capped.
  assert.equal(overall({ safety: null }), 100);
});

test('composeEvaluation: hints cost points and discount non-safety skill evidence', () => {
  const me = moduleEval();
  const two = composeEvaluation(me, { ...META, hintsUsed: 2 });
  assert.equal(two.overall, 92);
  assert.equal(two.hintsUsed, 2);
  const volt = two.skillEvidence.find((e) => e.skillId === 'elec.voltage');
  const safe = two.skillEvidence.find((e) => e.skillId === 'elec.safety');
  assert.ok(volt && safe);
  assert.ok(volt.score < 1, `voltage evidence ${volt.score}`);
  assert.equal(safe.score, 1, 'safety evidence is not discounted by hints');
  assert.ok(volt.reasons.some((r) => r.includes('hint')));
  assert.ok(!safe.reasons.some((r) => r.includes('hint')));

  // More hints discount more, down to a floor.
  const many = composeEvaluation(me, { ...META, hintsUsed: 12 });
  const voltMany = many.skillEvidence.find((e) => e.skillId === 'elec.voltage');
  assert.ok(voltMany && voltMany.score < volt.score && voltMany.score >= 0.6 - 1e-9, `${voltMany?.score}`);
  assert.ok(many.overall < two.overall);

  // The module evaluation is not mutated.
  assert.equal(me.skillEvidence[0].score, 1);
  assert.equal(me.skillEvidence[0].reasons.length, 1);
});

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

const SKILL_MODULE: Record<string, string> = Object.fromEntries(ALL_SKILLS.map((s) => [s.id, s.moduleId]));

function achCtx(over: Partial<AchievementContext> & { current: AttemptDigest }): AchievementContext {
  return {
    history: [over.current],
    levels: {},
    skillModule: SKILL_MODULE,
    earned: new Set(),
    patternsBefore: [],
    patternsAfter: [],
    ...over,
  };
}

test('checkAchievements: first_steps and top_marks are awarded once', () => {
  const first = digest({ overall: 93 });
  const ids = checkAchievements(achCtx({ current: first }));
  assert.ok(ids.includes('first_steps'));
  assert.ok(ids.includes('top_marks'));

  const again = checkAchievements(achCtx({ current: first, earned: new Set(['first_steps', 'top_marks']) }));
  assert.ok(!again.includes('first_steps'));
  assert.ok(!again.includes('top_marks'));

  assert.ok(!checkAchievements(achCtx({ current: digest({ overall: 89 }) })).includes('top_marks'));
});

test('checkAchievements: comeback when a recurring mistake pattern becomes resolved', () => {
  // Oldest -> newest: the mistake three times, then two clean attempts.
  const chrono = [true, true, true, false, false].map((has, i) =>
    digest({ completedAt: NOW - (10 - i) * HOUR, mistakes: has ? [mistake(EDIT_FIRST)] : [], overall: has ? 61 : 86 }),
  );
  const newestFirst = (n: number) => chrono.slice(0, n).reverse();
  const before = detectPatterns(newestFirst(4), ALL_MISTAKES);
  const after = detectPatterns(newestFirst(5), ALL_MISTAKES);
  assert.equal(before.find((p) => p.code === EDIT_FIRST)?.status, 'improving');
  assert.equal(after.find((p) => p.code === EDIT_FIRST)?.status, 'resolved');

  const base = { current: chrono[4], history: newestFirst(5), earned: new Set(['first_steps']) };
  assert.ok(checkAchievements(achCtx({ ...base, patternsBefore: before, patternsAfter: after })).includes('comeback'));

  // Active before -> resolved after also counts.
  const activeBefore: MistakePattern[] = before.map((p) => ({ ...p, status: 'active' as const, absentStreak: 0 }));
  assert.ok(checkAchievements(achCtx({ ...base, patternsBefore: activeBefore, patternsAfter: after })).includes('comeback'));

  // Already resolved before, or still active after: no comeback.
  assert.ok(!checkAchievements(achCtx({ ...base, patternsBefore: after, patternsAfter: after })).includes('comeback'));
  const stillActive = detectPatterns(newestFirst(3), ALL_MISTAKES);
  assert.equal(stillActive.find((p) => p.code === EDIT_FIRST)?.status, 'active');
  assert.ok(!checkAchievements(achCtx({ ...base, patternsBefore: stillActive, patternsAfter: stillActive })).includes('comeback'));

  // Not re-awarded.
  assert.ok(
    !checkAchievements(achCtx({ ...base, earned: new Set(['comeback']), patternsBefore: before, patternsAfter: after })).includes('comeback'),
  );
});

test('checkAchievements: safety streak, mastery and cross-training', () => {
  const elec = [1, 2, 3].map((i) => digest({ moduleId: 'electrical', safety: 1, completedAt: NOW - i * HOUR }));
  assert.ok(checkAchievements(achCtx({ current: elec[0], history: elec })).includes('safety_streak'));
  const unsafe = [digest({ moduleId: 'electrical', safety: 0.5, completedAt: NOW }), ...elec.slice(0, 2)];
  assert.ok(!checkAchievements(achCtx({ current: unsafe[0], history: unsafe })).includes('safety_streak'));

  const ids = checkAchievements(achCtx({ current: elec[0], levels: { 'prog.trace': 'proficient', 'elec.voltage': 'mastered' } }));
  assert.ok(ids.includes('mastery'));
  assert.ok(ids.includes('cross_trained'));
  const oneModule = checkAchievements(achCtx({ current: elec[0], levels: { 'prog.trace': 'proficient', 'prog.logic': 'proficient' } }));
  assert.ok(!oneModule.includes('cross_trained'));
  assert.ok(!oneModule.includes('mastery'));
});

// ---------------------------------------------------------------------------
// Offline coach
// ---------------------------------------------------------------------------

const PROG = getModule('programming');
const SKILL_NAMES: Record<string, string> = Object.fromEntries(ALL_SKILLS.map((s) => [s.id, s.name]));

/** A solved programming attempt reached by guessing (realistic "warning" evaluation). */
function progEvaluation(over: Partial<ModuleEvaluation> = {}): Evaluation {
  return composeEvaluation(
    moduleEval({
      outcomeLabel: 'Bug fixed',
      safety: null,
      accuracy: 1,
      process: 0.45,
      efficiency: 0.55,
      processVerdict: {
        label: 'Correct fix, trial-and-error process',
        tone: 'warning',
        explanation: 'The tests pass, but the fix came from guessing rather than evidence.',
      },
      skillEvidence: [
        { skillId: 'prog.reproduce', score: 0.2, weight: 0.7, reasons: ['Edited code before running the tests'] },
        { skillId: 'prog.localize', score: 0.5, weight: 0.5, reasons: ['Changed a line the evidence did not point to'] },
        { skillId: 'prog.verify', score: 0.9, weight: 0.5, reasons: ['Re-ran the full suite before submitting'] },
      ],
      mistakes: [
        { code: EDIT_FIRST, count: 1, steps: [1], detail: 'You edited line 7 before running the tests even once' },
        { code: TRIAL, count: 1, steps: [3], detail: 'The edit on line 9 was a guess that no evidence supported yet' },
      ],
      strengths: [{ code: 'prog.verified_fix', steps: [4], detail: 'You re-ran the full test suite after the fix.' }],
      groundTruth: {
        summary: 'averageScore() divides by scores.length - 1 (off-by-one).',
        details: ['Line 9: `total / (scores.length - 1)` should be `total / scores.length`.'],
      },
      expertPath: {
        summary: 'Reproduce, trace the values, then make one minimal fix',
        steps: ['Run the tests', 'Log total and count', 'Fix line 9', 'Re-run the tests'],
      },
      ...over,
    }),
    { hintsUsed: 0, durationSec: 420, actionCount: 5 },
  );
}

function coachCtx(evaluation: Evaluation, over: Partial<CoachContext> = {}): CoachContext {
  return {
    learnerName: 'Ava Martinez',
    moduleId: PROG.id,
    moduleName: PROG.name,
    scenario: {
      title: 'Gradebook Average',
      briefing: 'The class average shown to teachers is wrong.',
      goal: 'Fix averageScore() so every test passes.',
      objectives: ['Reproduce the failure', 'Fix the root cause', 'Verify with the full suite'],
      difficulty: 2,
    },
    evaluation,
    steps: [
      { seq: 1, description: 'Edited line 7', verdict: 'mistake', note: 'Changed code before reproducing the failure.' },
      { seq: 2, description: 'Ran the tests (3/5 passed)', verdict: 'info', note: null },
      { seq: 3, description: 'Edited line 9', verdict: 'wasted', note: 'A guess: no log or experiment pointed at this line yet.' },
      { seq: 4, description: 'Ran the tests (5/5 passed)', verdict: 'good', note: 'All visible tests pass.' },
      { seq: 5, description: 'Submitted the fix', verdict: 'good', note: null },
    ],
    skillChanges: [],
    patterns: [],
    mistakeDefs: ALL_MISTAKES,
    strengthDefs: ALL_STRENGTHS,
    skillNames: SKILL_NAMES,
    knowledge: PROG.knowledge,
    next: { title: 'Shopping Cart Total', difficulty: 3, reasons: ['Targets Fault Localization, one of your weaker skills.'] },
    ...over,
  };
}

test('offlineDebrief: a solved attempt with a weak process gets a headline about the process, not praise', () => {
  const ev = progEvaluation();
  assert.ok(ev.overall <= 80, `warning tone caps the score (${ev.overall})`);
  const d = offlineDebrief(coachCtx(ev));
  assert.ok(!d.headline.startsWith('Nice work'), d.headline);
  assert.ok(d.headline.includes(ev.outcomeLabel), d.headline);
  assert.ok(d.headline.includes(ev.processVerdict.label.toLowerCase()), d.headline);
  assert.match(d.headline, /process/i);
  assert.ok(d.summary.includes(`${ev.overall}/100`));

  const edit = d.struggles.find((s) => s.code === EDIT_FIRST);
  assert.ok(edit);
  assert.equal(edit.title, ALL_MISTAKES[EDIT_FIRST].title);
  assert.ok(edit.detail.includes('step 1'), edit.detail);
  assert.equal(edit.repeated, false);
  assert.ok(d.wentWell.some((w) => w.title === ALL_STRENGTHS['prog.verified_fix'].title));
  assert.ok(d.focusNext.some((f) => f.includes('Shopping Cart Total')));
  assert.ok(debriefToMarkdown(d).includes(d.headline));

  // A mistake that is also an active pattern is flagged as repeated.
  const patterns = detectPatterns(series('programming', EDIT_FIRST, [true, true, false]), ALL_MISTAKES);
  const repeated = offlineDebrief(coachCtx(ev, { patterns })).struggles.find((s) => s.code === EDIT_FIRST);
  assert.ok(repeated?.repeated);
  assert.match(repeated?.repeatNote ?? '', /2 of your last 3/);
});

test('offlineDebrief: praise only for a solved attempt with an effective process; safety reminder when unsafe', () => {
  const good = progEvaluation({ process: 1, efficiency: 1, processVerdict: verdict('success', 'Effective process'), mistakes: [] });
  assert.match(offlineDebrief(coachCtx(good)).headline, /^Nice work, Ava!/);

  const failed = progEvaluation({ solved: false, outcomeLabel: 'Bug not fixed', accuracy: 0.3, processVerdict: verdict('danger', 'Not solved') });
  assert.ok(failed.overall <= 55);
  const headline = offlineDebrief(coachCtx(failed)).headline;
  assert.ok(headline.startsWith('Bug not fixed'), headline);

  const risky = composeEvaluation(moduleEval({ safety: 0.75, processVerdict: verdict('warning', 'Repaired without full isolation') }), META);
  const notice = 'Never take resistance readings on a live circuit.';
  const closing = offlineDebrief(coachCtx(risky, { moduleId: 'electrical', moduleName: 'Electrical', safetyNotice: notice })).closing;
  assert.ok(closing.includes(notice), closing);
});

test('offlineAnswer: step questions reference that step; fault questions return the ground truth', () => {
  const ev = progEvaluation();
  const ctx = coachCtx(ev);

  const step3 = offlineAnswer(ctx, 'Why was step 3 a mistake?');
  assert.ok(step3.includes('Step 3'), step3);
  assert.ok(step3.includes('Edited line 9'), step3);
  assert.ok(step3.includes(ALL_MISTAKES[TRIAL].title), 'cites the mistake recorded at step 3');
  assert.ok(!step3.includes(ALL_MISTAKES[EDIT_FIRST].title), 'only cites mistakes tied to step 3');

  const step1 = offlineAnswer(ctx, 'why was step #1 wrong');
  assert.ok(step1.includes('Step 1') && step1.includes(ALL_MISTAKES[EDIT_FIRST].title), step1);
  assert.match(offlineAnswer(ctx, 'What happened at step 42?'), /don't see a step 42/);

  for (const q of ['What was the fault?', 'What was the actual bug?', 'what was wrong with the code', 'What was the root cause?']) {
    const answer = offlineAnswer(ctx, q);
    assert.ok(answer.includes(ev.groundTruth.summary), `${q} -> ${answer}`);
    for (const detail of ev.groundTruth.details) assert.ok(answer.includes(detail), q);
  }

  assert.ok(offlineAnswer(ctx, 'What should I have done instead?').includes(ev.expertPath?.summary ?? '<missing expert path>'));
  assert.ok(offlineAnswer(ctx, 'Why did I get this score?').includes(`${ev.overall}/100`));
});
