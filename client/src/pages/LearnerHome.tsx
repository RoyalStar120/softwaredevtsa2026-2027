import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Award, ClipboardList, PlayCircle, Radar, Repeat, History, CalendarClock, CheckCircle2, Users } from 'lucide-react';
import { PageHeader } from '../components/Layout.tsx';
import { NextPracticeHero } from '../components/adaptive.tsx';
import { AttemptList, PatternItem, achievementIcon, ModuleIcon } from '../components/domain.tsx';
import { RadarChart } from '../components/charts.tsx';
import { Card, Empty, PageLoading, Segmented, useToast, Callout, fmtDate, Badge } from '../components/ui.tsx';
import { useLoad, useSession } from '../state/session.tsx';
import { api } from '../api.ts';
import { ACHIEVEMENTS } from '../../../shared/achievements.ts';
import type { AssignmentView } from '../../../shared/api.ts';

export default function LearnerHome() {
  const { user, catalog, skill, template } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const profile = useLoad(() => api.profile(), []);
  const recs = useLoad(() => api.recommendations(), []);
  const [radarModule, setRadarModule] = useState<string>('electrical');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  if (profile.loading && !profile.data) return <PageLoading />;
  if (profile.error || !profile.data) return <div className="page"><Callout tone="danger">{profile.error}</Callout></div>;
  const p = profile.data;
  const first = user?.displayName.split(' ')[0] ?? '';

  const startAssignment = async (a: AssignmentView) => {
    setBusy(true);
    try {
      if (a.status === 'in_progress' && a.attemptId) return navigate(`/play/${a.attemptId}`);
      const { attemptId } = await api.startAttempt({ assignmentId: a.id });
      navigate(`/play/${attemptId}`);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    try {
      const { klass } = await api.joinClass(code);
      toast(`Joined ${klass.name}`, 'success');
      setCode('');
      profile.reload();
      recs.reload();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };

  const modSkills = catalog?.modules.find((m) => m.id === radarModule)?.skills ?? [];
  const views = new Map(p.skills.map((s) => [s.skillId, s]));
  const activePatterns = p.patterns.filter((x) => x.status !== 'resolved');
  const resolved = p.patterns.filter((x) => x.status === 'resolved');
  const openAssignments = (recs.data?.assignments ?? []).filter((a) => a.status !== 'completed');
  const earned = new Set(p.achievements.map((a) => a.id));

  return (
    <div className="page">
      <PageHeader
        eyebrow={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        title={`Welcome back, ${first}`}
        subtitle="SkillBridge picks your next scenario from how you performed, not just from what you got right."
      />

      {p.activeAttempt && (
        <div className="callout callout-info" style={{ marginBottom: 16, alignItems: 'center' }}>
          <PlayCircle />
          <div className="callout-body grow">
            You have a scenario in progress: <b>{p.activeAttempt.title}</b>
          </div>
          <Link className="btn btn-sm btn-primary" to={`/play/${p.activeAttempt.id}`}>
            Resume
          </Link>
        </div>
      )}

      <div className="stack-lg">
        {recs.data ? <NextPracticeHero recs={recs.data.top} /> : <div className="skeleton" style={{ height: 230 }} />}

        <div className="grid grid-4">
          {[
            { label: 'Scenarios completed', value: p.stats.completed, sub: `${p.stats.solved} solved` },
            { label: 'Average score', value: p.stats.avgScore || '-', sub: 'process + outcome' },
            { label: 'Practice time', value: `${p.stats.practiceMinutes}m`, sub: `${p.stats.activeDays} active days` },
            { label: 'Achievements', value: `${p.achievements.length}/${ACHIEVEMENTS.length}`, sub: 'milestones earned' },
          ].map((s) => (
            <div key={s.label} className="card card-pad stat">
              <span className="stat-label">{s.label}</span>
              <span className="stat-value">{s.value}</span>
              <span className="stat-sub">{s.sub}</span>
            </div>
          ))}
        </div>

        {openAssignments.length > 0 && (
          <Card title="Assigned by your instructor" icon={<ClipboardList />}>
            <div className="col gap-6">
              {openAssignments.map((a) => {
                const tpl = a.templateId ? template(a.templateId) : null;
                return (
                  <div key={a.id} className="row top gap-16" style={{ padding: '10px 0', borderTop: '1px dashed var(--border)' }}>
                    {tpl ? <ModuleIcon moduleId={tpl.moduleId} /> : <ModuleIcon moduleId={skill(a.focusSkills[0] ?? '')?.moduleId ?? 'x'} />}
                    <div className="grow">
                      <div className="row wrap gap-6">
                        <span className="bold">{a.title}</span>
                        {a.kind !== 'practice' && <Badge tone="info">{a.kind === 'baseline' ? 'Baseline assessment' : 'Transfer assessment'}</Badge>}
                        {a.status === 'in_progress' && <Badge tone="warning">In progress</Badge>}
                      </div>
                      <div className="small text-2" style={{ marginTop: 2 }}>
                        {tpl ? `${tpl.title}` : `Skill objective: ${a.focusSkills.map((s) => skill(s)?.name ?? s).join(', ')} (SkillBridge picks the scenario)`}
                        {a.dueAt ? ` · due ${fmtDate(a.dueAt)}` : ''} · {a.className}
                      </div>
                      {a.note && <div className="small muted" style={{ marginTop: 2 }}>“{a.note}”</div>}
                    </div>
                    <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => startAssignment(a)}>
                      {a.status === 'in_progress' ? 'Resume' : 'Start'}
                    </button>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        <div className="grid grid-3">
          <Card
            title="Skill snapshot"
            icon={<Radar />}
            className="span-2"
            actions={
              <Segmented
                options={(catalog?.modules ?? []).map((m) => ({ id: m.id, label: m.name.split(':')[0] }))}
                value={radarModule}
                onChange={setRadarModule}
              />
            }
          >
            <div className="grid grid-2" style={{ alignItems: 'center' }}>
              <div style={{ display: 'grid', placeItems: 'center' }}>
                <RadarChart
                  axes={modSkills.map((s) => ({ id: s.id, label: s.shortName, value: views.get(s.id)?.evidenceCount ? views.get(s.id)!.mastery : 0 }))}
                  color={radarModule === 'electrical' ? '#f59e0b' : '#7c5cff'}
                />
              </div>
              <div>
                {modSkills.map((s) => {
                  const v = views.get(s.id);
                  return (
                    <div key={s.id} className="skill-row" style={{ gridTemplateColumns: 'minmax(0,1fr) 90px auto' }}>
                      <span className="skill-name">{s.name}</span>
                      <div className="progress sm">
                        <span style={{ width: `${(v?.evidenceCount ? v.mastery : 0) * 100}%`, background: `var(--lvl-${v?.level ?? 'not_started'})` }} />
                      </div>
                      <span className="tiny muted" style={{ width: 34, textAlign: 'right' }}>
                        {v?.evidenceCount ? `${Math.round(v.mastery * 100)}%` : '-'}
                      </span>
                    </div>
                  );
                })}
                <Link to="/progress" className="small" style={{ display: 'inline-block', marginTop: 10 }}>
                  Open skill tree →
                </Link>
              </div>
            </div>
          </Card>

          <Card title="Recurring mistakes" icon={<Repeat />}>
            {activePatterns.length === 0 && resolved.length === 0 ? (
              <Empty icon={<CheckCircle2 />} title="No recurring mistakes">
                SkillBridge watches for mistakes that repeat across attempts.
              </Empty>
            ) : (
              <div className="col gap-6">
                {activePatterns.slice(0, 3).map((x) => (
                  <PatternItem key={x.moduleId + x.code} p={x} />
                ))}
                {resolved.slice(0, 2).map((x) => (
                  <PatternItem key={x.moduleId + x.code} p={x} />
                ))}
                <p className="tiny muted">Your next recommended scenarios target active patterns.</p>
              </div>
            )}
          </Card>
        </div>

        <div className="grid grid-3">
          <Card title="Recent attempts" icon={<History />} className="span-2" actions={<Link to="/progress" className="small">View all</Link>}>
            {p.recent.length ? <AttemptList attempts={p.recent.slice(0, 6)} /> : <Empty title="No attempts yet">Start your first scenario above.</Empty>}
          </Card>
          <div className="col gap-16">
            <Card title="Achievements" icon={<Award />}>
              <div className="col gap-6">
                {ACHIEVEMENTS.filter((a) => earned.has(a.id))
                  .slice(0, 4)
                  .map((a) => (
                    <div key={a.id} className="ach">
                      <span className={`ach-icon ${a.tier}`}>{achievementIcon(a.icon)}</span>
                      <div>
                        <div className="bold small">{a.title}</div>
                        <div className="tiny muted">{a.description}</div>
                      </div>
                    </div>
                  ))}
                {earned.size === 0 && <p className="small muted">Complete scenarios to earn process-based milestones.</p>}
                <Link to="/progress" className="small">
                  See all {ACHIEVEMENTS.length} milestones →
                </Link>
              </div>
            </Card>
            <Card title="My classes" icon={<Users />}>
              {p.classes.length ? (
                <div className="col gap-6">
                  {p.classes.map((c) => (
                    <div key={c.id} className="row between small">
                      <span className="bold">{c.name}</span>
                      <span className="muted">{c.instructorName}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="small muted">Not in a class yet.</p>
              )}
              <div className="row gap-6" style={{ marginTop: 12 }}>
                <input className="input" style={{ height: 32 }} placeholder="Class code" value={code} onChange={(e) => setCode(e.target.value)} />
                <button className="btn btn-sm" onClick={join} disabled={!code.trim()}>
                  <CalendarClock /> Join
                </button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
