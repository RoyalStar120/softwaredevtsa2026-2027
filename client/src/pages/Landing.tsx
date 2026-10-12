import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Code2, GraduationCap, MessageSquare, Repeat, User, Zap, Activity, Brain, ClipboardCheck, Database, Gauge, Cpu, Shield } from 'lucide-react';
import { BrandLink } from '../components/domain.tsx';
import { useSession } from '../state/session.tsx';
import { api } from '../api.ts';
import { useToast } from '../components/ui.tsx';

const LOOP = [
  { n: '01', t: 'Choose a skill', d: 'Pick a module, or let SkillBridge choose' },
  { n: '02', t: 'Enter a scenario', d: 'A realistic problem with a goal and constraints' },
  { n: '03', t: 'Perform the task', d: 'Measure, test, decide. Every action is recorded' },
  { n: '04', t: 'Analyze performance', d: 'Outcome AND process, against an expert path' },
  { n: '05', t: 'Receive coaching', d: 'Grounded in your recorded actions' },
  { n: '06', t: 'Practice a targeted weakness', d: 'A NEW scenario chosen for what you need', key: true },
  { n: '07', t: 'Measure improvement', d: 'Mastery that requires repeated success' },
];

const COMPARE = [
  ['Delivers lessons and quizzes', 'Provides interactive practice scenarios'],
  ['Often evaluates final answers', 'Evaluates the process and the outcome'],
  ['Gives general explanations', 'Uses your recorded actions to personalize feedback'],
  ['Offers a predetermined lesson sequence', 'Selects practice based on your individual weaknesses'],
  ['Tracks course completion', 'Tracks skill development and mastery'],
  ['Repeats standard exercises', 'Varies scenarios to test transferable skills'],
];

