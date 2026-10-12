/**
 * Built-in (offline) AI coach.
 *
 * Produces a structured debrief and answers follow-up questions using ONLY trusted data:
 * the simulation's evaluation, the annotated action log, the module's feedback guidelines
 * and the learner's skill profile. It never invents the scenario's correct answer - the
 * deterministic simulation engine owns the truth. When an LLM is configured, the server
 * sends the very same context (see `buildLlmContext`) so the LLM is grounded the same way.
 */

import type {
  Evaluation,
  KnowledgeTopic,
  MasteryLevel,
  MistakeDef,
  Severity,
  StrengthDef,
  Verdict,
} from './types.ts';
import type { MistakePattern } from './patterns.ts';
import { LEVEL_LABELS } from './learnerModel.ts';
import { listJoin, pct, plural } from './util.ts';

export interface CoachStep {
  seq: number;
  description: string;
  verdict: Verdict | null;
  note: string | null;
}

export interface CoachSkillChange {
  skillId: string;
  name: string;
  weight: number;
  score: number;
  masteryBefore: number;
  masteryAfter: number;
  levelBefore: MasteryLevel;
  levelAfter: MasteryLevel;
}

export interface CoachContext {
  learnerName: string;
  moduleId: string;
  moduleName: string;
  scenario: { title: string; briefing: string; goal: string; objectives: string[]; difficulty: number };
  evaluation: Evaluation;
  steps: CoachStep[];
  skillChanges: CoachSkillChange[];
  patterns: MistakePattern[];
  mistakeDefs: Record<string, MistakeDef>;
  strengthDefs: Record<string, StrengthDef>;
  skillNames: Record<string, string>;
  knowledge: KnowledgeTopic[];
  next: { title: string; difficulty: number; reasons: string[] } | null;
  safetyNotice?: string;
}

export interface CoachStruggle {
  code: string;
  title: string;
  severity: Severity;
  detail: string;
  why: string;
  instead: string;
  repeated: boolean;
  repeatNote: string | null;
}

export interface CoachDebrief {
  headline: string;
  summary: string;
  wentWell: Array<{ title: string; detail: string }>;
  struggles: CoachStruggle[];
  focusNext: string[];
  closing: string;
}

const SEV_RANK: Record<Severity, number> = { critical: 3, major: 2, minor: 1 };

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

function stepRefs(steps: number[]): string {
  if (!steps.length) return '';
  const s = steps.slice(0, 4).map((n) => `step ${n}`);
  return steps.length > 4 ? `${s.join(', ')} and ${steps.length - 4} more` : listJoin(s);
}

