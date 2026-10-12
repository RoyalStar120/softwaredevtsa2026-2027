/**
 * Mistake-pattern detection: identifies mistakes that RECUR across a learner's
 * recent attempts in a module (not just within one attempt), and tracks whether
 * a pattern is still active, improving, or resolved.
 */

import type { MistakeDef, Severity } from './types.ts';

/** Compact summary of a completed attempt used by the adaptive engine and analytics. */
export interface AttemptDigest {
  attemptId: string;
  moduleId: string;
  templateId: string;
  variantId: string;
  difficulty: number;
  completedAt: number;
  overall: number;
  solved: boolean;
  hintsUsed: number;
  safety: number | null;
  efficiency: number;
  mistakes: Array<{ code: string; count: number; severity: Severity }>;
  strengths: string[];
  focusSkills: string[];
}

export type PatternStatus = 'active' | 'improving' | 'resolved';

export interface MistakePattern {
  code: string;
  moduleId: string;
  title: string;
  severity: Severity;
  skillIds: string[];
  /** Number of attempts (inside the window) in which the mistake appeared. */
  occurrences: number;
  window: number;
  totalCount: number;
  lastSeenAt: number;
  /** Consecutive most-recent attempts in which the mistake did NOT appear. */
  absentStreak: number;
  status: PatternStatus;
}

export const PATTERN_WINDOW = 5;

/**
 * @param history completed attempts, NEWEST FIRST
 * @param mistakeDefs merged mistake catalogs of all modules
 */
export function detectPatterns(
  history: readonly AttemptDigest[],
  mistakeDefs: Record<string, MistakeDef>,
): MistakePattern[] {
  const byModule = new Map<string, AttemptDigest[]>();
  for (const a of history) {
    const list = byModule.get(a.moduleId) ?? [];
    if (list.length < PATTERN_WINDOW) list.push(a);
    byModule.set(a.moduleId, list);
  }

  const patterns: MistakePattern[] = [];
  for (const [moduleId, attempts] of byModule) {
    const codes = new Set(attempts.flatMap((a) => a.mistakes.map((m) => m.code)));
    for (const code of codes) {
      const def = mistakeDefs[code];
      if (!def) continue;
      const hits = attempts.filter((a) => a.mistakes.some((m) => m.code === code));
      if (hits.length < 2) continue;
      let absentStreak = 0;
      for (const a of attempts) {
        if (a.mistakes.some((m) => m.code === code)) break;
        absentStreak++;
      }
      const status: PatternStatus = absentStreak >= 2 ? 'resolved' : absentStreak === 1 ? 'improving' : 'active';
      patterns.push({
        code,
        moduleId,
        title: def.title,
        severity: def.severity,
        skillIds: def.skillIds,
        occurrences: hits.length,
        window: attempts.length,
        totalCount: hits.reduce((s, a) => s + (a.mistakes.find((m) => m.code === code)?.count ?? 0), 0),
        lastSeenAt: hits[0].completedAt,
        absentStreak,
        status,
      });
    }
  }
  const sevRank: Record<Severity, number> = { critical: 3, major: 2, minor: 1 };
  const statusRank: Record<PatternStatus, number> = { active: 3, improving: 2, resolved: 1 };
  return patterns.sort(
    (a, b) =>
      statusRank[b.status] - statusRank[a.status] ||
      sevRank[b.severity] - sevRank[a.severity] ||
      b.occurrences - a.occurrences,
  );
}
