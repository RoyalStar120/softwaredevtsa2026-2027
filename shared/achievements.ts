/**
 * Milestones and achievements. Most reward PROCESS (evidence-first repairs, safety,
 * reproducing bugs, breaking a recurring mistake), not just correct answers.
 */

import type { MasteryLevel } from './types.ts';
import type { AttemptDigest, MistakePattern } from './patterns.ts';

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string; // lucide icon key (resolved on the client)
  tier: 'bronze' | 'silver' | 'gold';
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_steps', title: 'First Steps', description: 'Complete your first scenario.', icon: 'footprints', tier: 'bronze' },
  { id: 'top_marks', title: 'Top Marks', description: 'Score 90 or higher on a scenario.', icon: 'trophy', tier: 'bronze' },
  { id: 'evidence_first', title: 'Evidence First', description: 'Make a repair or fix that your own evidence had already pinned down.', icon: 'microscope', tier: 'silver' },
  { id: 'unassisted', title: 'Unassisted', description: 'Solve a difficulty 3+ scenario without hints.', icon: 'sparkles', tier: 'silver' },
  { id: 'expert_path', title: 'Expert Path', description: 'Solve a scenario with 90%+ efficiency.', icon: 'route', tier: 'silver' },
  { id: 'scientist', title: 'Scientist', description: 'Reproduce the bug before editing in 3 debugging scenarios.', icon: 'flask', tier: 'silver' },
  { id: 'surgical_fix', title: 'Surgical Fix', description: 'Solve a debugging scenario with a minimal, verified fix.', icon: 'scissors', tier: 'silver' },
  { id: 'persistence', title: 'Persistence', description: 'Complete 10 scenarios.', icon: 'flame', tier: 'silver' },
  { id: 'safety_streak', title: 'Safety First', description: 'Complete 3 electrical scenarios in a row with a perfect safety score.', icon: 'shield', tier: 'gold' },
  { id: 'comeback', title: 'Comeback', description: 'Break a recurring mistake pattern.', icon: 'trending', tier: 'gold' },
  { id: 'mastery', title: 'Mastery', description: 'Reach Mastered in any skill.', icon: 'crown', tier: 'gold' },
  { id: 'cross_trained', title: 'Cross-Trained', description: 'Reach Proficient or better in skills from two different modules.', icon: 'layers', tier: 'gold' },
];

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export interface AchievementContext {
  current: AttemptDigest;
  /** Completed attempts including the current one, NEWEST FIRST. */
  history: AttemptDigest[];
  levels: Record<string, MasteryLevel>;
  skillModule: Record<string, string>;
  earned: Set<string>;
  patternsBefore: MistakePattern[];
  patternsAfter: MistakePattern[];
}

export function checkAchievements(ctx: AchievementContext): string[] {
  const out: string[] = [];
  const award = (id: string, cond: boolean) => {
    if (cond && !ctx.earned.has(id)) out.push(id);
  };
  const c = ctx.current;
  award('first_steps', ctx.history.length >= 1);
  award('top_marks', c.overall >= 90);
  award('evidence_first', c.strengths.some((s) => s.endsWith('.evidence_based')));
  award('unassisted', c.solved && c.difficulty >= 3 && c.hintsUsed === 0);
  award('expert_path', c.solved && c.efficiency >= 0.9);
  award('scientist', ctx.history.filter((h) => h.strengths.includes('prog.reproduced_first')).length >= 3);
  award('surgical_fix', c.solved && c.strengths.includes('prog.minimal_fix') && c.strengths.includes('prog.verified_fix'));
  award('persistence', ctx.history.length >= 10);
  const elec = ctx.history.filter((h) => h.moduleId === 'electrical').slice(0, 3);
  award('safety_streak', elec.length === 3 && elec.every((h) => h.safety === 1));
  const wasActive = new Set(ctx.patternsBefore.filter((p) => p.status !== 'resolved').map((p) => `${p.moduleId}:${p.code}`));
  award('comeback', ctx.patternsAfter.some((p) => p.status === 'resolved' && wasActive.has(`${p.moduleId}:${p.code}`)));
  award('mastery', Object.values(ctx.levels).includes('mastered'));
  const strongModules = new Set(
    Object.entries(ctx.levels)
      .filter(([, l]) => l === 'proficient' || l === 'mastered')
      .map(([s]) => ctx.skillModule[s]),
  );
  award('cross_trained', strongModules.size >= 2);
  return out;
}
