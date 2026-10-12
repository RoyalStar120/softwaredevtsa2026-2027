/**
 * Brand, icon mapping and small domain components shared by several pages.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertOctagon,
  Code2,
  Crown,
  Flame,
  FlaskConical,
  Footprints,
  Layers,
  Microscope,
  Route,
  Scissors,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Trophy,
  Zap,
  Cpu,
} from 'lucide-react';
import type { AttemptSummary } from '../../../shared/api.ts';
import type { MistakePattern } from '../../../shared/patterns.ts';
import { cx, fmtAgo, fmtDuration, scoreColor } from './ui.tsx';

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="sbg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#0ea5a4" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#sbg)" />
      <path d="M12 42 C 20 22, 44 22, 52 42" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <path d="M10 44 H54" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <path d="M22 44 V33 M32 44 V28 M42 44 V33" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

export function BrandLink({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand">
      <Logo />
      <div>
        <div className="brand-name">SkillBridge</div>
        <div className="brand-sub">Adaptive skills training</div>
      </div>
    </Link>
  );
}

export function ModuleIcon({ moduleId, size }: { moduleId: string; size?: number }) {
  const style = size ? { width: size, height: size } : undefined;
  return (
    <span className={cx('module-icon', moduleId)} style={style}>
      {moduleId === 'electrical' ? <Zap /> : moduleId === 'programming' ? <Code2 /> : <Cpu />}
    </span>
  );
}

export function moduleTone(moduleId: string): 'elec' | 'prog' | 'primary' {
  return moduleId === 'electrical' ? 'elec' : moduleId === 'programming' ? 'prog' : 'primary';
}

const ACH_ICONS: Record<string, ReactNode> = {
  footprints: <Footprints />,
  trophy: <Trophy />,
  microscope: <Microscope />,
  sparkles: <Sparkles />,
  route: <Route />,
  flask: <FlaskConical />,
  scissors: <Scissors />,
  flame: <Flame />,
  shield: <ShieldCheck />,
  trending: <TrendingUp />,
  crown: <Crown />,
  layers: <Layers />,
};

export function achievementIcon(key: string): ReactNode {
  return ACH_ICONS[key] ?? <Trophy />;
}

export function ScorePill({ score }: { score: number | null }) {
  if (score === null) return <span className="score-pill" style={{ background: 'var(--surface-3)', color: 'var(--muted)' }}>-</span>;
  const c = scoreColor(score / 100);
  return (
    <span className="score-pill" style={{ background: `color-mix(in srgb, ${c} 16%, transparent)`, color: `color-mix(in srgb, ${c} 80%, var(--text))` }}>
      {score}
    </span>
  );
}

export function AttemptList({ attempts, linkPrefix = '/debrief/', showStudent }: { attempts: Array<AttemptSummary & { studentName?: string }>; linkPrefix?: string; showStudent?: boolean }) {
  return (
    <div className="col gap-4">
      {attempts.map((a) => (
        <Link key={a.id} to={`${linkPrefix}${a.id}`} className="attempt-item">
          <ModuleIcon moduleId={a.moduleId} />
          <div className="grow">
            <div className="row gap-6" style={{ flexWrap: 'wrap' }}>
              <span className="bold">{a.title}</span>
              {showStudent && a.studentName && <span className="muted small">· {a.studentName}</span>}
              {a.mode === 'assessment' && <span className="badge badge-info">Assessment</span>}
            </div>
            <div className="small text-2 row gap-6" style={{ flexWrap: 'wrap' }}>
              <span>Difficulty {a.difficulty}</span>
              <span>·</span>
              <span>{fmtAgo(a.completedAt)}</span>
              <span>·</span>
              <span>{fmtDuration(a.durationSec)}</span>
              {a.processLabel && (
                <>
                  <span>·</span>
                  <span style={{ color: a.processTone === 'success' ? 'var(--success)' : a.processTone === 'danger' ? 'var(--danger)' : 'var(--warning)' }}>{a.processLabel}</span>
                </>
              )}
            </div>
          </div>
          <ScorePill score={a.overall} />
        </Link>
      ))}
    </div>
  );
}

export function PatternItem({ p }: { p: MistakePattern }) {
  const statusText = p.status === 'active' ? 'Recurring' : p.status === 'improving' ? 'Improving' : 'Resolved';
  return (
    <div className={cx('pattern', p.status)}>
      <div className="pattern-icon">{p.status === 'resolved' ? <TrendingUp /> : <AlertOctagon />}</div>
      <div className="grow">
        <div className="row between gap-6">
          <span className="bold small">{p.title}</span>
          <span className={cx('badge', p.status === 'active' ? 'badge-danger' : p.status === 'improving' ? 'badge-warning' : 'badge-success')}>{statusText}</span>
        </div>
        <div className="row gap-6 tiny muted" style={{ marginTop: 4 }}>
          <span className="occ-dots" aria-label={`${p.occurrences} of last ${p.window} attempts`}>
            {Array.from({ length: p.window }, (_, i) => (
              <span key={i} className={i < p.occurrences ? 'hit' : ''} />
            ))}
          </span>
          <span>
            in {p.occurrences} of your last {p.window} attempts{p.absentStreak > 0 ? `, absent in the latest ${p.absentStreak}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
