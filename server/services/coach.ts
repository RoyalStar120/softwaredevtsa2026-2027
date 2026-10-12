/**
 * AI coaching service. The deterministic engine supplies the facts; the coach explains them.
 * Uses Gemini/OpenAI when configured, otherwise (or on any failure) the offline coach.
 */

import type { Evaluation, ScenarioInstance } from '../../shared/types.ts';
import type { CoachMessage, SkillChange } from '../../shared/api.ts';
import type { MistakePattern } from '../../shared/patterns.ts';
import type { Recommendation } from '../../shared/adaptive.ts';
import { buildLlmContext, debriefToMarkdown, offlineAnswer, offlineDebrief, type CoachContext, type CoachDebrief } from '../../shared/coach.ts';
import { ALL_MISTAKES, ALL_SKILLS, ALL_STRENGTHS, getModule } from '../../shared/modules/index.ts';
import { json, newId, q } from '../db.ts';
import { aiStatus, llmChat, type ChatMessage } from '../llm.ts';
import { getUser } from '../auth.ts';
import { loadLog, type AttemptRow } from './learner.ts';

const SKILL_NAMES = Object.fromEntries(ALL_SKILLS.map((s) => [s.id, s.name]));

export function buildCoachContext(
  row: AttemptRow,
  data: {
    evaluation: Evaluation;
    skillChanges: SkillChange[];
    patterns: MistakePattern[];
    next: Recommendation[];
  },
): CoachContext {
  const module = getModule(row.module_id);
  const instance = json<ScenarioInstance>(row.instance, null as unknown as ScenarioInstance);
  const log = loadLog(row.id);
  const tl = new Map(data.evaluation.timeline.map((t) => [t.seq, t]));
  const learner = getUser(row.user_id);
  const next = data.next[0];
  return {
    learnerName: learner?.display_name ?? 'Learner',
    moduleId: module.id,
    moduleName: module.name,
    scenario: {
      title: instance.title,
      briefing: instance.briefing,
      goal: instance.goal,
      objectives: instance.objectives,
      difficulty: instance.difficulty,
    },
    evaluation: data.evaluation,
    steps: log.map((e) => ({
      seq: e.seq,
      description: module.describeAction(e),
      verdict: tl.get(e.seq)?.verdict ?? null,
      note: tl.get(e.seq)?.note || null,
    })),
    skillChanges: data.skillChanges.map((c) => ({
      skillId: c.skillId,
      name: c.name,
      weight: c.weight,
      score: c.score,
      masteryBefore: c.masteryBefore,
      masteryAfter: c.masteryAfter,
      levelBefore: c.levelBefore,
      levelAfter: c.levelAfter,
    })),
    patterns: data.patterns.filter((p) => p.moduleId === module.id),
    mistakeDefs: ALL_MISTAKES,
    strengthDefs: ALL_STRENGTHS,
    skillNames: SKILL_NAMES,
    knowledge: module.knowledge,
    next: next ? { title: next.title, difficulty: next.difficulty, reasons: next.reasons.map((r) => r.text) } : null,
    safetyNotice: module.safetyNotice,
  };
}

export function contextForCompleted(row: AttemptRow): CoachContext {
  return buildCoachContext(row, {
    evaluation: json<Evaluation>(row.evaluation, null as unknown as Evaluation),
    skillChanges: json<SkillChange[]>(row.skill_changes, []),
    patterns: json<MistakePattern[]>(row.patterns, []),
    next: json<Recommendation[]>(row.next, []),
  });
}

function systemPrompt(ctx: CoachContext, mode: 'debrief' | 'chat'): string {
  const lines = [
    `You are the SkillBridge Coach, a supportive expert instructor for ${ctx.moduleName}. You explain a learner's performance in a practice simulation.`,
    'Rules:',
    '- Use ONLY facts from the CONTEXT JSON. It comes from a deterministic simulation engine and rule-based evaluator. Never invent readings, code behavior, faults, steps, scores or rules.',
    '- Refer to specific actions as "step N" using the step numbers in CONTEXT.',
    '- Be specific, warm and direct. Address the learner by first name.',
    '- Explain WHY ineffective decisions were ineffective and what an effective practitioner does instead.',
    '- Clearly distinguish reaching the right answer from using an effective process.',
    '- Markdown allowed: **bold**, short paragraphs, bullet lists. No headings, tables or HTML.',
  ];
  if (ctx.safetyNotice) lines.push('- When safety comes up, remind the learner that this is simulated practice, not certification or professional instruction.');
  if (mode === 'debrief') {
    lines.push('- Keep the debrief under 200 words.');
  } else {
    lines.push(
      '- Answer the follow-up question in under 150 words.',
      "- If the answer is not in CONTEXT, say you can only speak to what happened in this scenario and suggest a related question you CAN answer.",
      '- Do not write the solution to other scenarios. Explanations of concepts are fine.',
    );
  }
  return lines.join('\n');
}

