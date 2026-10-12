import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  ListChecks,
  Route as RouteIcon,
  Send,
  Sparkles,
  TrendingUp,
  Trophy,
  AlertTriangle,
  Repeat,
  User,
  Crosshair,
} from 'lucide-react';
import type { DebriefResponse, CoachMessage } from '../../../shared/api.ts';
import type { Verdict } from '../../../shared/types.ts';
import { ACHIEVEMENT_BY_ID } from '../../../shared/achievements.ts';
import { api } from '../api.ts';
import { clientModule } from '../modules/index.ts';
import { ModuleIcon, PatternItem, achievementIcon } from '../components/domain.tsx';
import { ReasonIcon } from '../components/adaptive.tsx';
import {
  Badge,
  Callout,
  Card,
  Difficulty,
  LevelBadge,
  Markdown,
  PageLoading,
  Ring,
  Segmented,
  Spinner,
  VerdictIcon,
  VERDICT_LABEL,
  cx,
  fmtDuration,
  scoreColor,
  useToast,
} from '../components/ui.tsx';
import { useSession } from '../state/session.tsx';

const VERDICT_COLOR: Record<Verdict, string> = {
  good: 'var(--v-good)',
  neutral: 'var(--v-neutral)',
  info: 'var(--v-info)',
  wasted: 'var(--v-wasted)',
  mistake: 'var(--v-mistake)',
  unsafe: 'var(--v-unsafe)',
};