export function offlineDebrief(ctx: CoachContext): CoachDebrief {
  const ev = ctx.evaluation;
  const tone = ev.processVerdict.tone;
  const name = firstName(ctx.learnerName);

  let headline: string;
  if (ev.solved && tone === 'success') headline = `Nice work, ${name}! ${ev.outcomeLabel}, and your process was effective.`;
  else if (ev.solved) headline = `${ev.outcomeLabel}. However, ${ev.processVerdict.label.toLowerCase()}.`;
  else headline = `${ev.outcomeLabel}. Let's look at what to change next time.`;

  // Summary grounded in metrics.
  const parts: string[] = [];
  parts.push(
    `You scored ${ev.overall}/100 (accuracy ${pct(ev.accuracy)}, process ${pct(ev.process)}, efficiency ${pct(ev.efficiency)}${
      ev.safety !== null ? `, safety ${pct(ev.safety)}` : ''
    }).`,
  );
  parts.push(ev.processVerdict.explanation);
  const bench = ev.metrics.find((m) => m.benchmark !== undefined && typeof m.value === 'number');
  if (bench) {
    parts.push(
      `${bench.label}: ${bench.value}${bench.unit ? ` ${bench.unit}` : ''} (${bench.benchmarkLabel ?? 'benchmark'}: ${bench.benchmark}).`,
    );
  }
  if (ev.hintsUsed > 0) parts.push(`You used ${plural(ev.hintsUsed, 'hint level')}.`);

  const wentWell = ev.strengths.slice(0, 4).map((s) => {
    const def = ctx.strengthDefs[s.code];
    return { title: def?.title ?? s.code, detail: `${s.detail}${def ? ` ${def.why}` : ''}` };
  });
  if (wentWell.length === 0) {
    const good = ctx.steps.filter((s) => s.verdict === 'good').slice(0, 2);
    for (const g of good) wentWell.push({ title: `Step ${g.seq}`, detail: g.note ?? g.description });
  }

  const struggles: CoachStruggle[] = ev.mistakes
    .slice()
    .sort((a, b) => SEV_RANK[ctx.mistakeDefs[b.code]?.severity ?? 'minor'] - SEV_RANK[ctx.mistakeDefs[a.code]?.severity ?? 'minor'])
    .map((m) => {
      const def = ctx.mistakeDefs[m.code];
      const pattern = ctx.patterns.find((p) => p.code === m.code && p.status === 'active');
      return {
        code: m.code,
        title: def?.title ?? m.code,
        severity: def?.severity ?? 'minor',
        detail: m.steps.length ? `${m.detail} (${stepRefs(m.steps)})` : m.detail,
        why: def?.why ?? '',
        instead: def?.instead ?? '',
        repeated: !!pattern,
        repeatNote: pattern
          ? `This has now happened in ${pattern.occurrences} of your last ${pattern.window} ${ctx.moduleName} attempts, so SkillBridge will target it in your next scenarios.`
          : null,
      };
    });

  const focusNext: string[] = [];
  const weakEvidence = ev.skillEvidence
    .filter((e) => e.weight >= 0.4 && e.score < 0.7)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
  for (const e of weakEvidence) {
    focusNext.push(`${ctx.skillNames[e.skillId] ?? e.skillId}: ${e.reasons[0] ?? 'needs more practice'}.`);
  }
  if (ctx.next) {
    focusNext.push(`Next up: "${ctx.next.title}" (difficulty ${ctx.next.difficulty}/5). ${ctx.next.reasons[0] ?? ''}`.trim());
  }

  const levelUps = ctx.skillChanges.filter((c) => c.levelAfter !== c.levelBefore && c.masteryAfter > c.masteryBefore);
  let closing = levelUps.length
    ? `Level up: ${listJoin(levelUps.map((c) => `${c.name} is now ${LEVEL_LABELS[c.levelAfter]}`))}. Keep it going!`
    : ev.solved
      ? 'Each attempt sharpens your process. The next scenario will push on the areas above.'
      : 'Mistakes here are safe and useful. They show exactly what to practice next.';
  if (ctx.safetyNotice && ev.safety !== null && ev.safety < 1) closing += ` Reminder: ${ctx.safetyNotice}`;

  return { headline, summary: parts.join(' '), wentWell, struggles, focusNext, closing };
}

