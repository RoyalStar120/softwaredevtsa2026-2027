import { useEffect, useState } from 'react';
import type { CreateAssignmentRequest, RosterStudent } from '../../../shared/api.ts';
import type { AssignmentKind } from '../../../shared/api.ts';
import { Modal, Segmented, useToast } from './ui.tsx';
import { useSession } from '../state/session.tsx';
import { api } from '../api.ts';

export interface AssignPreset {
  title?: string;
  kind?: AssignmentKind;
  templateId?: string | null;
  focusSkills?: string[];
  studentIds?: string[];
  note?: string;
}

export function AssignModal(props: {
  open: boolean;
  onClose: () => void;
  classId: string;
  roster: Array<Pick<RosterStudent, 'user'>>;
  preset?: AssignPreset;
  onCreated: () => void;
}) {
  const { catalog } = useSession();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<AssignmentKind>('practice');
  const [target, setTarget] = useState<'scenario' | 'skills'>('skills');
  const [templateId, setTemplateId] = useState<string>('');
  const [difficulty, setDifficulty] = useState<string>('');
  const [focus, setFocus] = useState<string[]>([]);
  const [students, setStudents] = useState<string[]>([]);
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    const p = props.preset ?? {};
    setTitle(p.title ?? '');
    setKind(p.kind ?? 'practice');
    setTarget(p.templateId ? 'scenario' : 'skills');
    setTemplateId(p.templateId ?? catalog?.modules[0]?.templates[0]?.id ?? '');
    setDifficulty('');
    setFocus(p.focusSkills ?? []);
    setStudents(p.studentIds ?? []);
    setDue('');
    setNote(p.note ?? '');
  }, [props.open, props.preset, catalog]);

  const templates = (catalog?.modules ?? []).flatMap((m) => m.templates.map((t) => ({ ...t, moduleName: m.name })));
  const tpl = templates.find((t) => t.id === templateId);

  const save = async () => {
    const body: CreateAssignmentRequest = {
      title: title.trim() || (target === 'scenario' ? tpl?.title ?? 'Practice' : 'Skill practice'),
      kind,
      templateId: target === 'scenario' ? templateId : null,
      difficulty: target === 'scenario' && difficulty ? Number(difficulty) : null,
      focusSkills: target === 'skills' ? focus : [],
      dueAt: due ? new Date(`${due}T23:59:00`).getTime() : null,
      note: note.trim() || null,
      studentIds: students,
    };
    setBusy(true);
    try {
      const r = await api.createAssignment(props.classId, body);
      toast(`Assigned to ${students.length ? `${r.ids.length} student(s)` : 'the whole class'}`, 'success');
      props.onCreated();
      props.onClose();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      wide
      title="New assignment"
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || (target === 'skills' && focus.length === 0)}>
            Assign
          </button>
        </>
      }
    >
      <div className="grid grid-2">
        <div className="col gap-16" style={{ gap: 14 }}>
          <label className="field">
            <span className="label">Title</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Practice: voltage-drop testing" />
          </label>
          <div className="field">
            <span className="label">Type</span>
            <Segmented
              options={[
                { id: 'practice', label: 'Practice' },
                { id: 'baseline', label: 'Baseline test' },
                { id: 'transfer', label: 'Transfer test' },
              ]}
              value={kind}
              onChange={setKind}
            />
            <span className="help">Baseline and transfer tests are assessments: no hints, and they feed the Evidence tab (pre/post comparison).</span>
          </div>
          <div className="field">
            <span className="label">What to practice</span>
            <Segmented
              options={[
                { id: 'skills', label: 'Skill objective (adaptive)' },
                { id: 'scenario', label: 'Specific scenario' },
              ]}
              value={target}
              onChange={setTarget}
            />
          </div>
          {target === 'scenario' ? (
            <div className="row gap-6">
              <select className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.moduleName.split(':')[0]}: {t.title}
                  </option>
                ))}
              </select>
              <select className="select" style={{ width: 150 }} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="">Adaptive level</option>
                {tpl &&
                  Array.from({ length: tpl.difficultyRange[1] - tpl.difficultyRange[0] + 1 }, (_, i) => tpl.difficultyRange[0] + i).map((d) => (
                    <option key={d} value={d}>
                      Difficulty {d}
                    </option>
                  ))}
              </select>
            </div>
          ) : (
            <div className="col gap-6">
              {(catalog?.modules ?? []).map((m) => (
                <div key={m.id}>
                  <div className="tiny bold muted" style={{ margin: '4px 0' }}>
                    {m.name}
                  </div>
                  <div className="row wrap gap-6">
                    {m.skills.map((s) => (
                      <button key={s.id} type="button" className={focus.includes(s.id) ? 'btn btn-sm btn-primary' : 'btn btn-sm'} onClick={() => setFocus((f) => toggle(f, s.id))}>
                        {s.shortName}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <span className="help">Each student gets a different scenario, chosen by the adaptive engine to emphasize these skills at their level.</span>
            </div>
          )}
        </div>
        <div className="col gap-16" style={{ gap: 14 }}>
          <div className="field">
            <span className="label">Students</span>
            <div className="row wrap gap-6">
              <button type="button" className={students.length === 0 ? 'btn btn-sm btn-primary' : 'btn btn-sm'} onClick={() => setStudents([])}>
                Whole class
              </button>
              {props.roster.map((r) => (
                <button key={r.user.id} type="button" className={students.includes(r.user.id) ? 'btn btn-sm btn-primary' : 'btn btn-sm'} onClick={() => setStudents((s) => toggle(s, r.user.id))}>
                  {r.user.displayName}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="label">Due date (optional)</span>
            <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Note to students (optional)</span>
            <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this practice matters…" />
          </label>
        </div>
      </div>
    </Modal>
  );
}
