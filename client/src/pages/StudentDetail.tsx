import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Repeat, Sparkles, Target } from 'lucide-react';
import { PageHeader, Avatar } from '../components/Layout.tsx';
import { AssignModal, type AssignPreset } from '../components/AssignModal.tsx';
import { PatternItem, ModuleIcon } from '../components/domain.tsx';
import { ReasonIcon } from '../components/adaptive.tsx';
import { Callout, Card, PageLoading, Badge } from '../components/ui.tsx';
import { useLoad, useSession } from '../state/session.tsx';
import { api } from '../api.ts';
import { ProgressView } from './Progress.tsx';

export default function StudentDetail() {
  const { id = '' } = useParams();
  const data = useLoad(() => api.student(id), [id]);
  const { skill } = useSession();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<AssignPreset | undefined>();

  if (data.loading && !data.data) return <PageLoading />;
  if (data.error || !data.data) return <div className="page"><Callout tone="danger">{data.error}</Callout></div>;
  const d = data.data;
  const classId = d.classes[0]?.id;
  const patterns = d.profile.patterns.filter((p) => p.status !== 'resolved');

  const assign = (p: AssignPreset) => {
    setPreset({ ...p, studentIds: [d.user.id] });
    setOpen(true);
  };

  return (
    <div className="page wide">
      <PageHeader
        eyebrow={classId ? <Link to={`/instructor/classes/${classId}`}>← {d.classes[0].name}</Link> : undefined}
        title={
          <span className="row gap-10" style={{ gap: 12 }}>
            <Avatar name={d.user.displayName} large />
            {d.user.displayName}
          </span>
        }
        subtitle={`${d.profile.stats.completed} scenarios completed · average score ${d.profile.stats.avgScore || '-'} · ${d.profile.stats.practiceMinutes} minutes of practice`}
        actions={
          classId && (
            <button className="btn btn-primary" onClick={() => assign({ title: `Practice for ${d.user.displayName.split(' ')[0]}` })}>
              <Target /> Assign targeted practice
            </button>
          )
        }
      />
      <div className="stack-lg">
        <div className="grid grid-2">
          <Card title="Recurring mistakes" icon={<Repeat />}>
            {patterns.length === 0 ? (
              <p className="small muted">No recurring mistakes right now.</p>
            ) : (
              <div className="col gap-6">
                {patterns.map((p) => (
                  <div key={p.moduleId + p.code} className="row gap-6 top">
                    <div className="grow">
                      <PatternItem p={p} />
                    </div>
                    {classId && (
                      <button
                        className="btn btn-sm btn-soft"
                        onClick={() => assign({ title: `Targeted practice: ${p.title.toLowerCase()}`, focusSkills: p.skillIds, note: `You've repeated "${p.title}". This practice targets the skills involved.` })}
                      >
                        Target
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="What the adaptive engine would assign next" icon={<Sparkles />}>
            <div className="col gap-10" style={{ gap: 10 }}>
              {d.recommendations.map((r) => (
                <div key={r.templateId} className="row top gap-10" style={{ gap: 10 }}>
                  <ModuleIcon moduleId={r.moduleId} size={32} />
                  <div className="grow">
                    <div className="row wrap gap-6">
                      <span className="bold small">{r.title}</span>
                      <Badge>difficulty {r.difficulty}</Badge>
                      {r.focusSkills.map((s) => (
                        <Badge key={s} tone="primary">
                          {skill(s)?.shortName ?? s}
                        </Badge>
                      ))}
                    </div>
                    {r.reasons.slice(0, 2).map((x, i) => (
                      <div key={i} className="row top gap-6 tiny text-2" style={{ marginTop: 3 }}>
                        <span style={{ display: 'inline-flex', flex: 'none', marginTop: 1, color: 'var(--primary)' }}>
                          <ReasonIcon kind={x.kind} size={14} />
                        </span>
                        <span>{x.text}</span>
                      </div>
                    ))}
                  </div>
                  {classId && (
                    <button className="btn btn-sm" onClick={() => assign({ title: r.title, templateId: r.templateId, focusSkills: r.focusSkills })}>
                      Assign
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
        <ProgressView profile={d.profile} progress={d.progress} />
      </div>
      {classId && (
        <AssignModal open={open} onClose={() => setOpen(false)} classId={classId} roster={[{ user: d.user }]} preset={preset} onCreated={data.reload} />
      )}
    </div>
  );
}