function contextBlock(ctx: CoachContext): string {
  return `CONTEXT:\n\`\`\`json\n${JSON.stringify(buildLlmContext(ctx))}\n\`\`\``;
}

export interface StoredCoach {
  debrief: CoachDebrief;
  narrative: string | null;
  provider: string;
}

export function offlineCoach(ctx: CoachContext): StoredCoach {
  return { debrief: offlineDebrief(ctx), narrative: null, provider: 'offline' };
}

/** Generates (once) an LLM-written narrative debrief. Falls back silently to offline. */
export async function ensureNarrative(row: AttemptRow): Promise<StoredCoach> {
  const stored = json<StoredCoach | null>(row.coach, null) ?? offlineCoach(contextForCompleted(row));
  if (stored.narrative) return stored;
  const status = aiStatus();
  if (status.provider === 'offline') return stored;
  const ctx = contextForCompleted(row);
  try {
    const text = await llmChat(systemPrompt(ctx, 'debrief'), [
      {
        role: 'user',
        content: `${contextBlock(ctx)}\n\nWrite the post-scenario debrief: (1) a one-sentence verdict on outcome vs. process, (2) what went well, (3) the single most important thing to improve, and why, (4) what to practice next.`,
      },
    ]);
    const updated: StoredCoach = { ...stored, narrative: text, provider: status.provider };
    q.run('UPDATE attempts SET coach = ? WHERE id = ?', JSON.stringify(updated), row.id);
    return updated;
  } catch (e) {
    console.warn('[coach] LLM narrative failed, using offline coach:', (e as Error).message);
    return stored;
  }
}

export function listMessages(attemptId: string): CoachMessage[] {
  return q
    .all<any>('SELECT * FROM coach_messages WHERE attempt_id = ? ORDER BY t, rowid', attemptId)
    .map((r) => ({ id: r.id, role: r.role, content: r.content, provider: r.provider, t: r.t }));
}

export async function askCoach(row: AttemptRow, question: string): Promise<{ messages: CoachMessage[]; provider: string }> {
  const clean = question.trim().slice(0, 600);
  const now = Date.now();
  q.run('INSERT INTO coach_messages (id, attempt_id, role, content, provider, t) VALUES (?, ?, ?, ?, ?, ?)', newId('m_'), row.id, 'learner', clean, 'learner', now);
  const ctx = contextForCompleted(row);
  const status = aiStatus();
  let answer: string;
  let provider: string = 'offline';
  if (status.provider !== 'offline') {
    try {
      const history = listMessages(row.id).slice(-9, -1);
      const msgs: ChatMessage[] = [
        { role: 'user', content: `${contextBlock(ctx)}\n\nThe learner will ask follow-up questions about this scenario.` },
        { role: 'assistant', content: 'Understood. I will answer only from this context.' },
        ...history.map((m) => ({ role: m.role === 'learner' ? ('user' as const) : ('assistant' as const), content: m.content })),
        { role: 'user', content: clean },
      ];
      answer = await llmChat(systemPrompt(ctx, 'chat'), msgs, { maxTokens: 600 });
      provider = status.provider;
    } catch (e) {
      console.warn('[coach] LLM answer failed, using offline coach:', (e as Error).message);
      answer = offlineAnswer(ctx, clean);
    }
  } else {
    answer = offlineAnswer(ctx, clean);
  }
  q.run('INSERT INTO coach_messages (id, attempt_id, role, content, provider, t) VALUES (?, ?, ?, ?, ?, ?)', newId('m_'), row.id, 'coach', answer, provider, Date.now());
  return { messages: listMessages(row.id), provider };
}

export { debriefToMarkdown };
