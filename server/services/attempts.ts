/**
 * Attempt lifecycle: the heart of the practice -> evaluate -> adapt loop.
 *
 *   start      adaptive engine picks template + difficulty + focus, module generates a variant
 *   act        every learner action runs through the server-authoritative module engine
 *              and is appended to the action log
 *   hint       tiered, contextual hints (logged, and they reduce skill evidence)
 *   finalize   module evaluation -> platform scoring -> learner model update -> mistake
 *              patterns -> achievements -> next recommendation -> coach debrief
 */

import type { HintResult, ModuleAction, ScenarioInstance } from '../../shared/types.ts';
import type {
  ActiveAttemptResponse,
  ActionResponse,
  AttemptMode,
  AttemptSource,
  DebriefLogEntry,
  DebriefResponse,
  HintResponse,
  SkillChange,
  StartAttemptRequest,
} from '../../shared/api.ts';
import { ALL_MISTAKES, ALL_SKILLS, SKILL_BY_ID, buildCatalog, findTemplate, getModule } from '../../shared/modules/index.ts';
import { composeEvaluation } from '../../shared/scoring.ts';
import { defaultSkillState, masteryInfo, updateSkill, type SkillState } from '../../shared/learnerModel.ts';
import { detectPatterns, type AttemptDigest, type MistakePattern } from '../../shared/patterns.ts';
import { recommend, type Recommendation } from '../../shared/adaptive.ts';
import { checkAchievements } from '../../shared/achievements.ts';
import { randomSeed } from '../../shared/rng.ts';
import { json, newId, q, tx } from '../db.ts';
import { getUser, toUserView, type UserRow } from '../auth.ts';
import { attemptSummary, historyDigests, loadLog, loadSkillStates, publicEntry, saveSkillState, type AttemptRow } from './learner.ts';
import { buildCoachContext, listMessages, offlineCoach, type StoredCoach } from './coach.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SKILL_MODULE = Object.fromEntries(ALL_SKILLS.map((s) => [s.id, s.moduleId]));

export function adaptiveInputs(userId: string, now: number) {
  const skillStates = loadSkillStates(userId);
  const history = historyDigests(userId);
  const patterns = detectPatterns(history, ALL_MISTAKES);
  return { catalog: buildCatalog(), skillStates, history, patterns, now };
}

function loadAttempt(id: string): AttemptRow {
  const row = q.get<AttemptRow>('SELECT * FROM attempts WHERE id = ?', id);
  if (!row) throw new HttpError(404, 'Attempt not found.');
  return row;
}

function loadOwnedActive(id: string, user: UserRow): AttemptRow {
  const row = loadAttempt(id);
  if (row.user_id !== user.id) throw new HttpError(403, 'This is not your attempt.');
  if (row.status !== 'active') throw new HttpError(409, row.status === 'completed' ? 'This attempt is already complete.' : 'This attempt was abandoned.');
  return row;
}

