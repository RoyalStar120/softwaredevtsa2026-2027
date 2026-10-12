import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Lock, ShieldAlert, Sparkles, Wand2, Layers } from 'lucide-react';
import { PageHeader } from '../components/Layout.tsx';
import { ModuleIcon } from '../components/domain.tsx';
import { Badge, Callout, Difficulty, PageLoading, Tabs, useToast } from '../components/ui.tsx';
import { useLoad, useSession } from '../state/session.tsx';
import { api } from '../api.ts';
import type { ScenarioTemplate } from '../../../shared/types.ts';

export default function Practice() {
  const { catalog, user, skill } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const isLearner = user?.role === 'learner';
  const profile = useLoad(() => (isLearner ? api.profile() : Promise.resolve(null)), [isLearner]);
  const [tab, setTab] = useState<string>(catalog?.modules[0]?.id ?? 'programming');
  const [busy, setBusy] = useState(false);
  const [diffs, setDiffs] = useState<Record<string, string>>({});

  if (!catalog) return <PageLoading />;
  const mod = catalog.modules.find((m) => m.id === tab) ?? catalog.modules[0];
  const mastery = new Map((profile.data?.skills ?? []).map((s) => [s.skillId, s]));

  const start = async (body: Parameters<typeof api.startAttempt>[0]) => {
    setBusy(true);
    try {
      const { attemptId } = await api.startAttempt(body);
      navigate(`/play/${attemptId}`);
    } catch (e) {
      toast((e as Error).message, 'danger');
      setBusy(false);
    }
  };

  const unmet = (t: ScenarioTemplate) => (isLearner ? t.prerequisites.filter((p) => (mastery.get(p)?.mastery ?? 0) < 0.4) : []);

  return (
    <div className="page">
      <PageHeader
        title={isLearner ? 'Practice' : 'Scenario library'}
        subtitle={
          isLearner
            ? 'Choose a scenario yourself, or let the adaptive engine pick the one that targets what you need most.'
            : 'Every template generates many variations (different faults or bugs, difficulty levels and focus skills). Preview any scenario as a learner would see it.'
        }
        actions={
          isLearner && (
            <button className="btn btn-primary" disabled={busy} onClick={() => start({ source: 'recommended' })}>
              <Wand2 /> Let SkillBridge choose
            </button>
          )
        }
      />
      <Tabs tabs={catalog.modules.map((m) => ({ id: m.id, label: m.name, icon: <ModuleIcon moduleId={m.id} size={22} /> }))} value={mod.id} onChange={setTab} />

      <div className="stack" style={{ marginTop: 18 }}>
        <div className="module-banner">
          <ModuleIcon moduleId={mod.id} />
          <div className="grow">
            <h2>{mod.name}</h2>
            <p className="text-2" style={{ marginTop: 4 }}>
              {mod.description}
            </p>
            <div className="row wrap gap-6" style={{ marginTop: 10 }}>
              {mod.skills.map((s) => (
                <span key={s.id} className="chip">
                  <span className="dot" style={{ background: `var(--lvl-${mastery.get(s.id)?.level ?? 'not_started'})` }} />
                  {s.name}
                </span>
              ))}
            </div>
          </div>
          {isLearner && (
            <button className="btn btn-soft" disabled={busy} onClick={() => start({ moduleId: mod.id, source: 'recommended' })}>
              <Sparkles /> Adaptive pick
            </button>
          )}
        </div>
        {mod.safetyNotice && (
          <Callout tone="warning" icon={<ShieldAlert />}>
            {mod.safetyNotice}
          </Callout>
        )}

        <div className="grid grid-auto">
          {mod.templates.map((t) => {
            const missing = unmet(t);
            const choice = diffs[t.id] ?? 'adaptive';
            return (
              <div key={t.id} className="card hoverable">
                <div className="template-card">
                  <div className="row between top">
                    <h3>{t.title}</h3>
                    <Difficulty value={t.difficultyRange[1]} />
                  </div>
                  <p className="small text-2">{t.summary}</p>
                  <div className="row wrap gap-6 small muted">
                    <span className="row gap-4">
                      <Clock width={14} height={14} /> ~{t.estimatedMinutes} min
                    </span>
                    <span>·</span>
                    <span>
                      Difficulty {t.difficultyRange[0]}–{t.difficultyRange[1]}
                    </span>
                    <span>·</span>
                    <span className="row gap-4">
                      <Layers width={14} height={14} /> {t.variantCount} fault/bug variants
                    </span>
                  </div>
                  <div className="skill-chips">
                    {Object.entries(t.skillWeights)
                      .filter(([, w]) => w >= 0.6)
                      .sort((a, b) => b[1] - a[1])
                      .map(([s]) => (
                        <Badge key={s} tone={mod.id === 'electrical' ? 'elec' : 'prog'}>
                          {skill(s)?.shortName ?? s}
                        </Badge>
                      ))}
                  </div>
                  <div className="grow" />
                  {missing.length > 0 && (
                    <div className="locked-note">
                      <Lock /> Recommended after: {missing.map((p) => skill(p)?.name ?? p).join(', ')}
                    </div>
                  )}
                  <div className="row gap-6">
                    <select
                      className="select"
                      style={{ height: 32, width: 'auto', flex: '1 1 auto' }}
                      value={choice}
                      onChange={(e) => setDiffs((d) => ({ ...d, [t.id]: e.target.value }))}
                      aria-label="Difficulty"
                    >
                      <option value="adaptive">Adaptive difficulty</option>
                      {Array.from({ length: t.difficultyRange[1] - t.difficultyRange[0] + 1 }, (_, i) => t.difficultyRange[0] + i).map((d) => (
                        <option key={d} value={d}>
                          Difficulty {d}
                        </option>
                      ))}
                    </select>
                    <button
                      className={missing.length ? 'btn btn-sm' : 'btn btn-sm btn-primary'}
                      disabled={busy}
                      onClick={() => start({ templateId: t.id, difficulty: choice === 'adaptive' ? undefined : Number(choice), source: 'catalog' })}
                    >
                      {isLearner ? 'Start' : 'Preview'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
