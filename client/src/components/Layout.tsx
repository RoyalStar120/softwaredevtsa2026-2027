import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { BarChart3, BookOpen, Bot, Compass, GraduationCap, Home, LogOut, Moon, School, Sun, Dumbbell } from 'lucide-react';
import { BrandLink } from './domain.tsx';
import { useSession } from '../state/session.tsx';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function Avatar({ name, large }: { name: string; large?: boolean }) {
  return <span className={large ? 'avatar lg' : 'avatar'}>{initials(name)}</span>;
}

export function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('sb-theme') ?? 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('sb-theme', theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))];
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout, catalog } = useSession();
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();
  const learnerLinks = [
    { to: '/home', label: 'Home', icon: <Home /> },
    { to: '/practice', label: 'Practice', icon: <Dumbbell /> },
    { to: '/progress', label: 'My progress', icon: <BarChart3 /> },
  ];
  const instructorLinks = [
    { to: '/instructor', label: 'Classes', icon: <School /> },
    { to: '/practice', label: 'Scenario library', icon: <Compass /> },
  ];
  const links = user?.role === 'instructor' ? instructorLinks : learnerLinks;
  const ai = catalog?.ai;

  const doLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <BrandLink to={user?.role === 'instructor' ? '/instructor' : '/home'} />
        <div className="nav-section">{user?.role === 'instructor' ? 'Instructor' : 'Learn'}</div>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === '/instructor'} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            {l.icon}
            {l.label}
          </NavLink>
        ))}
        <div className="nav-section">Platform</div>
        <NavLink to="/about" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
          <BookOpen />
          How it works
        </NavLink>
        <div className="sidebar-footer">
          <div className="ai-chip" title="AI coach provider">
            <Bot />
            <span>
              AI coach: <b>{ai?.provider === 'offline' || !ai ? 'Built-in (offline)' : `${ai.provider === 'gemini' ? 'Gemini' : 'OpenAI'}`}</b>
            </span>
          </div>
          {user && (
            <div className="user-card">
              <Avatar name={user.displayName} />
              <div className="grow">
                <div className="bold small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user.displayName}
                </div>
                <div className="tiny muted row gap-4">
                  {user.role === 'instructor' ? <GraduationCap width={12} height={12} /> : null}
                  {user.role === 'instructor' ? 'Instructor' : 'Learner'}
                  {user.isDemo ? ' · demo' : ''}
                </div>
              </div>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={toggleTheme} aria-label="Toggle dark mode" title="Toggle dark mode">
                {theme === 'light' ? <Moon /> : <Sun />}
              </button>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={doLogout} aria-label="Sign out" title="Sign out">
                <LogOut />
              </button>
            </div>
          )}
        </div>
      </aside>
      <div className="main">
        <nav className="mobile-nav">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              {l.icon}
              {l.label}
            </NavLink>
          ))}
          <NavLink to="/about" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <BookOpen />
            About
          </NavLink>
          <button className="btn btn-ghost btn-sm" onClick={doLogout} style={{ marginLeft: 'auto' }}>
            <LogOut />
          </button>
        </nav>
        {children}
      </div>
    </div>
  );
}

export function PageHeader(props: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {props.eyebrow && <div className="eyebrow" style={{ marginBottom: 4 }}>{props.eyebrow}</div>}
        <h1>{props.title}</h1>
        {props.subtitle && <p>{props.subtitle}</p>}
      </div>
      {props.actions && <div className="row wrap gap-6">{props.actions}</div>}
    </header>
  );
}