/** Owner, or an instructor of a class the owner belongs to. */
export function canView(row: AttemptRow, viewer: UserRow): boolean {
  if (row.user_id === viewer.id) return true;
  if (viewer.role !== 'instructor') return false;
  return !!q.get(
    'SELECT 1 FROM class_members m JOIN classes c ON c.id = m.class_id WHERE m.user_id = ? AND c.instructor_id = ? LIMIT 1',
    row.user_id,
    viewer.id,
  );
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export function startAttempt(user: UserRow, req: StartAttemptRequest, now = Date.now(), opts: { seed?: number } = {}): string {
  let templateId = req.templateId;
  let difficulty = req.difficulty;
  let focusSkills = (req.focusSkills ?? []).filter((s) => SKILL_BY_ID.has(s));
  let source: AttemptSource = req.source ?? (templateId ? 'catalog' : 'recommended');
  let mode: AttemptMode = 'practice';
  let assignmentId: string | null = null;
  let rec: Recommendation | null = null;

  if (req.assignmentId) {
    const a = q.get<any>(
      `SELECT a.* FROM assignments a JOIN class_members m ON m.class_id = a.class_id AND m.user_id = ?
       WHERE a.id = ? AND (a.target_user_id IS NULL OR a.target_user_id = ?)`,
      user.id,
      req.assignmentId,
      user.id,
    );
    if (!a) throw new HttpError(404, 'Assignment not found.');
    assignmentId = a.id;
    source = 'assignment';
    mode = a.kind === 'practice' ? 'practice' : 'assessment';
    templateId = a.template_id ?? undefined;
    difficulty = a.difficulty ?? undefined;
    focusSkills = json<string[]>(a.focus_skills, []);
  }

  const inputs = adaptiveInputs(user.id, now);
  if (templateId) {
    const found = findTemplate(templateId);
    if (!found) throw new HttpError(404, 'Unknown scenario template.');
    if (!difficulty || !focusSkills.length) {
      rec = recommend({ ...inputs, templateId, focusSkills: focusSkills.length ? focusSkills : undefined, limit: 1 })[0] ?? null;
      if (!difficulty) difficulty = rec?.difficulty ?? found.template.difficultyRange[0];
      if (!focusSkills.length) focusSkills = rec?.focusSkills ?? [];
    }
  } else {
    const moduleId = req.moduleId ?? (focusSkills.length ? SKILL_BY_ID.get(focusSkills[0])?.moduleId : undefined);
    rec = recommend({ ...inputs, moduleId, focusSkills: focusSkills.length ? focusSkills : undefined, limit: 1 })[0] ?? null;
    if (!rec) throw new HttpError(400, 'No scenario is available right now.');
    templateId = rec.templateId;
    difficulty = rec.difficulty;
    focusSkills = [...new Set([...focusSkills.filter((s) => (findTemplate(rec!.templateId)?.template.skillWeights[s] ?? 0) > 0), ...rec.focusSkills])].slice(0, 2);
  }

  const { module, template } = findTemplate(templateId!)!;
  const d = Math.min(template.difficultyRange[1], Math.max(template.difficultyRange[0], Math.round(difficulty!)));
  const avoidVariants = inputs.history.filter((h) => h.templateId === template.id).slice(0, 3).map((h) => h.variantId);
  const seed = opts.seed ?? randomSeed();
  const instance = module.generate(template, { seed, difficulty: d, focusSkills, avoidVariants });
  const state = module.initialState(instance);

  const id = newId('a_');
  tx(() => {
    q.run("UPDATE attempts SET status = 'abandoned', completed_at = ? WHERE user_id = ? AND status = 'active'", now, user.id);
    q.run(
      `INSERT INTO attempts (id, user_id, module_id, template_id, difficulty, seed, variant_id, title, instance, state, status, mode, source, assignment_id, recommendation, hints, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, '[]', ?)`,
      id,
      user.id,
      module.id,
      template.id,
      instance.difficulty,
      seed,
      instance.variantId,
      instance.title,
      JSON.stringify(instance),
      JSON.stringify(state),
      mode,
      source,
      assignmentId,
      rec ? JSON.stringify(rec) : null,
      now,
    );
  });
  return id;
}

// ---------------------------------------------------------------------------
// Active attempt
// ---------------------------------------------------------------------------

export function activeView(id: string, user: UserRow): ActiveAttemptResponse {
  const row = loadOwnedActive(id, user);
  const module = getModule(row.module_id);
  const instance = json<ScenarioInstance>(row.instance, null as unknown as ScenarioInstance);
  const state = json<unknown>(row.state, null);
  const log = loadLog(row.id);
  return {
    attempt: attemptSummary(row),
    scenario: module.publicScenario(instance),
    publicState: module.publicState(instance, state),
    log: log.map((e) => publicEntry(module, e)),
    hints: json<HintResult[]>(row.hints, []),
    maxHintLevel: row.mode === 'assessment' ? 0 : module.hint(instance, state, log, 1).maxLevel,
    recommendation: json<Recommendation | null>(row.recommendation, null),
    safetyNotice: module.safetyNotice,
    serverTime: Date.now(),
  };
}

export function applyAction(id: string, user: UserRow, action: ModuleAction, now = Date.now()): ActionResponse {
  if (!action || typeof action.type !== 'string') throw new HttpError(400, 'Invalid action.');
  if (action.type === 'hint') throw new HttpError(400, 'Use the hint endpoint.');
  const row = loadOwnedActive(id, user);
  const module = getModule(row.module_id);
  const instance = json<ScenarioInstance>(row.instance, null as unknown as ScenarioInstance);
  const state = json<unknown>(row.state, null);
  const count = q.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt_actions WHERE attempt_id = ?', row.id)!.n;
  const seq = count + 1;
  const t = Math.max(0, now - row.started_at);
  const result = module.applyAction(instance, state, action, { seq, t });
  if (result.error) return { ok: false, error: result.error };

  const entryRow = {
    seq,
    t,
    type: action.type,
    payload: action.payload ?? {},
    observation: result.observation ?? {},
    annotations: result.annotations ?? {},
    message: result.message ?? null,
    messageTone: result.messageTone ?? null,
  };
  tx(() => {
    q.run(
      'INSERT INTO attempt_actions (attempt_id, seq, t, type, payload, observation, annotations, message, message_tone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      row.id,
      seq,
      t,
      action.type,
      JSON.stringify(entryRow.payload),
      JSON.stringify(entryRow.observation),
      JSON.stringify(entryRow.annotations),
      entryRow.message,
      entryRow.messageTone,
    );
    q.run('UPDATE attempts SET state = ? WHERE id = ?', JSON.stringify(result.state), row.id);
  });

  const entry = publicEntry(module, entryRow);
  if (result.complete) {
    finalize(row.id, now);
    return { ok: true, complete: true, entry, publicState: module.publicState(instance, result.state) };
  }
  return {
    ok: true,
    entry,
    publicState: module.publicState(instance, result.state),
    message: result.message,
    messageTone: result.messageTone,
  };
}

export function requestHint(id: string, user: UserRow, now = Date.now()): HintResponse {
  const row = loadOwnedActive(id, user);
  if (row.mode === 'assessment') throw new HttpError(400, 'Hints are turned off during assessments.');
  const module = getModule(row.module_id);
  const instance = json<ScenarioInstance>(row.instance, null as unknown as ScenarioInstance);
  const state = json<unknown>(row.state, null);
  const hints = json<HintResult[]>(row.hints, []);
  const log = loadLog(row.id);
  const probe = module.hint(instance, state, log, 1);
  if (hints.length >= probe.maxLevel) throw new HttpError(400, 'You have used every hint for this scenario.');
  const hint = module.hint(instance, state, log, hints.length + 1);
  hints.push(hint);
  const seq = log.length + 1;
  const t = Math.max(0, now - row.started_at);
  const observation = { text: hint.text, summary: `Used a hint (level ${hint.level})` };
  tx(() => {
    q.run(
      'INSERT INTO attempt_actions (attempt_id, seq, t, type, payload, observation, annotations) VALUES (?, ?, ?, ?, ?, ?, ?)',
      row.id,
      seq,
      t,
      'hint',
      JSON.stringify({ level: hint.level }),
      JSON.stringify(observation),
      '{}',
    );
    q.run('UPDATE attempts SET hints = ? WHERE id = ?', JSON.stringify(hints), row.id);
  });
  return { hint, hints, entry: publicEntry(module, { seq, t, type: 'hint', payload: { level: hint.level }, observation, annotations: {} }) };
}

export function submitAttempt(id: string, user: UserRow, action: ModuleAction, now = Date.now()): ActionResponse {
  const row = loadOwnedActive(id, user);
  const module = getModule(row.module_id);
  if (!action || action.type !== module.submitActionType) throw new HttpError(400, `Submit with a "${module.submitActionType}" action.`);
  return applyAction(id, user, action, now);
}

export function abandonAttempt(id: string, user: UserRow, now = Date.now()) {
  const row = loadOwnedActive(id, user);
  q.run("UPDATE attempts SET status = 'abandoned', completed_at = ? WHERE id = ?", now, row.id);
}

// ---------------------------------------------------------------------------
// Finalize: evaluation -> learner model -> patterns -> achievements -> next -> coach
// ---------------------------------------------------------------------------

export function finalize(id: string, now = Date.now()) {
  const row = loadAttempt(id);
  const module = getModule(row.module_id);
  const instance = json<ScenarioInstance>(row.instance, null as unknown as ScenarioInstance);
  const state = json<unknown>(row.state, null);
  const log = loadLog(row.id);
  const hints = json<HintResult[]>(row.hints, []);

  const me = module.evaluate(instance, state, log);
  const last = log[log.length - 1];
  const durationSec = Math.max(1, (last?.t ?? now - row.started_at) / 1000);
  const evaluation = composeEvaluation(me, {
    hintsUsed: hints.length,
    durationSec,
    actionCount: log.filter((e) => e.type !== 'hint').length,
  });

  const userId = row.user_id;
  const states: Record<string, SkillState> = loadSkillStates(userId);
  const historyBefore = historyDigests(userId);
  const patternsBefore = detectPatterns(historyBefore, ALL_MISTAKES);
  const skillChanges: SkillChange[] = [];

  tx(() => {
    for (const e of evaluation.skillEvidence) {
      if (e.weight <= 0 || !SKILL_BY_ID.has(e.skillId)) continue;
      const before = masteryInfo(states[e.skillId], now);
      const upd = updateSkill(states[e.skillId] ?? defaultSkillState(e.skillId), e.score, e.weight, instance.difficulty, now);
      states[e.skillId] = upd.after;
      saveSkillState(userId, upd.after, now);
      q.run(
        'INSERT INTO skill_events (user_id, skill_id, attempt_id, t, score, weight, mastery_before, mastery_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        userId,
        e.skillId,
        row.id,
        now,
        e.score,
        e.weight,
        upd.masteryBefore,
        upd.masteryAfter,
      );
      skillChanges.push({
        skillId: e.skillId,
        name: SKILL_BY_ID.get(e.skillId)!.name,
        moduleId: SKILL_MODULE[e.skillId],
        weight: e.weight,
        score: e.score,
        masteryBefore: upd.masteryBefore,
        masteryAfter: upd.masteryAfter,
        levelBefore: before.level,
        levelAfter: masteryInfo(upd.after, now).level,
        reasons: e.reasons,
      });
    }

    for (const m of evaluation.mistakes) {
      q.run(
        'INSERT INTO mistake_events (user_id, attempt_id, module_id, code, severity, count, t) VALUES (?, ?, ?, ?, ?, ?, ?)',
        userId,
        row.id,
        module.id,
        m.code,
        ALL_MISTAKES[m.code]?.severity ?? 'minor',
        m.count,
        now,
      );
    }

    const digest: AttemptDigest = {
      attemptId: row.id,
      moduleId: module.id,
      templateId: row.template_id,
      variantId: row.variant_id,
      difficulty: row.difficulty,
      completedAt: now,
      overall: evaluation.overall,
      solved: evaluation.solved,
      hintsUsed: hints.length,
      safety: evaluation.safety,
      efficiency: evaluation.efficiency,
      mistakes: evaluation.mistakes.map((m) => ({ code: m.code, count: m.count, severity: ALL_MISTAKES[m.code]?.severity ?? 'minor' })),
      strengths: evaluation.strengths.map((s) => s.code),
      focusSkills: instance.focusSkills,
    };
    const historyAfter = [digest, ...historyBefore];
    const patternsAfter: MistakePattern[] = detectPatterns(historyAfter, ALL_MISTAKES);

    const earned = new Set(q.all<{ achievement_id: string }>('SELECT achievement_id FROM achievements WHERE user_id = ?', userId).map((r) => r.achievement_id));
    const levels = Object.fromEntries(ALL_SKILLS.map((s) => [s.id, masteryInfo(states[s.id], now).level]));
    const newAchievements = checkAchievements({ current: digest, history: historyAfter, levels, skillModule: SKILL_MODULE, earned, patternsBefore, patternsAfter });
    for (const a of newAchievements) {
      q.run('INSERT OR IGNORE INTO achievements (user_id, achievement_id, earned_at, attempt_id) VALUES (?, ?, ?, ?)', userId, a, now, row.id);
    }

    const next = recommend({ catalog: buildCatalog(), skillStates: states, history: historyAfter, patterns: patternsAfter, now, moduleId: module.id, limit: 3 });

    const completedRow: AttemptRow = { ...row, status: 'completed', completed_at: now };
    const ctx = buildCoachContext(completedRow, { evaluation, skillChanges, patterns: patternsAfter, next });
    const coach: StoredCoach = offlineCoach(ctx);

    q.run(
      `UPDATE attempts SET status = 'completed', completed_at = ?, evaluation = ?, overall = ?, solved = ?, digest = ?, skill_changes = ?, coach = ?,
         new_achievements = ?, patterns = ?, next = ?, process_label = ?, process_tone = ?, duration_sec = ?, mistake_codes = ? WHERE id = ?`,
      now,
      JSON.stringify(evaluation),
      evaluation.overall,
      evaluation.solved ? 1 : 0,
      JSON.stringify(digest),
      JSON.stringify(skillChanges),
      JSON.stringify(coach),
      JSON.stringify(newAchievements),
      JSON.stringify(patternsAfter),
      JSON.stringify(next),
      evaluation.processVerdict.label,
      evaluation.processVerdict.tone,
      Math.round(durationSec),
      JSON.stringify(evaluation.mistakes.map((m) => m.code)),
      row.id,
    );
  });
}

// ---------------------------------------------------------------------------
// Debrief
// ---------------------------------------------------------------------------

export function debriefView(id: string, viewer: UserRow): DebriefResponse {
  const row = loadAttempt(id);
  if (!canView(row, viewer)) throw new HttpError(403, 'You cannot view this attempt.');
  if (row.status !== 'completed') throw new HttpError(409, 'This attempt is not complete yet.');
  const module = getModule(row.module_id);
  const instance = json<ScenarioInstance>(row.instance, null as unknown as ScenarioInstance);
  const state = json<unknown>(row.state, null);
  const evaluation = json<any>(row.evaluation, null);
  const timeline = new Map<number, { verdict: any; note: string }>(evaluation.timeline.map((t: any) => [t.seq, t]));
  const log: DebriefLogEntry[] = loadLog(row.id).map((e) => ({
    ...publicEntry(module, e),
    verdict: timeline.get(e.seq)?.verdict ?? null,
    note: timeline.get(e.seq)?.note || null,
  }));
  const learner = getUser(row.user_id)!;
  const coach = json<StoredCoach | null>(row.coach, null);
  return {
    attempt: attemptSummary(row),
    learner: toUserView(learner),
    scenario: module.publicScenario(instance),
    evaluation,
    log,
    skillChanges: json(row.skill_changes, []),
    patterns: json(row.patterns, []),
    newAchievements: json(row.new_achievements, []),
    coach: coach ?? { debrief: { headline: '', summary: '', wentWell: [], struggles: [], focusNext: [], closing: '' }, narrative: null, provider: 'offline' },
    messages: listMessages(row.id),
    next: json(row.next, []),
    reveal: module.reveal ? module.reveal(instance, state) : null,
    canChat: viewer.id === row.user_id,
  };
}

export function loadCompletedFor(id: string, viewer: UserRow, ownerOnly = false): AttemptRow {
  const row = loadAttempt(id);
  if (ownerOnly ? row.user_id !== viewer.id : !canView(row, viewer)) throw new HttpError(403, 'You cannot access this attempt.');
  if (row.status !== 'completed') throw new HttpError(409, 'This attempt is not complete yet.');
  return row;
}
