import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Award, GitBranch, History, LineChart as LineIcon, TrendingDown, Target } from 'lucide-react';
import type { ProfileResponse, ProgressResponse } from '../../../shared/api.ts';
import { ACHIEVEMENTS } from '../../../shared/achievements.ts';
import { PageHeader } from '../components/Layout.tsx';
import { SkillTree } from '../components/adaptive.tsx';
import { LineChart, Sparkline } from '../components/charts.tsx';
import { AttemptList, ModuleIcon, achievementIcon } from '../components/domain.tsx';
import { Callout, Card, Empty, LevelBadge, PageLoading, Segmented, Tabs, fmtAgo, fmtDate, useToast } from '../components/ui.tsx';
import { useLoad, useSession } from '../state/session.tsx';
import { api } from '../api.ts';

const PALETTE = ['#4f46e5', '#0ea5a4', '#f59e0b', '#ef4444', '#8b5cf6', '#22c55e', '#ec4899'];

export default function Progress() {
  const data = useLoad(() => Promise.all([api.profile(), api.progress()]), []);
  if (data.loading && !data.data) return <PageLoading />;
  if (data.error || !data.data) return <div className="page"><Callout tone="danger">{data.error}</Callout></div>;
  const [profile, progress] = data.data;
  return (
    <div className="page">
      <PageHeader title="My progress" subtitle="Mastery is earned through repeated strong performance across different scenarios, never a single lucky success." />
      <ProgressView profile={profile} progress={progress} canPractice />
    </div>
  );
}

