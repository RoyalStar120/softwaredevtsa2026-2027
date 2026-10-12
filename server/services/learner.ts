/**
 * Learner profile service: skill states, attempt history digests, mistake patterns,
 * profile and progress views.
 */

import type { LoggedAction, Tone } from '../../shared/types.ts';
import type {
  AttemptSummary,
  MistakeTrendPoint,
  ProfileResponse,
  ProgressResponse,
  PublicLogEntry,
  SkillHistoryPoint,
  SkillView,
} from '../../shared/api.ts';
import type { SkillModule } from '../../shared/types.ts';
import { ALL_MISTAKES, ALL_SKILLS } from '../../shared/modules/index.ts';
import { defaultSkillState, masteryInfo, masteryOf, type SkillState } from '../../shared/learnerModel.ts';
import { detectPatterns, type AttemptDigest } from '../../shared/patterns.ts';
import { json, q } from '../db.ts';
import { toUserView, type UserRow } from '../auth.ts';

export interface AttemptRow {
  id: string;
  user_id: string;
  module_id: string;
  template_id: string;
  difficulty: number;
  seed: number;
  variant_id: string;
  title: string;
  instance: string;
  state: string;
  status: 'active' | 'completed' | 'abandoned';
  mode: 'practice' | 'assessment';
  source: string;
  assignment_id: string | null;
  recommendation: string | null;
  hints: string;
  started_at: number;
  completed_at: number | null;
  evaluation: string | null;
  overall: number | null;
  solved: number | null;
  digest: string | null;
  skill_changes: string | null;
  coach: string | null;
  new_achievements: string | null;
  patterns: string | null;
  next: string | null;
  process_label: string | null;
  process_tone: string | null;
  duration_sec: number | null;
  mistake_codes: string | null;
}

const SUMMARY_COLS =
  'id, user_id, module_id, template_id, difficulty, title, status, mode, source, assignment_id, hints, started_at, completed_at, overall, solved, process_label, process_tone, duration_sec, mistake_codes';

export function attemptSummary(row: Partial<AttemptRow>): AttemptSummary {
  return {
    id: row.id!,
    userId: row.user_id!,
    moduleId: row.module_id!,
    templateId: row.template_id!,
    title: row.title!,
    difficulty: row.difficulty!,
    status: row.status!,
    mode: row.mode!,
    source: row.source as AttemptSummary['source'],
    startedAt: row.started_at!,
    completedAt: row.completed_at ?? null,
    overall: row.overall ?? null,
    solved: row.solved === null || row.solved === undefined ? null : !!row.solved,
    processLabel: row.process_label ?? null,
    processTone: (row.process_tone as Tone) ?? null,
    hintsUsed: json<unknown[]>(row.hints, []).length,
    durationSec: row.duration_sec ?? null,
    mistakeCodes: json<string[]>(row.mistake_codes, []),
    assignmentId: row.assignment_id ?? null,
  };
}

export function loadSkillStates(userId: string): Record<string, SkillState> {
  const out: Record<string, SkillState> = {};
  for (const r of q.all<{ skill_id: string; state: string }>('SELECT skill_id, state FROM skill_states WHERE user_id = ?', userId)) {
    out[r.skill_id] = json(r.state, defaultSkillState(r.skill_id));
  }
  return out;
}

export function saveSkillState(userId: string, s: SkillState, now: number) {
  q.run(
    'INSERT INTO skill_states (user_id, skill_id, state, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, skill_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at',
    userId,
    s.skillId,
    JSON.stringify(s),
    now,
  );
}

/** Completed attempts, newest first. */
export function historyDigests(userId: string, limit = 80): AttemptDigest[] {
  return q
    .all<{ digest: string }>(
      "SELECT digest FROM attempts WHERE user_id = ? AND status = 'completed' AND digest IS NOT NULL ORDER BY completed_at DESC LIMIT ?",
      userId,
      limit,
    )
    .map((r) => json<AttemptDigest>(r.digest, null as unknown as AttemptDigest))
    .filter(Boolean);
}

export function skillViews(states: Record<string, SkillState>, now: number): SkillView[] {
  return ALL_SKILLS.map((s) => {
    const st = states[s.id];
    const info = masteryInfo(st, now);
    return {
      skillId: s.id,
      moduleId: s.moduleId,
      mastery: info.mastery,
      level: info.level,
      evidenceCount: st?.evidenceCount ?? 0,
      reviewDue: info.reviewDue,
      consistent: info.consistent,
      note: info.note,
      recentScores: st?.recentScores ?? [],
      lastPracticedAt: st?.lastPracticedAt ?? null,
      unlocked: s.prerequisites.every((p) => masteryOf(states[p]) >= 0.4),
    };
  });
}

