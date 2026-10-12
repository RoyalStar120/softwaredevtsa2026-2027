/**
 * Recommendations and assignments from the learner's point of view.
 */

import type { AssignmentView, RecommendationsResponse } from '../../shared/api.ts';
import { MODULES } from '../../shared/modules/index.ts';
import { recommend } from '../../shared/adaptive.ts';
import { json, q } from '../db.ts';
import type { UserRow } from '../auth.ts';
import { adaptiveInputs } from './attempts.ts';

export function assignmentsForLearner(userId: string): AssignmentView[] {
  const rows = q.all<any>(
    `SELECT a.*, c.name AS class_name FROM assignments a
       JOIN classes c ON c.id = a.class_id
       JOIN class_members m ON m.class_id = a.class_id AND m.user_id = ?
     WHERE a.target_user_id IS NULL OR a.target_user_id = ?
     ORDER BY COALESCE(a.due_at, a.created_at) ASC`,
    userId,
    userId,
  );
  return rows.map((a) => {
    const done = q.get<any>(
      "SELECT id, overall FROM attempts WHERE user_id = ? AND assignment_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1",
      userId,
      a.id,
    );
    const active = done ? null : q.get<any>("SELECT id FROM attempts WHERE user_id = ? AND assignment_id = ? AND status = 'active' LIMIT 1", userId, a.id);
    return {
      id: a.id,
      classId: a.class_id,
      className: a.class_name,
      title: a.title,
      kind: a.kind,
      templateId: a.template_id,
      difficulty: a.difficulty,
      focusSkills: json<string[]>(a.focus_skills, []),
      dueAt: a.due_at,
      note: a.note,
      createdAt: a.created_at,
      targetUserId: a.target_user_id,
      status: done ? 'completed' : active ? 'in_progress' : 'open',
      attemptId: done?.id ?? active?.id ?? null,
      score: done?.overall ?? null,
    };
  });
}

export function recommendationsFor(user: UserRow, now = Date.now()): RecommendationsResponse {
  const inputs = adaptiveInputs(user.id, now);
  const byModule: RecommendationsResponse['byModule'] = {};
  for (const m of MODULES) byModule[m.id] = recommend({ ...inputs, moduleId: m.id, limit: 3 });
  return {
    assignments: assignmentsForLearner(user.id),
    top: recommend({ ...inputs, limit: 3 }),
    byModule,
  };
}

export function recommendForSkill(user: UserRow, skillId: string, now = Date.now()) {
  const inputs = adaptiveInputs(user.id, now);
  return recommend({ ...inputs, focusSkills: [skillId], limit: 1 })[0] ?? null;
}