export function ProgressView({ profile, progress, canPractice, linkPrefix = '/debrief/' }: { profile: ProfileResponse; progress: ProgressResponse; canPractice?: boolean; linkPrefix?: string }) {
  const { catalog, skill } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState(catalog?.modules[0]?.id ?? 'programming');
  const [selected, setSelected] = useState<string | null>(null);
  const [trendModule, setTrendModule] = useState<string>('all');
  const [busy, setBusy] = useState(false);
  if (!catalog) return null;
  const mod = catalog.modules.find((m) => m.id === tab)!;
  const views = Object.fromEntries(profile.skills.map((s) => [s.skillId, s]));
  const sel = selected && views[selected] && skill(selected)?.moduleId === tab ? selected : mod.skills[0]?.id;
  const selView = sel ? views[sel] : null;
  const selDef = sel ? skill(sel) : null;
  const history = sel ? progress.skillHistory[sel] ?? [] : [];

  const practiceSkill = async (skillId: string) => {
    setBusy(true);
    try {
      const { attemptId } = await api.startAttempt({ focusSkills: [skillId], source: 'skill_focus' });
      navigate(`/play/${attemptId}`);
    } catch (e) {
      toast((e as Error).message, 'danger');
      setBusy(false);
    }
  };

  const trend = progress.mistakeTrend.filter((p) => trendModule === 'all' || p.moduleId === trendModule);
  const earned = new Map(profile.achievements.map((a) => [a.id, a]));

  return (
    <div className="stack-lg">
      <Card title="Skill tree" icon={<GitBranch />} actions={<Tabs tabs={catalog.modules.map((m) => ({ id: m.id, label: m.name.split(':')[0], icon: <ModuleIcon moduleId={m.id} size={20} /> }))} value={tab} onChange={(t) => { setTab(t); setSelected(null); }} />}>
        <div className="grid grid-3" style={{ alignItems: 'start' }}>
          <div className="span-2">
            <SkillTree skills={mod.skills} views={views} selected={sel} onSelect={setSelected} />
            <div className="row wrap gap-10 tiny muted" style={{ marginTop: 8, gap: 12 }}>
              {(['novice', 'developing', 'proficient', 'mastered'] as const).map((l) => (
                <span key={l} className="row gap-4">
                  <span className="dot" style={{ background: `var(--lvl-${l})` }} /> {l[0].toUpperCase() + l.slice(1)}
                </span>
              ))}
              <span>· Solid lines = prerequisite met</span>
            </div>
          </div>
          {selView && selDef && (
            <div className="card card-pad" style={{ background: 'var(--surface-2)' }}>
              <div className="row between top">
                <div>
                  <div className="eyebrow">{selDef.kind}</div>
                  <h3 style={{ marginTop: 2 }}>{selDef.name}</h3>
                </div>
                <LevelBadge level={selView.level} />
              </div>
              <p className="small text-2" style={{ marginTop: 6 }}>
                {selDef.description}
              </p>
              <div className="row gap-16" style={{ marginTop: 12 }}>
                <div className="stat">
                  <span className="stat-value">{selView.evidenceCount ? `${Math.round(selView.mastery * 100)}%` : '-'}</span>
                  <span className="stat-label">mastery estimate</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{selView.evidenceCount}</span>
                  <span className="stat-label">times practiced</span>
                </div>
              </div>
              <div className="small" style={{ marginTop: 10 }}>
                {selView.note}
              </div>
              <div className="row gap-6 small muted" style={{ marginTop: 8 }}>
                Recent scores: <Sparkline values={selView.recentScores.map((x) => x * 100)} width={90} height={24} />
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                Last practiced {fmtAgo(selView.lastPracticedAt)}
                {selView.reviewDue ? ' · due for reinforcement' : ''}
              </div>
              {selDef.prerequisites.length > 0 && (
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  Builds on: {selDef.prerequisites.map((p) => skill(p)?.name ?? p).join(', ')}
                </div>
              )}
              {history.length > 1 && (
                <div style={{ marginTop: 10 }}>
                  <LineChart
                    height={150}
                    yMin={0}
                    yMax={100}
                    series={[{ id: sel!, label: 'Mastery', color: '#4f46e5', points: history.map((h, i) => ({ x: i + 1, y: Math.round(h.mastery * 100), label: `${Math.round(h.mastery * 100)}% (${fmtDate(h.t)})` })) }]}
                    xFormat={(v) => `#${Math.round(v)}`}
                    yFormat={(v) => `${Math.round(v)}%`}
                    bands={[{ from: 85, to: 100, color: '#5b6cff' }]}
                  />
                </div>
              )}
              {canPractice && (
                <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} disabled={busy} onClick={() => practiceSkill(sel!)}>
                  <Target /> Practice this skill
                </button>
              )}
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="Mastery over time" icon={<LineIcon />}>
          <LineChart
            height={230}
            yMin={0}
            yMax={100}
            emptyText="Complete scenarios to see mastery grow."
            series={mod.skills
              .filter((s) => (progress.skillHistory[s.id] ?? []).length > 0)
              .map((s, i) => ({
                id: s.id,
                label: s.shortName,
                color: PALETTE[i % PALETTE.length],
                points: (progress.skillHistory[s.id] ?? []).map((h) => ({ x: h.t, y: Math.round(h.mastery * 100), label: `${Math.round(h.mastery * 100)}% on ${fmtDate(h.t)}` })),
              }))}
            xFormat={(v) => fmtDate(v)}
            yFormat={(v) => `${Math.round(v)}%`}
          />
        </Card>
        <Card
          title="Error reduction"
          icon={<TrendingDown />}
          actions={
            <Segmented
              options={[{ id: 'all', label: 'All' }, ...catalog.modules.map((m) => ({ id: m.id, label: m.name.split(':')[0] }))]}
              value={trendModule}
              onChange={setTrendModule}
            />
          }
        >
          <LineChart
            height={230}
            yMin={0}
            emptyText="No attempts yet."
            series={[
              { id: 'mistakes', label: 'Mistakes per attempt', color: '#ef4444', points: trend.map((p, i) => ({ x: i + 1, y: p.mistakes, label: `${p.mistakes} (${p.title})` })) },
              { id: 'critical', label: 'Critical (safety) mistakes', color: '#7c3aed', points: trend.map((p, i) => ({ x: i + 1, y: p.critical })) },
            ]}
            xFormat={(v) => `#${Math.round(v)}`}
          />
          <p className="tiny muted" style={{ marginTop: 6 }}>
            Counts of evaluator-detected mistakes in each completed attempt, in order.
          </p>
        </Card>
      </div>

      <div className="grid grid-3">
        <Card title="Attempt history" icon={<History />} className="span-2">
          {progress.attempts.length ? <AttemptList attempts={progress.attempts.slice(0, 25)} linkPrefix={linkPrefix} /> : <Empty title="No completed attempts yet" />}
        </Card>
        <Card title="Milestones" icon={<Award />}>
          <div className="col gap-6">
            {ACHIEVEMENTS.map((a) => {
              const got = earned.get(a.id);
              return (
                <div key={a.id} className={got ? 'ach' : 'ach locked'}>
                  <span className={`ach-icon ${a.tier}`}>{achievementIcon(a.icon)}</span>
                  <div className="grow">
                    <div className="bold small">{a.title}</div>
                    <div className="tiny muted">{a.description}</div>
                  </div>
                  {got && <span className="tiny muted">{fmtDate(got.earnedAt)}</span>}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
