import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, School, Users, ClipboardList, Activity, Copy } from 'lucide-react';
import { PageHeader } from '../components/Layout.tsx';
import { Callout, Empty, Modal, PageLoading, useToast } from '../components/ui.tsx';
import { useLoad } from '../state/session.tsx';
import { api } from '../api.ts';

export default function InstructorHome() {
  const classes = useLoad(() => api.classes(), []);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const create = async () => {
    try {
      await api.createClass(name);
      setOpen(false);
      setName('');
      classes.reload();
      toast('Class created. Share the join code with your students.', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };

  if (classes.loading && !classes.data) return <PageLoading />;
  if (classes.error) return <div className="page"><Callout tone="danger">{classes.error}</Callout></div>;

  return (
    <div className="page">
      <PageHeader
        title="Your classes"
        subtitle="See how students perform skills, not just whether they finished, and send targeted practice to the students who need it."
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus /> New class
          </button>
        }
      />
      {classes.data!.length === 0 ? (
        <Empty icon={<School />} title="No classes yet">
          Create a class and share its join code.
        </Empty>
      ) : (
        <div className="grid grid-auto">
          {classes.data!.map((c) => (
            <Link key={c.id} to={`/instructor/classes/${c.id}`} className="card hoverable card-pad" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="row between top">
                <h3>{c.name}</h3>
                <button
                  className="badge badge-primary"
                  style={{ border: 0, cursor: 'copy' }}
                  title="Copy join code"
                  onClick={(e) => {
                    e.preventDefault();
                    void navigator.clipboard?.writeText(c.code);
                    toast(`Copied join code ${c.code}`, 'info');
                  }}
                >
                  <Copy /> {c.code}
                </button>
              </div>
              <div className="grid grid-2" style={{ marginTop: 14, gap: 10 }}>
                <div className="stat">
                  <span className="stat-value">{c.studentCount}</span>
                  <span className="stat-label row gap-4">
                    <Users width={12} height={12} /> students
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-value">{c.avgScore ?? '-'}</span>
                  <span className="stat-label">avg score</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{c.attemptsThisWeek}</span>
                  <span className="stat-label row gap-4">
                    <Activity width={12} height={12} /> attempts this week
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-value">{c.openAssignments}</span>
                  <span className="stat-label row gap-4">
                    <ClipboardList width={12} height={12} /> open assignments
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create a class"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={create} disabled={!name.trim()}>
              Create
            </button>
          </>
        }
      >
        <label className="field">
          <span className="label">Class name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Period 5 · Intro to Engineering" autoFocus />
        </label>
      </Modal>
    </div>
  );
}