export function debriefToMarkdown(d: CoachDebrief): string {
  const lines: string[] = [`**${d.headline}**`, '', d.summary, ''];
  if (d.wentWell.length) {
    lines.push('**What went well**');
    for (const w of d.wentWell) lines.push(`- **${w.title}:** ${w.detail}`);
    lines.push('');
  }
  if (d.struggles.length) {
    lines.push('**Where you struggled**');
    for (const s of d.struggles) {
      lines.push(`- **${s.title}:** ${s.detail} ${s.why} *Instead:* ${s.instead}${s.repeatNote ? ` ${s.repeatNote}` : ''}`);
    }
    lines.push('');
  }
  if (d.focusNext.length) {
    lines.push('**Focus next**');
    for (const f of d.focusNext) lines.push(`- ${f}`);
    lines.push('');
  }
  lines.push(d.closing);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Follow-up questions (offline intent matching, grounded in the attempt)
// ---------------------------------------------------------------------------

const STOP = new Set([
  'the', 'and', 'for', 'was', 'what', 'why', 'how', 'did', 'does', 'that', 'this', 'with', 'you', 'your', 'are',
  'can', 'should', 'have', 'from', 'about', 'when', 'then', 'there', 'into', 'were', 'which', 'would', 'could',
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function overlapScore(q: string[], keywords: string[]): number {
  let score = 0;
  for (const k of keywords) {
    const kw = k.toLowerCase();
    if (kw.includes(' ')) {
      if (q.join(' ').includes(kw)) score += 2;
    } else if (q.some((w) => w === kw || (kw.length > 4 && w.startsWith(kw.slice(0, -1))))) score += 1;
  }
  return score;
}

export function offlineAnswer(ctx: CoachContext, question: string): string {
  const q = question.toLowerCase();
  const qt = tokens(question);
  const ev = ctx.evaluation;

  // 1. Specific step
  const stepMatch = q.match(/step\s*#?\s*(\d+)/);
  if (stepMatch) {
    const n = Number(stepMatch[1]);
    const step = ctx.steps.find((s) => s.seq === n);
    if (!step) return `I don't see a step ${n} in this attempt. Your attempt had ${ctx.steps.length} recorded steps.`;
    const related = ev.mistakes.filter((m) => m.steps.includes(n));
    let answer = `**Step ${n}:** ${step.description}.`;
    if (step.note) answer += ` ${step.note}`;
    for (const m of related) {
      const def = ctx.mistakeDefs[m.code];
      if (def) answer += `\n\n**${def.title}.** ${def.why} *Better approach:* ${def.instead}`;
    }
    if (!step.note && !related.length) answer += ' The engine did not flag anything special about this step.';
    return answer;
  }

  // 2. Root cause / answer
  if (/(what|which).*(fault|bug|problem|issue|answer|root cause|wrong with)|root cause|real (fault|bug|problem)/.test(q)) {
    return `**${ev.groundTruth.summary}**\n\n${ev.groundTruth.details.map((d) => `- ${d}`).join('\n')}`;
  }

  // 3. Expert / better approach
  if (/(should i have|better|expert|optimal|ideal|best way|faster|efficient|instead|do differently|right way)/.test(q)) {
    if (ev.expertPath) {
      return `**${ev.expertPath.summary}**\n\n${ev.expertPath.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    }
    const tips = ev.mistakes.map((m) => ctx.mistakeDefs[m.code]).filter(Boolean).map((d) => `- ${d!.instead}`);
    return tips.length ? `Here's what would have improved your process:\n${tips.join('\n')}` : 'Your process was already solid. Keep doing what you did!';
  }

  // 4. Score
  if (/(score|grade|points|overall|why did i get|marks|rating)/.test(q)) {
    const lines = [
      `Your overall score was **${ev.overall}/100**. It combines:`,
      `- Accuracy ${pct(ev.accuracy)}: ${ev.outcomeLabel.toLowerCase()}`,
      `- Process ${pct(ev.process)}: ${ev.processVerdict.label}`,
      `- Efficiency ${pct(ev.efficiency)}`,
    ];
    if (ev.safety !== null) lines.push(`- Safety ${pct(ev.safety)}${ev.safety < 0.5 ? ' (unsafe processes cap the score at 60)' : ''}`);
    if (ev.hintsUsed) lines.push(`- Hints: -${ev.hintsUsed * 4} points (${plural(ev.hintsUsed, 'hint level')})`);
    if (!ev.solved) lines.push('- Unsolved attempts are capped at 55.');
    return lines.join('\n');
  }

  // 5. Specific mistake match
  let bestMistake: { score: number; text: string } | null = null;
  for (const m of ev.mistakes) {
    const def = ctx.mistakeDefs[m.code];
    if (!def) continue;
    const s = overlapScore(qt, [...tokens(def.title), ...m.code.split(/[._]/)]);
    if (s > 0 && (!bestMistake || s > bestMistake.score)) {
      bestMistake = {
        score: s,
        text: `**${def.title}**: ${m.detail}${m.steps.length ? ` (${stepRefs(m.steps)})` : ''}.\n\n**Why it matters:** ${def.why}\n\n**What to do instead:** ${def.instead}${
          def.realWorld ? `\n\n**In the real world:** ${def.realWorld}` : ''
        }`,
      };
    }
  }

  // 6. Improvement / next
  if (/(improve|practice|next|work on|focus|get better|weak)/.test(q)) {
    const weak = ev.skillEvidence.filter((e) => e.weight >= 0.4).sort((a, b) => a.score - b.score).slice(0, 2);
    const lines = ['Based on this attempt, focus on:'];
    for (const e of weak) lines.push(`- **${ctx.skillNames[e.skillId] ?? e.skillId}** (${pct(e.score)} this attempt): ${e.reasons[0] ?? ''}`);
    if (ctx.next) lines.push(`\nYour recommended next scenario is **${ctx.next.title}** (difficulty ${ctx.next.difficulty}/5): ${ctx.next.reasons[0] ?? ''}`);
    return lines.join('\n');
  }

  // 7. Knowledge base topic
  let bestTopic: { score: number; topic: KnowledgeTopic } | null = null;
  for (const t of ctx.knowledge) {
    const s = overlapScore(qt, t.keywords);
    if (s > 0 && (!bestTopic || s > bestTopic.score)) bestTopic = { score: s, topic: t };
  }

  if (bestMistake && (!bestTopic || bestMistake.score >= bestTopic.score)) return bestMistake.text;
  if (bestTopic) return `**${bestTopic.topic.title}**\n\n${bestTopic.topic.answer}`;

  // 8. Small talk
  if (/^(thanks|thank you|thx|ok|okay|cool|great)/.test(q.trim())) return "You're welcome! Ready for your next scenario?";
  if (/^(hi|hello|hey)\b/.test(q.trim())) return `Hi ${firstName(ctx.learnerName)}! Ask me about any step, your score, the root cause, or how an expert would approach this scenario.`;

  return [
    "I can only answer from what happened in this scenario. Try asking:",
    '- "Why was step 3 a mistake?"',
    '- "What was the actual fault?"',
    '- "What should I have done instead?"',
    '- "How can I improve?"',
    `- A question about a concept, e.g. "${ctx.knowledge[0]?.keywords[0] ?? 'debugging'}"`,
  ].join('\n');
}

/** Compact, trusted context sent to an LLM (no invented data, only engine output). */
export function buildLlmContext(ctx: CoachContext) {
  const ev = ctx.evaluation;
  return {
    learner: firstName(ctx.learnerName),
    module: ctx.moduleName,
    scenario: ctx.scenario,
    outcome: {
      solved: ev.solved,
      outcome: ev.outcomeLabel,
      processVerdict: ev.processVerdict,
      overall: ev.overall,
      accuracy: ev.accuracy,
      process: ev.process,
      efficiency: ev.efficiency,
      safety: ev.safety,
      hintsUsed: ev.hintsUsed,
      durationSec: ev.durationSec,
    },
    groundTruth: ev.groundTruth,
    expertPath: ev.expertPath ?? null,
    metrics: ev.metrics,
    steps: ctx.steps.slice(0, 80).map((s) => ({ step: s.seq, action: s.description, verdict: s.verdict, note: s.note })),
    mistakes: ev.mistakes.map((m) => {
      const def = ctx.mistakeDefs[m.code];
      return { title: def?.title ?? m.code, severity: def?.severity, steps: m.steps, detail: m.detail, why: def?.why, instead: def?.instead };
    }),
    strengths: ev.strengths.map((s) => ({ title: ctx.strengthDefs[s.code]?.title ?? s.code, steps: s.steps, detail: s.detail })),
    skillChanges: ctx.skillChanges.map((c) => ({
      skill: c.name,
      evidenceScore: c.score,
      masteryBefore: Math.round(c.masteryBefore * 100),
      masteryAfter: Math.round(c.masteryAfter * 100),
      level: LEVEL_LABELS[c.levelAfter],
    })),
    recurringMistakes: ctx.patterns
      .filter((p) => p.status !== 'resolved')
      .map((p) => ({ title: p.title, occurrences: p.occurrences, window: p.window, status: p.status })),
    nextRecommendation: ctx.next,
    safetyNotice: ctx.safetyNotice ?? null,
  };
}
