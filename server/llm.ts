/**
 * Optional LLM providers for the AI coach (Google Gemini or OpenAI), called with plain
 * fetch. The coach works fully offline when no key is configured; every LLM failure
 * falls back to the built-in grounded coach.
 *
 * Configure in .env:
 *   GEMINI_API_KEY=...   (optional GEMINI_MODEL, default gemini-2.5-flash)
 *   OPENAI_API_KEY=...   (optional OPENAI_MODEL, default gpt-4o-mini)
 *   AI_PROVIDER=gemini|openai|offline   (optional override)
 */

import type { AiStatus } from '../shared/api.ts';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function aiStatus(): AiStatus {
  const forced = (process.env.AI_PROVIDER ?? '').toLowerCase();
  const gemini = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  if (forced === 'offline') return { provider: 'offline', model: null };
  if ((forced === 'gemini' || !forced) && gemini) return { provider: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' };
  if ((forced === 'openai' || !forced) && openai) return { provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-4o-mini' };
  if (gemini) return { provider: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' };
  return { provider: 'offline', model: null };
}

export async function llmChat(system: string, messages: ChatMessage[], opts: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
  const status = aiStatus();
  const signal = AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 25000));
  const temperature = opts.temperature ?? 0.4;
  const maxTokens = opts.maxTokens ?? 900;

  if (status.provider === 'gemini') {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(status.model!)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as any;
    const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim();
    if (!text) throw new Error('Gemini returned an empty response');
    return text;
  }

  if (status.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: status.model,
        temperature,
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
      signal,
    });
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as any;
    const text = String(data?.choices?.[0]?.message?.content ?? '').trim();
    if (!text) throw new Error('OpenAI returned an empty response');
    return text;
  }

  throw new Error('No LLM provider configured');
}
