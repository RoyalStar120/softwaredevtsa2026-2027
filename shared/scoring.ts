/**
 * Platform-level scoring: composes a module's evaluation into an overall score.
 * Key principle: reaching the right answer through an unsafe or trial-and-error
 * process must NOT score the same as an effective procedure.
 */

import type { Evaluation, ModuleEvaluation, SkillEvidence } from './types.ts';
import { clamp, round } from './util.ts';

export const HINT_PENALTY = 4; // overall points per hint level used

export function composeEvaluation(
  me: ModuleEvaluation,
  meta: { hintsUsed: number; durationSec: number; actionCount: number },
): Evaluation {
  const base =
    me.safety === null
      ? 0.45 * me.accuracy + 0.35 * me.process + 0.2 * me.efficiency
      : 0.35 * me.accuracy + 0.3 * me.process + 0.15 * me.efficiency + 0.2 * me.safety;

  let overall = base * 100 - HINT_PENALTY * meta.hintsUsed;
  if (me.safety !== null && me.safety < 0.5) overall = Math.min(overall, 60); // unsafe process caps the score
  if (me.processVerdict.tone === 'danger') overall = Math.min(overall, 60);
  if (me.processVerdict.tone === 'warning') overall = Math.min(overall, 80); // right answer, weak process
  if (!me.solved) overall = Math.min(overall, 55);

  const hintFactor = Math.max(0.6, 1 - 0.07 * meta.hintsUsed);
  const skillEvidence: SkillEvidence[] = me.skillEvidence.map((e) => ({
    ...e,
    score: round(clamp(e.score * (e.skillId.endsWith('.safety') ? 1 : hintFactor)), 3),
    reasons:
      meta.hintsUsed > 0 && !e.skillId.endsWith('.safety')
        ? [...e.reasons, `${meta.hintsUsed} hint level(s) used`]
        : e.reasons,
  }));

  return {
    ...me,
    skillEvidence,
    overall: clamp(Math.round(overall), 0, 100),
    hintsUsed: meta.hintsUsed,
    durationSec: Math.round(meta.durationSec),
    actionCount: meta.actionCount,
  };
}
