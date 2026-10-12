/**
 * Instructor analytics: class mastery matrix, common mistakes, assignment progress,
 * learning-evidence summaries (pre/post, error reduction) and research export.
 */

import type {
  AssignmentProgress,
  ClassDetailResponse,
  ClassMistakeStat,
  ClassSummary,
  CreateAssignmentRequest,
  EvidenceSummary,
  RosterStudent,
  StudentDetailResponse,
} from '../../shared/api.ts';
import { ALL_MISTAKES, ALL_SKILLS, findTemplate, SKILL_BY_ID } from '../../shared/modules/index.ts';
import { masteryInfo } from '../../shared/learnerModel.ts';
import { detectPatterns, type AttemptDigest } from '../../shared/patterns.ts';
import { recommend } from '../../shared/adaptive.ts';
import { json, newId, q, tx } from '../db.ts';
import { getUser, toUserView, type UserRow } from '../auth.ts';
import { attemptSummary, historyDigests, loadSkillStates, profileResponse, progressResponse, type AttemptRow } from './learner.ts';
import { adaptiveInputs, HttpError } from './attempts.ts';

const DAY = 86400000;

function ownedClass(classId: string, instructorId: string) {
  const c = q.get<any>('SELECT * FROM classes WHERE id = ? AND instructor_id = ?', classId, instructorId);
  if (!c) throw new HttpError(404, 'Class not found.');
  return c;
}

function genCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let i = 0; i < 20; i++) {
    const code = `${letters[Math.floor(Math.random() * letters.length)]}${letters[Math.floor(Math.random() * letters.length)]}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!q.get('SELECT 1 FROM classes WHERE code = ?', code)) return code;
  }
  return `SB-${Date.now() % 100000}`;
}

export function createClass(instructor: UserRow, name: string, code?: string, now = Date.now()): string {
  const id = newId('c_');
  q.run('INSERT INTO classes (id, name, code, instructor_id, created_at) VALUES (?, ?, ?, ?, ?)', id, name.trim() || 'My class', code ?? genCode(), instructor.id, now);
  return id;
}

export function joinClass(user: UserRow, code: string, now = Date.now()) {
  const c = q.get<any>('SELECT * FROM classes WHERE code = ?', code.trim());
  if (!c) throw new HttpError(404, 'No class found with that code.');
  q.run('INSERT OR IGNORE INTO class_members (class_id, user_id, joined_at) VALUES (?, ?, ?)', c.id, user.id, now);
  return { id: c.id, name: c.name };
}

function classStudents(classId: string): UserRow[] {
  return q.all<UserRow>(
    "SELECT u.* FROM class_members m JOIN users u ON u.id = m.user_id WHERE m.class_id = ? AND u.role = 'learner' ORDER BY u.display_name",
    classId,
  );
}

export function listClasses(instructor: UserRow, now = Date.now()): ClassSummary[] {
  return q.all<any>('SELECT * FROM classes WHERE instructor_id = ? ORDER BY created_at', instructor.id).map((c) => summarizeClass(c, now));
}

function summarizeClass(c: any, now: number): ClassSummary {
  const students = q.get<any>("SELECT COUNT(*) AS n FROM class_members m JOIN users u ON u.id = m.user_id WHERE m.class_id = ? AND u.role = 'learner'", c.id)!.n;
  const week = q.get<any>(
    "SELECT COUNT(*) AS n, AVG(a.overall) AS avg FROM attempts a JOIN class_members m ON m.user_id = a.user_id AND m.class_id = ? WHERE a.status = 'completed' AND a.completed_at > ?",
    c.id,
    now - 7 * DAY,
  )!;
  const all = q.get<any>(
    "SELECT AVG(a.overall) AS avg FROM attempts a JOIN class_members m ON m.user_id = a.user_id AND m.class_id = ? WHERE a.status = 'completed'",
    c.id,
  )!;
  const open = q.get<any>('SELECT COUNT(*) AS n FROM assignments WHERE class_id = ? AND (due_at IS NULL OR due_at > ?)', c.id, now)!.n;
  return {
    id: c.id,
    name: c.name,
    code: c.code,
    studentCount: students,
    createdAt: c.created_at,
    openAssignments: open,
    attemptsThisWeek: week.n ?? 0,
    avgScore: all.avg === null ? null : Math.round(all.avg),
  };
}

function avg(xs: number[]): number | null {
  return xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
}

export function classDetail(instructor: UserRow, classId: string, now = Date.now()): ClassDetailResponse {
  const c = ownedClass(classId, instructor.id);
  const students = classStudents(classId);
  const ids = students.map((s) => s.id);

  const roster: RosterStudent[] = students.map((s) => {
    const states = loadSkillStates(s.id);
    const scores = q
      .all<any>("SELECT overall, completed_at FROM attempts WHERE user_id = ? AND status = 'completed' ORDER BY completed_at", s.id)
      .map((r) => r.overall as number);
    const last = q.get<any>("SELECT MAX(completed_at) AS t FROM attempts WHERE user_id = ? AND status = 'completed'", s.id)!.t;
    const patterns = detectPatterns(historyDigests(s.id), ALL_MISTAKES);
    const skills: RosterStudent['skills'] = {};
    for (const sk of ALL_SKILLS) {
      const info = masteryInfo(states[sk.id], now);
      skills[sk.id] = { mastery: info.mastery, level: info.level, evidenceCount: states[sk.id]?.evidenceCount ?? 0 };
    }
    return {
      user: toUserView(s),
      completed: scores.length,
      avgScore: avg(scores),
      firstScores: avg(scores.slice(0, 2)),
      recentScores: avg(scores.slice(-3)),
      lastActiveAt: last ?? null,
      activePatterns: patterns.filter((p) => p.status === 'active').length,
      skills,
    };
  });

  // Common mistakes across the class (last 60 days)
  const mistakeMap = new Map<string, ClassMistakeStat>();
  if (ids.length) {
    const rows = q.all<any>(
      `SELECT me.code, me.module_id, me.user_id FROM mistake_events me JOIN class_members m ON m.user_id = me.user_id AND m.class_id = ? WHERE me.t > ?`,
      classId,
      now - 60 * DAY,
    );
    for (const r of rows) {
      const def = ALL_MISTAKES[r.code];
      if (!def) continue;
      const stat: ClassMistakeStat = mistakeMap.get(r.code) ?? {
        code: r.code,
        moduleId: r.module_id,
        title: def.title,
        severity: def.severity,
        skillIds: def.skillIds,
        occurrences: 0,
        students: 0,
        studentIds: [] as string[],
      };
      stat.occurrences++;
      if (!stat.studentIds.includes(r.user_id)) stat.studentIds.push(r.user_id);
      stat.students = stat.studentIds.length;
      mistakeMap.set(r.code, stat);
    }
  }
  const mistakes = [...mistakeMap.values()].sort((a, b) => b.students - a.students || b.occurrences - a.occurrences).slice(0, 10);

  // Assignments
  const assignments: AssignmentProgress[] = q.all<any>('SELECT * FROM assignments WHERE class_id = ? ORDER BY created_at DESC', classId).map((a) => {
    const targets = a.target_user_id ? [a.target_user_id] : ids;
    let completed = 0;
    let inProgress = 0;
    const scores: number[] = [];
    for (const uid of targets) {
      const done = q.get<any>("SELECT overall FROM attempts WHERE user_id = ? AND assignment_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1", uid, a.id);
      if (done) {
        completed++;
        scores.push(done.overall);
      } else if (q.get("SELECT 1 FROM attempts WHERE user_id = ? AND assignment_id = ? AND status = 'active'", uid, a.id)) inProgress++;
    }
    return {
      id: a.id,
      classId: a.class_id,
      className: c.name,
      title: a.title,
      kind: a.kind,
      templateId: a.template_id,
      difficulty: a.difficulty,
      focusSkills: json<string[]>(a.focus_skills, []),
      dueAt: a.due_at,
      note: a.note,
      createdAt: a.created_at,
      targetUserId: a.target_user_id,
      assignedCount: targets.length,
      completedCount: completed,
      inProgressCount: inProgress,
      avgScore: avg(scores),
    };
  });

  const evidence = evidenceSummary(students, classId);

  const recentAttempts = ids.length
    ? q
        .all<AttemptRow & { display_name: string }>(
          `SELECT a.*, u.display_name FROM attempts a JOIN class_members m ON m.user_id = a.user_id AND m.class_id = ? JOIN users u ON u.id = a.user_id
           WHERE a.status = 'completed' ORDER BY a.completed_at DESC LIMIT 12`,
          classId,
        )
        .map((r) => ({ ...attemptSummary(r), studentName: r.display_name }))
    : [];

  return { klass: summarizeClass(c, now), skills: ALL_SKILLS, roster, mistakes, assignments, evidence, recentAttempts };
}

function evidenceSummary(students: UserRow[], classId: string): EvidenceSummary {
  const prePost: EvidenceSummary['prePost'] = [];
  const byIndex = new Map<number, { mistakes: number[]; scores: number[] }>();
  let patternsResolved = 0;
  let patternsTotal = 0;
  for (const s of students) {
    const baseline = q.get<any>(
      `SELECT a.overall FROM attempts a JOIN assignments x ON x.id = a.assignment_id WHERE a.user_id = ? AND x.class_id = ? AND x.kind = 'baseline' AND a.status = 'completed' ORDER BY a.completed_at ASC LIMIT 1`,
      s.id,
      classId,
    );
    const transfer = q.get<any>(
      `SELECT a.overall FROM attempts a JOIN assignments x ON x.id = a.assignment_id WHERE a.user_id = ? AND x.class_id = ? AND x.kind = 'transfer' AND a.status = 'completed' ORDER BY a.completed_at DESC LIMIT 1`,
      s.id,
      classId,
    );
    if (baseline && transfer) prePost.push({ userId: s.id, name: s.display_name, baseline: baseline.overall, transfer: transfer.overall });

    const digests = q
      .all<any>("SELECT digest FROM attempts WHERE user_id = ? AND status = 'completed' AND digest IS NOT NULL ORDER BY completed_at", s.id)
      .map((r) => json<AttemptDigest | null>(r.digest, null))
      .filter((d): d is AttemptDigest => !!d);
    digests.forEach((d, i) => {
      const idx = i + 1;
      if (idx > 12) return;
      const b = byIndex.get(idx) ?? { mistakes: [], scores: [] };
      b.mistakes.push(d.mistakes.reduce((sum, m) => sum + m.count, 0));
      b.scores.push(d.overall);
      byIndex.set(idx, b);
    });

    // Patterns ever detected vs. resolved: scan the history with a sliding window.
    const seen = new Set<string>();
    const resolved = new Set<string>();
    for (let end = 2; end <= digests.length; end++) {
      const window = digests.slice(0, end).reverse();
      for (const p of detectPatterns(window, ALL_MISTAKES)) {
        const key = `${p.moduleId}:${p.code}`;
        if (p.status === 'active') seen.add(key);
        if (p.status === 'resolved' && seen.has(key)) resolved.add(key);
      }
    }
    patternsTotal += seen.size;
    patternsResolved += resolved.size;
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  return {
    prePost,
    baselineAvg: prePost.length ? Math.round(mean(prePost.map((p) => p.baseline))) : null,
    transferAvg: prePost.length ? Math.round(mean(prePost.map((p) => p.transfer))) : null,
    mistakesByAttemptIndex: [...byIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, v]) => v.scores.length >= 2)
      .map(([index, v]) => ({ index, avgMistakes: Math.round(mean(v.mistakes) * 100) / 100, avgScore: Math.round(mean(v.scores)), n: v.scores.length })),
    patternsResolved,
    patternsTotal,
    sampleSize: students.length,
    simulatedShare: students.length ? students.filter((s) => s.is_simulated).length / students.length : 0,
  };
}

export function createAssignment(instructor: UserRow, classId: string, req: CreateAssignmentRequest, now = Date.now()): string[] {
  ownedClass(classId, instructor.id);
  if (!req.title?.trim()) throw new HttpError(400, 'Give the assignment a title.');
  if (!req.templateId && !(req.focusSkills && req.focusSkills.length)) throw new HttpError(400, 'Choose a scenario or at least one skill objective.');
  if (req.templateId && !findTemplate(req.templateId)) throw new HttpError(400, 'Unknown scenario.');
  const focus = (req.focusSkills ?? []).filter((s) => SKILL_BY_ID.has(s));
  const kind = ['practice', 'baseline', 'transfer'].includes(req.kind) ? req.kind : 'practice';
  const targets = req.studentIds && req.studentIds.length ? req.studentIds : [null];
  const created: string[] = [];
  tx(() => {
    for (const t of targets) {
      if (t && !q.get('SELECT 1 FROM class_members WHERE class_id = ? AND user_id = ?', classId, t)) continue;
      const id = newId('as_');
      q.run(
        'INSERT INTO assignments (id, class_id, title, kind, template_id, difficulty, focus_skills, due_at, note, target_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        classId,
        req.title.trim(),
        kind,
        req.templateId ?? null,
        req.difficulty ?? null,
        JSON.stringify(focus),
        req.dueAt ?? null,
        req.note?.trim() || null,
        t,
        now,
      );
      created.push(id);
    }
  });
  return created;
}

export function deleteAssignment(instructor: UserRow, assignmentId: string) {
  const a = q.get<any>('SELECT a.id FROM assignments a JOIN classes c ON c.id = a.class_id WHERE a.id = ? AND c.instructor_id = ?', assignmentId, instructor.id);
  if (!a) throw new HttpError(404, 'Assignment not found.');
  q.run('DELETE FROM assignments WHERE id = ?', assignmentId);
}

export function studentDetail(instructor: UserRow, studentId: string, now = Date.now()): StudentDetailResponse {
  const classes = q.all<any>(
    'SELECT c.id, c.name FROM classes c JOIN class_members m ON m.class_id = c.id WHERE m.user_id = ? AND c.instructor_id = ?',
    studentId,
    instructor.id,
  );
  if (!classes.length) throw new HttpError(404, 'Student not found in your classes.');
  const student = getUser(studentId)!;
  const inputs = adaptiveInputs(studentId, now);
  return {
    user: toUserView(student),
    profile: profileResponse(student, now),
    progress: progressResponse(studentId),
    recommendations: recommend({ ...inputs, limit: 3 }),
    classes,
  };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(instructor: UserRow, classId: string): string {
  ownedClass(classId, instructor.id);
  const rows = q.all<any>(
    `SELECT a.*, u.display_name, u.is_simulated, x.kind AS assignment_kind FROM attempts a
       JOIN class_members m ON m.user_id = a.user_id AND m.class_id = ?
       JOIN users u ON u.id = a.user_id
       LEFT JOIN assignments x ON x.id = a.assignment_id
     WHERE a.status = 'completed' ORDER BY u.display_name, a.completed_at`,
    classId,
  );
  const header = [
    'student', 'simulated_student', 'attempt_id', 'module', 'template', 'difficulty', 'mode', 'source', 'assignment_kind',
    'started_at', 'completed_at', 'duration_sec', 'overall', 'solved', 'accuracy', 'process', 'efficiency', 'safety',
    'hints_used', 'process_verdict', 'mistakes',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    const ev = json<any>(r.evaluation, {});
    lines.push(
      [
        r.display_name, r.is_simulated ? 'yes' : 'no', r.id, r.module_id, r.template_id, r.difficulty, r.mode, r.source, r.assignment_kind ?? '',
        new Date(r.started_at).toISOString(), new Date(r.completed_at).toISOString(), r.duration_sec, r.overall, r.solved ? 1 : 0,
        ev.accuracy, ev.process, ev.efficiency, ev.safety ?? '', ev.hintsUsed ?? 0, r.process_label, json<string[]>(r.mistake_codes, []).join(' '),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n');
}