function mmss(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function Debrief() {
  const { id = '' } = useParams();
  const [data, setData] = useState<DebriefResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'issues' | 'good'>('all');
  const { user, catalog, skill, mistakeTitle } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [starting, setStarting] = useState(false);
  const stepRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    api
      .debrief(id)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const goStep = (seq: number) => {
    setFilter('all');
    setHighlight(seq);
    setTimeout(() => stepRefs.current.get(seq)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  if (error) return <div className="page"><Callout tone="danger">{error}</Callout></div>;
  if (!data) return <PageLoading label="Loading your debrief…" />;
  const ev = data.evaluation;
  const isOwner = user?.id === data.learner.id;
  const cm = clientModule(data.scenario.moduleId);
  const Extras = cm?.DebriefExtras;
  const next = data.next[0];

  const startNext = async () => {
    if (!next) return;
    setStarting(true);
    try {
      const { attemptId } = await api.startAttempt({ templateId: next.templateId, difficulty: next.difficulty, focusSkills: next.focusSkills, source: 'recommended' });
      navigate(`/play/${attemptId}`);
    } catch (e) {
      toast((e as Error).message, 'danger');
      setStarting(false);
    }
  };

  const outcomeTone = ev.solved ? 'success' : 'danger';
  const procTone = ev.processVerdict.tone;
  const filtered = data.log.filter((e) =>
    filter === 'all' ? true : filter === 'good' ? e.verdict === 'good' : e.verdict === 'mistake' || e.verdict === 'unsafe' || e.verdict === 'wasted',
  );
  const counts = data.log.reduce<Record<string, number>>((acc, e) => {
    const v = e.verdict ?? 'neutral';
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="page wide">
      {!isOwner && (
        <div className="callout callout-info" style={{ marginBottom: 14 }}>
          <Eye />
          <div className="callout-body">
            You're viewing <b>{data.learner.displayName}</b>'s attempt (instructor view).
          </div>
        </div>
      )}

      <div className="stack-lg">
        {/* ---------- Verdict ---------- */}
        <section className="card verdict-hero fade-in">
          <Ring value={ev.overall / 100} size={112} stroke={10} color={scoreColor(ev.overall / 100)} label={ev.overall} sub="overall" />
          <div className="col gap-10" style={{ gap: 10, minWidth: 0 }}>
            <div className="row gap-6 small muted wrap">
              <ModuleIcon moduleId={data.scenario.moduleId} size={26} />
              <span className="bold" style={{ color: 'var(--text)' }}>
                {data.scenario.title}
              </span>
              <Difficulty value={data.scenario.difficulty} />
              <span>· {fmtDuration(ev.durationSec)}</span>
              <span>· {ev.actionCount} actions</span>
              {ev.hintsUsed > 0 && <span>· {ev.hintsUsed} hint level(s)</span>}
              {data.attempt.mode === 'assessment' && <Badge tone="info">Assessment</Badge>}
            </div>
            <h2 style={{ fontSize: '1.3rem' }}>{data.coach.debrief.headline || ev.outcomeLabel}</h2>
            <div className="dual-verdict">
              <div className={cx('box', outcomeTone)}>
                <div className="eyebrow">Outcome · did you get it right?</div>
                <div className="bold row gap-6">
                  {ev.solved ? <CheckCircle2 width={16} height={16} /> : <AlertTriangle width={16} height={16} />}
                  {ev.outcomeLabel}
                </div>
              </div>
              <div className={cx('box', procTone)}>
                <div className="eyebrow">Process · how did you get there?</div>
                <div className="bold">{ev.processVerdict.label}</div>
                <div className="small text-2">{ev.processVerdict.explanation}</div>
              </div>
            </div>
          </div>
          <div className="row gap-16" style={{ justifyContent: 'center' }}>
            {[
              { k: 'Accuracy', v: ev.accuracy },
              { k: 'Process', v: ev.process },
              { k: 'Efficiency', v: ev.efficiency },
              ...(ev.safety !== null ? [{ k: 'Safety', v: ev.safety }] : []),
            ].map((x) => (
              <div key={x.k} className="col" style={{ alignItems: 'center', gap: 4 }}>
                <Ring value={x.v} size={60} stroke={6} color={scoreColor(x.v)} />
                <span className="tiny bold muted">{x.k}</span>
              </div>
            ))}
          </div>
        </section>

        {data.newAchievements.length > 0 && (
          <div className="row wrap gap-10" style={{ gap: 10 }}>
            {data.newAchievements.map((aid) => {
              const a = ACHIEVEMENT_BY_ID.get(aid);
              if (!a) return null;
              return (
                <div key={aid} className="ach new-ach">
                  <span className={`ach-icon ${a.tier}`}>{achievementIcon(a.icon)}</span>
                  <div>
                    <div className="tiny muted bold row gap-4">
                      <Trophy width={12} height={12} /> Achievement unlocked
                    </div>
                    <div className="bold small">{a.title}</div>
                    <div className="tiny muted">{a.description}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="grid grid-3">
          {/* ---------- Coach ---------- */}
          <div className="span-2 col gap-16">
            <CoachPanel data={data} onStep={goStep} canChat={data.canChat} aiProvider={catalog?.ai.provider ?? 'offline'} />
          </div>

          {/* ---------- Next + skills ---------- */}
          <div className="col gap-16">
            {next && isOwner && (
              <section className="hero-next" style={{ padding: 18 }}>
                <div className="eyebrow">Practice a targeted weakness</div>
                <div className="row gap-10" style={{ gap: 10, marginTop: 8 }}>
                  <ModuleIcon moduleId={next.moduleId} size={34} />
                  <div>
                    <h3>{next.title}</h3>
                    <div className="tiny" style={{ opacity: 0.85 }}>
                      Difficulty {next.difficulty}/5 · ~{Math.round(next.expectedSuccess * 100)}% expected success
                    </div>
                  </div>
                </div>
                <div className="col gap-6" style={{ marginTop: 12 }}>
                  {next.reasons.slice(0, 3).map((r, i) => (
                    <div key={i} className="reason">
                      <ReasonIcon kind={r.kind} />
                      <span>{r.text}</span>
                    </div>
                  ))}
                </div>
                {next.focusSkills.length > 0 && (
                  <div className="row wrap gap-6" style={{ marginTop: 10 }}>
                    <Crosshair width={14} height={14} />
                    {next.focusSkills.map((s) => (
                      <span key={s} className="meta-pill">
                        {skill(s)?.name ?? s}
                      </span>
                    ))}
                  </div>
                )}
                <button className="btn btn-light btn-block" style={{ marginTop: 14 }} disabled={starting} onClick={startNext}>
                  Start next scenario <ArrowRight />
                </button>
              </section>
            )}

            <Card title="Skill updates" icon={<TrendingUp />}>
              {data.skillChanges.length === 0 && <p className="small muted">No skill evidence from this attempt.</p>}
              {data.skillChanges
                .slice()
                .sort((a, b) => b.weight - a.weight)
                .map((c) => {
                  const d = Math.round((c.masteryAfter - c.masteryBefore) * 100);
                  return (
                    <div key={c.skillId} className="skill-delta" title={c.reasons.join(' · ')}>
                      <div style={{ minWidth: 0 }}>
                        <div className="bold small">{c.name}</div>
                        <div className="tiny muted">
                          {Math.round(c.score * 100)}% this attempt · weight {Math.round(c.weight * 100)}%
                        </div>
                      </div>
                      <div>
                        <div className="progress sm" style={{ position: 'relative' }}>
                          <span style={{ width: `${c.masteryAfter * 100}%`, background: `var(--lvl-${c.levelAfter})` }} />
                        </div>
                        <div className="tiny muted" style={{ marginTop: 3 }}>
                          {Math.round(c.masteryBefore * 100)}% → {Math.round(c.masteryAfter * 100)}%
                          {c.levelAfter !== c.levelBefore && (
                            <>
                              {' '}
                              · <LevelBadge level={c.levelAfter} />
                            </>
                          )}
                        </div>
                      </div>
                      <span className={d >= 0 ? 'delta-up' : 'delta-down'} style={{ textAlign: 'right' }}>
                        {d >= 0 ? '+' : ''}
                        {d}
                      </span>
                    </div>
                  );
                })}
            </Card>

            {data.patterns.filter((p) => p.moduleId === data.scenario.moduleId).length > 0 && (
              <Card title="Patterns across attempts" icon={<Repeat />}>
                <div className="col gap-6">
                  {data.patterns
                    .filter((p) => p.moduleId === data.scenario.moduleId)
                    .slice(0, 4)
                    .map((p) => (
                      <PatternItem key={p.code} p={p} />
                    ))}
                </div>
              </Card>
            )}
          </div>
        </div>

        {/* ---------- Mistakes & strengths ---------- */}
        <div className="grid grid-2">
          <Card title={`Where you struggled (${ev.mistakes.length})`} icon={<AlertTriangle />}>
            {ev.mistakes.length === 0 ? (
              <p className="small muted">No mistakes detected. Nicely done.</p>
            ) : (
              <div className="col gap-10" style={{ gap: 10 }}>
                {data.coach.debrief.struggles.map((s) => (
                  <div key={s.code} className={cx('mistake-card', s.severity)}>
                    <div className="row between gap-6">
                      <span className="bold">{s.title}</span>
                      <Badge tone={s.severity === 'critical' ? 'danger' : s.severity === 'major' ? 'warning' : 'neutral'}>{s.severity}</Badge>
                    </div>
                    <div className="small" style={{ marginTop: 4 }}>
                      {ev.mistakes.find((m) => m.code === s.code)?.detail}
                    </div>
                    <div className="row wrap gap-4" style={{ marginTop: 6 }}>
                      {(ev.mistakes.find((m) => m.code === s.code)?.steps ?? []).map((n) => (
                        <button key={n} className="step-ref" onClick={() => goStep(n)}>
                          step {n}
                        </button>
                      ))}
                    </div>
                    <div className="small text-2" style={{ marginTop: 8 }}>
                      <b>Why it matters:</b> {s.why}
                    </div>
                    <div className="small" style={{ marginTop: 4 }}>
                      <b>Instead:</b> {s.instead}
                    </div>
                    {s.repeatNote && (
                      <div className="small row top gap-6" style={{ marginTop: 6, color: 'var(--danger)' }}>
                        <Repeat width={14} height={14} style={{ flex: 'none', marginTop: 2 }} />
                        {s.repeatNote}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title={`What went well (${ev.strengths.length})`} icon={<CheckCircle2 />}>
            {ev.strengths.length === 0 ? (
              <p className="small muted">No standout strengths this time. The coach's suggestions show what to aim for.</p>
            ) : (
              <div className="col gap-10" style={{ gap: 10 }}>
                {ev.strengths.map((s) => {
                  const mod = catalog?.modules.find((m) => m.id === data.scenario.moduleId);
                  const def = mod?.strengths[s.code];
                  return (
                    <div key={s.code} className="strength-card">
                      <div className="bold">{def?.title ?? s.code}</div>
                      <div className="small" style={{ marginTop: 4 }}>
                        {s.detail}
                      </div>
                      {def && <div className="small text-2" style={{ marginTop: 4 }}>{def.why}</div>}
                      <div className="row wrap gap-4" style={{ marginTop: 6 }}>
                        {s.steps.map((n) => (
                          <button key={n} className="step-ref" onClick={() => goStep(n)}>
                            step {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* ---------- Action replay + expert ---------- */}
        <div className="grid grid-3">
          <Card
            title="Action replay"
            icon={<ListChecks />}
            className="span-2"
            actions={
              <Segmented
                options={[
                  { id: 'all', label: `All (${data.log.length})` },
                  { id: 'issues', label: `Issues (${(counts.mistake ?? 0) + (counts.unsafe ?? 0) + (counts.wasted ?? 0)})` },
                  { id: 'good', label: `Effective (${counts.good ?? 0})` },
                ]}
                value={filter}
                onChange={setFilter}
              />
            }
          >
            <div className="timeline-strip" style={{ marginBottom: 12 }} aria-label="Verdict per step">
              {data.log.map((e) => (
                <span
                  key={e.seq}
                  title={`Step ${e.seq}: ${VERDICT_LABEL[e.verdict ?? 'neutral']}`}
                  style={{ background: VERDICT_COLOR[e.verdict ?? 'neutral'], outline: highlight === e.seq ? '2px solid var(--text)' : undefined }}
                  onClick={() => goStep(e.seq)}
                />
              ))}
            </div>
            <div className="row wrap gap-10 tiny muted" style={{ marginBottom: 8, gap: 10 }}>
              {(Object.keys(VERDICT_LABEL) as Verdict[]).map((v) => (
                <span key={v} className="row gap-4">
                  <span className="dot" style={{ background: VERDICT_COLOR[v] }} /> {VERDICT_LABEL[v]}
                </span>
              ))}
            </div>
            <div className="timeline" style={{ maxHeight: 560, overflowY: 'auto' }}>
              {filtered.map((e) => (
                <div
                  key={e.seq}
                  ref={(el) => {
                    if (el) stepRefs.current.set(e.seq, el);
                  }}
                  className={cx('tl-item', highlight === e.seq && 'highlight')}
                >
                  <VerdictIcon verdict={e.verdict} />
                  <span className="seq">
                    #{e.seq}
                    <br />
                    {mmss(e.t)}
                  </span>
                  <div>
                    <div className="desc">{e.description}</div>
                    {e.note && <div className="note">{e.note}</div>}
                    {e.message && <div className="note" style={{ color: e.messageTone === 'danger' ? 'var(--danger)' : undefined }}>{e.message}</div>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <div className="col gap-16">
            <Card title="You vs. the expert path" icon={<RouteIcon />}>
              <table className="table">
                <tbody>
                  {ev.metrics.map((m) => (
                    <tr key={m.key}>
                      <td className="small">{m.label}</td>
                      <td className="bold right nowrap">
                        {m.value}
                        {m.unit ? ` ${m.unit}` : ''}
                      </td>
                      <td className="small muted right nowrap">{m.benchmark !== undefined ? `${m.benchmarkLabel ?? 'target'}: ${m.benchmark}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ev.expertPath && (
                <div style={{ marginTop: 14 }}>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>
                    {ev.expertPath.summary}
                  </div>
                  <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
                    {ev.expertPath.steps.map((s, i) => (
                      <li key={i} style={{ margin: '4px 0' }}>
                        {s}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </Card>
            <Card title="What was really wrong" icon={<ClipboardCheck />}>
              <div className="bold">{ev.groundTruth.summary}</div>
              <ul className="small text-2" style={{ paddingLeft: 18, margin: '6px 0 0' }}>
                {ev.groundTruth.details.map((d, i) => (
                  <li key={i} style={{ margin: '4px 0' }}>
                    {d}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>

        {Extras && data.reveal !== null && (
          <Card title="Scenario reveal" icon={<Eye />}>
            <Extras scenario={data.scenario} evaluation={ev} log={data.log} reveal={data.reveal} />
          </Card>
        )}

        <div className="row between wrap">
          <Link to={isOwner ? '/home' : `/instructor/students/${data.learner.id}`} className="btn">
            {isOwner ? 'Back to home' : `Back to ${data.learner.displayName}`}
          </Link>
          {isOwner && next && (
            <button className="btn btn-primary" onClick={startNext} disabled={starting}>
              Practice a targeted weakness <ArrowRight />
            </button>
          )}
        </div>
        <p className="tiny muted center">
          Scores and verdicts come from SkillBridge's deterministic evaluation rules. The AI coach only explains them. Mistake codes: {ev.mistakes.map((m) => mistakeTitle(m.code)).join(', ') || 'none'}.
        </p>
      </div>
    </div>
  );
}

function CoachPanel({ data, onStep, canChat, aiProvider }: { data: DebriefResponse; onStep: (n: number) => void; canChat: boolean; aiProvider: string }) {
  const [narrative, setNarrative] = useState<string | null>(data.coach.narrative);
  const [provider, setProvider] = useState<string>(data.coach.provider);
  const [loadingNarr, setLoadingNarr] = useState(false);
  const [showDetail, setShowDetail] = useState(!data.coach.narrative);
  const [messages, setMessages] = useState<CoachMessage[]>(data.messages);
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const d = data.coach.debrief;

  useEffect(() => {
    if (!narrative && aiProvider !== 'offline') {
      setLoadingNarr(true);
      api
        .narrative(data.attempt.id)
        .then((r) => {
          if (r.narrative) {
            setNarrative(r.narrative);
            setProvider(r.provider);
            setShowDetail(false);
          }
        })
        .catch(() => {})
        .finally(() => setLoadingNarr(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length]);

  const suggestions = useMemo(() => {
    const out: string[] = [];
    const firstMistakeStep = data.evaluation.mistakes.find((m) => m.steps.length)?.steps[0];
    if (firstMistakeStep) out.push(`Why was step ${firstMistakeStep} a problem?`);
    out.push('What should I have done instead?');
    out.push(data.scenario.moduleId === 'electrical' ? 'What was the actual fault?' : 'What was the actual bug?');
    out.push('How can I improve?');
    out.push('Why did I get this score?');
    return out;
  }, [data]);

  const ask = async (question: string) => {
    if (!question.trim()) return;
    setAsking(true);
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'learner', content: question, provider: 'learner', t: Date.now() }]);
    setQ('');
    try {
      const r = await api.ask(data.attempt.id, question);
      setMessages(r.messages);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setAsking(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(q);
  };

  const providerLabel = provider === 'gemini' ? 'Gemini' : provider === 'openai' ? 'OpenAI' : 'Built-in coach';

  return (
    <Card
      title="AI coach"
      icon={<Bot />}
      actions={
        <span className="badge badge-primary" title="The coach explains engine output; it never decides scores">
          <Sparkles /> {providerLabel} · grounded in your actions
        </span>
      }
    >
      <div className="coach">
        {loadingNarr && (
          <div className="coach-msg">
            <span className="coach-avatar">
              <Bot />
            </span>
            <div className="coach-bubble row gap-6">
              <Spinner size={14} /> Your coach is reviewing your action log…
            </div>
          </div>
        )}
        {narrative && (
          <div className="coach-msg">
            <span className="coach-avatar">
              <Bot />
            </span>
            <div className="coach-bubble">
              <Markdown text={narrative} />
            </div>
          </div>
        )}
        {narrative && (
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowDetail((v) => !v)}>
            {showDetail ? 'Hide' : 'Show'} the structured breakdown
          </button>
        )}
        {showDetail && (
          <div className="coach-msg">
            <span className="coach-avatar">
              <Bot />
            </span>
            <div className="coach-bubble" style={{ width: '100%' }}>
              <p>{d.summary}</p>
              {d.wentWell.length > 0 && (
                <>
                  <div className="bold" style={{ marginTop: 10 }}>
                    What went well
                  </div>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {d.wentWell.map((w, i) => (
                      <li key={i}>
                        <b>{w.title}:</b> {w.detail}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {d.struggles.length > 0 && (
                <>
                  <div className="bold" style={{ marginTop: 10 }}>
                    Where you struggled
                  </div>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {d.struggles.map((s) => (
                      <li key={s.code} style={{ marginTop: 4 }}>
                        <b>{s.title}.</b> {s.why} <i>Instead:</i> {s.instead}{' '}
                        {(data.evaluation.mistakes.find((m) => m.code === s.code)?.steps ?? []).slice(0, 4).map((n) => (
                          <button key={n} className="step-ref" style={{ marginLeft: 3 }} onClick={() => onStep(n)}>
                            step {n}
                          </button>
                        ))}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {d.focusNext.length > 0 && (
                <>
                  <div className="bold" style={{ marginTop: 10 }}>
                    Focus next
                  </div>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {d.focusNext.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </>
              )}
              <p style={{ marginTop: 10 }}>{d.closing}</p>
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={cx('coach-msg', m.role === 'learner' && 'learner')}>
            <span className="coach-avatar" style={m.role === 'learner' ? { background: 'var(--surface-3)', color: 'var(--text-2)' } : undefined}>
              {m.role === 'learner' ? <User /> : <Bot />}
            </span>
            <div className="coach-bubble">
              <Markdown text={m.content} />
            </div>
          </div>
        ))}
        {asking && (
          <div className="coach-msg">
            <span className="coach-avatar">
              <Bot />
            </span>
            <div className="coach-bubble row gap-6">
              <Spinner size={14} /> Thinking…
            </div>
          </div>
        )}
        <div ref={endRef} />

        {canChat ? (
          <>
            <div className="suggestions">
              {suggestions.map((s) => (
                <button key={s} onClick={() => ask(s)} disabled={asking}>
                  {s}
                </button>
              ))}
            </div>
            <form className="row gap-6" onSubmit={onSubmit}>
              <input className="input" placeholder="Ask your coach about this attempt…" value={q} onChange={(e) => setQ(e.target.value)} maxLength={600} />
              <button className="btn btn-primary" disabled={asking || !q.trim()} type="submit" aria-label="Send">
                <Send />
              </button>
            </form>
          </>
        ) : (
          <p className="tiny muted">Only the learner can chat with the coach about this attempt.</p>
        )}
      </div>
    </Card>
  );
}