export function loadLog(attemptId: string): Array<LoggedAction & { message: string | null; messageTone: string | null }> {
  return q
    .all<any>('SELECT * FROM attempt_actions WHERE attempt_id = ? ORDER BY seq', attemptId)
    .map((r) => ({
      seq: r.seq,
      t: r.t,
      type: r.type,
      payload: json(r.payload, {}),
      observation: json(r.observation, {}),
      annotations: json(r.annotations, {}),
      message: r.message ?? null,
      messageTone: r.message_tone ?? null,
    }));
}

export function publicEntry(module: SkillModule, e: LoggedAction & { message?: string | null; messageTone?: string | null }): PublicLogEntry {
  const entry: PublicLogEntry = { seq: e.seq, t: e.t, type: e.type, description: module.describeAction(e), observation: e.observation };
  if (e.message) entry.message = e.message;
  if (e.messageTone) entry.messageTone = e.messageTone as Tone;
  return entry;
}

export function profileResponse(user: UserRow, now = Date.now()): ProfileResponse {
  const states = loadSkillStates(user.id);
  const digests = historyDigests(user.id);
  const stats = q.get<any>(
    "SELECT COUNT(*) AS completed, SUM(CASE WHEN solved = 1 THEN 1 ELSE 0 END) AS solved, AVG(overall) AS avg, SUM(duration_sec) AS secs, COUNT(DISTINCT date(completed_at / 1000, 'unixepoch', 'localtime')) AS days FROM attempts WHERE user_id = ? AND status = 'completed'",
    user.id,
  )!;
  const recent = q
    .all<AttemptRow>(`SELECT ${SUMMARY_COLS} FROM attempts WHERE user_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 8`, user.id)
    .map(attemptSummary);
  const active = q.get<AttemptRow>(`SELECT ${SUMMARY_COLS} FROM attempts WHERE user_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1`, user.id);
  const classes = q.all<any>(
    'SELECT c.id, c.name, u.display_name AS instructor FROM class_members m JOIN classes c ON c.id = m.class_id JOIN users u ON u.id = c.instructor_id WHERE m.user_id = ? ORDER BY c.created_at',
    user.id,
  );
  return {
    user: toUserView(user),
    skills: skillViews(states, now),
    patterns: detectPatterns(digests, ALL_MISTAKES),
    achievements: q
      .all<any>('SELECT achievement_id, earned_at, attempt_id FROM achievements WHERE user_id = ? ORDER BY earned_at DESC', user.id)
      .map((r) => ({ id: r.achievement_id, earnedAt: r.earned_at, attemptId: r.attempt_id })),
    stats: {
      completed: stats.completed ?? 0,
      solved: stats.solved ?? 0,
      avgScore: stats.avg ? Math.round(stats.avg) : 0,
      practiceMinutes: Math.round((stats.secs ?? 0) / 60),
      activeDays: stats.days ?? 0,
    },
    recent,
    activeAttempt: active ? attemptSummary(active) : null,
    classes: classes.map((c) => ({ id: c.id, name: c.name, instructorName: c.instructor })),
  };
}

export function progressResponse(userId: string): ProgressResponse {
  const skillHistory: Record<string, SkillHistoryPoint[]> = {};
  for (const r of q.all<any>('SELECT skill_id, attempt_id, t, score, weight, mastery_after FROM skill_events WHERE user_id = ? ORDER BY t', userId)) {
    (skillHistory[r.skill_id] ??= []).push({ t: r.t, attemptId: r.attempt_id, mastery: r.mastery_after, score: r.score, weight: r.weight });
  }
  const rows = q.all<AttemptRow>(`SELECT ${SUMMARY_COLS}, digest FROM attempts WHERE user_id = ? AND status = 'completed' ORDER BY completed_at`, userId);
  const mistakeTrend: MistakeTrendPoint[] = rows.map((r) => {
    const d = json<AttemptDigest | null>(r.digest, null);
    return {
      attemptId: r.id,
      completedAt: r.completed_at!,
      moduleId: r.module_id,
      title: r.title,
      mistakes: d ? d.mistakes.reduce((s, m) => s + m.count, 0) : 0,
      critical: d ? d.mistakes.filter((m) => m.severity === 'critical').length : 0,
      overall: r.overall ?? 0,
    };
  });
  return { skillHistory, attempts: rows.map(attemptSummary).reverse(), mistakeTrend };
}