export function Landing() {
  const { setUser } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const demo = async (role: 'learner' | 'instructor') => {
    setBusy(true);
    try {
      const { user } = await api.demo(role);
      setUser(user);
      navigate(role === 'instructor' ? '/instructor' : '/home');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="landing">
      <nav className="landing-nav">
        <BrandLink />
        <div className="row gap-6">
          <a className="btn btn-ghost" href="#how">How it works</a>
          <Link className="btn" to="/login">
            Sign in
          </Link>
          <button className="btn btn-primary" onClick={() => demo('learner')} disabled={busy}>
            Try the demo
          </button>
        </div>
      </nav>

      <section className="landing-hero">
        <div>
          <span className="badge badge-primary" style={{ marginBottom: 14 }}>
            TSA Software Development · Adaptive skills training
          </span>
          <h1>
            It watches <span className="grad">how</span> you practice, then changes <span className="grad">what</span> you practice next.
          </h1>
          <p className="lead">
            SkillBridge drops you into realistic simulations: debugging live code, diagnosing circuit faults. It records every decision, compares your process to an
            expert's, explains your mistakes using your own actions, and picks the scenario that targets exactly what you need.
          </p>
          <div className="row wrap gap-10" style={{ marginTop: 24, gap: 10 }}>
            <button className="btn btn-lg btn-primary" onClick={() => demo('learner')} disabled={busy}>
              <User /> Try as a learner
            </button>
            <button className="btn btn-lg" onClick={() => demo('instructor')} disabled={busy}>
              <GraduationCap /> Try as an instructor
            </button>
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>
            Works fully offline. No account needed for the demo. <Link to="/register">Create your own account</Link>.
          </p>
        </div>
        <div className="loop">
          <div className="row between" style={{ marginBottom: 12 }}>
            <span className="eyebrow" style={{ color: '#8291b3' }}>
              The adaptive practice loop
            </span>
            <Repeat width={16} height={16} color="#8291b3" />
          </div>
          {LOOP.map((s) => (
            <div key={s.n} className={s.key ? 'loop-step key' : 'loop-step'}>
              <span className="n">{s.n}</span>
              <div>
                <div className="bold small">{s.t}</div>
                <div className="tiny" style={{ color: '#8291b3' }}>
                  {s.d}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section" id="how">
        <h2>One platform, fundamentally different skills</h2>
        <p className="text-2" style={{ marginTop: 6, maxWidth: 760 }}>
          Every module brings its own interactions, simulation rules, evaluation criteria and safety checks. The shared platform handles accounts, action tracking,
          skill analytics, adaptive practice and coaching, the same way for every skill.
        </p>
        <div className="grid grid-3" style={{ marginTop: 20 }}>
          <div className="card card-pad">
            <div className="row gap-10" style={{ gap: 10 }}>
              <span className="module-icon programming">
                <Code2 />
              </span>
              <h3>Programming: Debugging</h3>
            </div>
            <p className="small text-2" style={{ marginTop: 10 }}>
              Real JavaScript runs in a sandboxed worker. Reproduce the bug, form a hypothesis, test it, make a minimal fix, verify. SkillBridge notices if you edit
              before reproducing, guess, or leave debug code behind.
            </p>
          </div>
          <div className="card card-pad">
            <div className="row gap-10" style={{ gap: 10 }}>
              <span className="module-icon electrical">
                <Zap />
              </span>
              <h3>Electrical: Troubleshooting</h3>
            </div>
            <p className="small text-2" style={{ marginTop: 10 }}>
              Circuits are solved with real nodal analysis. Use a multimeter, lock out, repair. SkillBridge tracks how much each reading actually told you and flags
              unsafe steps.
            </p>
          </div>
          <div className="card card-pad" style={{ borderStyle: 'dashed', background: 'transparent' }}>
            <div className="row gap-10" style={{ gap: 10 }}>
              <span className="module-icon" style={{ background: 'var(--surface-3)', color: 'var(--muted)' }}>
                <MessageSquare />
              </span>
              <h3 style={{ color: 'var(--text-2)' }}>Communication</h3>
              <span className="badge">Future module</span>
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>
              Same platform, new interactions: branching conversations evaluated on empathy, clarity and problem solving. Adding a module means implementing one
              interface.
            </p>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <h2>What makes SkillBridge different?</h2>
        <div className="card" style={{ marginTop: 16, overflow: 'hidden' }}>
          <table className="compare">
            <thead>
              <tr>
                <th>Typical learning platform</th>
                <th>SkillBridge</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map(([a, b]) => (
                <tr key={a}>
                  <td className="text-2">{a}</td>
                  <td>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="landing-section">
        <h2>Under the hood</h2>
        <div className="grid grid-4" style={{ marginTop: 16 }}>
          {[
            { i: <Cpu />, t: 'Simulation engine', d: 'Server-authoritative, deterministic, seeded variations' },
            { i: <Activity />, t: 'Action logger', d: 'Every step stored with hidden engine annotations' },
            { i: <ClipboardCheck />, t: 'Rules & evaluation', d: 'Accuracy, process, efficiency, safety' },
            { i: <Database />, t: 'Learner model', d: 'Per-skill ability with uncertainty + spaced review' },
            { i: <Gauge />, t: 'Adaptive engine', d: 'Weakness, desirable difficulty, recurring mistakes' },
            { i: <Brain />, t: 'AI coach', d: 'Explains engine output; never invents the answer' },
            { i: <GraduationCap />, t: 'Instructor dashboard', d: 'Class mastery, common mistakes, evidence' },
            { i: <Shield />, t: 'Safety first', d: 'Unsafe processes are capped. Simulation only.' },
          ].map((x) => (
            <div key={x.t} className="card card-pad">
              <div className="row gap-6" style={{ color: 'var(--primary)' }}>
                {x.i}
                <span className="bold" style={{ color: 'var(--text)' }}>
                  {x.t}
                </span>
              </div>
              <p className="small text-2" style={{ marginTop: 6 }}>
                {x.d}
              </p>
            </div>
          ))}
        </div>
        <div className="row center" style={{ justifyContent: 'center', marginTop: 28 }}>
          <button className="btn btn-lg btn-primary" onClick={() => demo('learner')} disabled={busy}>
            Start practicing <ArrowRight />
          </button>
        </div>
        <p className="tiny muted center" style={{ marginTop: 28 }}>
          SkillBridge simulations are practice tools. They do not replace certified instruction, professional supervision, or real-world credentials.
        </p>
      </section>
    </div>
  );
}
