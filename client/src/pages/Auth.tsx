import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { GraduationCap, User } from 'lucide-react';
import { Logo } from '../components/domain.tsx';
import { useSession } from '../state/session.tsx';
import { api } from '../api.ts';
import { Segmented } from '../components/ui.tsx';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { setUser } = useSession();
  const navigate = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'learner' | 'instructor'>('learner');
  const [classCode, setClassCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = (r: string) => navigate(from && from !== '/' ? from : r === 'instructor' ? '/instructor' : '/home', { replace: true });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } =
        mode === 'login' ? await api.login(username, password) : await api.register({ username, password, displayName, role, classCode: classCode || undefined });
      setUser(user);
      go(user.role);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const demo = async (r: 'learner' | 'instructor') => {
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.demo(r);
      setUser(user);
      go(user.role);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card fade-in">
        <Link to="/" className="row gap-10" style={{ gap: 10, textDecoration: 'none', color: 'inherit' }}>
          <Logo size={38} />
          <div>
            <div className="bold" style={{ fontSize: '1.15rem' }}>
              SkillBridge
            </div>
            <div className="tiny muted">Adaptive skills training</div>
          </div>
        </Link>
        <h2 style={{ marginTop: 22 }}>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
        <p className="small text-2" style={{ marginTop: 4 }}>
          {mode === 'login' ? 'Sign in to continue practicing.' : 'Practice skills with a coach that adapts to how you work.'}
        </p>

        <div className="eyebrow" style={{ marginTop: 18, marginBottom: 8 }}>
          One-click demo
        </div>
        <div className="demo-buttons">
          <button className="demo-btn" onClick={() => demo('learner')} disabled={busy} type="button">
            <User />
            <span className="bold small">Learner demo</span>
            <span className="tiny muted">Alex Chen, with history</span>
          </button>
          <button className="demo-btn" onClick={() => demo('instructor')} disabled={busy} type="button">
            <GraduationCap />
            <span className="bold small">Instructor demo</span>
            <span className="tiny muted">Ms. Carter, Period 3</span>
          </button>
        </div>

        <hr className="divider" style={{ margin: '20px 0' }} />

        <form className="col gap-16" onSubmit={submit} style={{ gap: 14 }}>
          {mode === 'register' && (
            <>
              <div className="field">
                <span className="label">I am a</span>
                <Segmented
                  options={[
                    { id: 'learner', label: 'Learner' },
                    { id: 'instructor', label: 'Instructor' },
                  ]}
                  value={role}
                  onChange={setRole}
                />
              </div>
              <label className="field">
                <span className="label">Your name</span>
                <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Jamie Rivera" required maxLength={40} />
              </label>
            </>
          )}
          <label className="field">
            <span className="label">Username</span>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </label>
          <label className="field">
            <span className="label">Password</span>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 6 : 1} />
          </label>
          {mode === 'register' && role === 'learner' && (
            <label className="field">
              <span className="label">Class code (optional)</span>
              <input className="input" value={classCode} onChange={(e) => setClassCode(e.target.value)} placeholder="e.g. TSA-2026" />
              <span className="help">Join your instructor's class so they can assign scenarios.</span>
            </label>
          )}
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy} type="submit">
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="small text-2 center" style={{ marginTop: 16 }}>
          {mode === 'login' ? (
            <>
              New here? <Link to="/register">Create an account</Link>
            </>
          ) : (
            <>
              Already have an account? <Link to="/login">Sign in</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
