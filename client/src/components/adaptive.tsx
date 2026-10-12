/**
 * Skill tree (prerequisite graph) and the adaptive "next practice" hero.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ClipboardList,
  Crosshair,
  Gauge,
  Layers,
  Lock,
  RefreshCw,
  Repeat,
  Sparkles,
  Target,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SkillDef } from '../../../shared/types.ts';
import type { SkillView } from '../../../shared/api.ts';
import type { Recommendation, ReasonKind } from '../../../shared/adaptive.ts';
import { masteryColor } from './charts.tsx';
import { Difficulty, LEVEL_TEXT, useToast } from './ui.tsx';
import { ModuleIcon } from './domain.tsx';
import { useSession } from '../state/session.tsx';
import { api } from '../api.ts';

export function SkillTree(props: { skills: SkillDef[]; views: Record<string, SkillView>; selected?: string | null; onSelect?: (id: string) => void }) {
  const NODE_W = 168;
  const NODE_H = 66;
  const COL_W = 196;
  const ROW_H = 104;
  const maxCol = Math.max(...props.skills.map((s) => s.column), 2);
  const maxTier = Math.max(...props.skills.map((s) => s.tier), 0);
  const width = (maxCol + 1) * COL_W + 20;
  const height = (maxTier + 1) * ROW_H + 10;
  const pos = (s: SkillDef) => ({ x: 10 + s.column * COL_W + (COL_W - NODE_W) / 2, y: 8 + s.tier * ROW_H });
  const byId = new Map(props.skills.map((s) => [s.id, s]));

  return (
    <div className="skill-tree">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: '100%' }}>
        {props.skills.flatMap((s) =>
          s.prerequisites
            .filter((p) => byId.has(p))
            .map((p) => {
              const a = pos(byId.get(p)!);
              const b = pos(s);
              const x1 = a.x + NODE_W / 2;
              const y1 = a.y + NODE_H;
              const x2 = b.x + NODE_W / 2;
              const y2 = b.y;
              const my = (y1 + y2) / 2;
              const met = (props.views[p]?.mastery ?? 0) >= 0.4;
              return (
                <path
                  key={`${p}-${s.id}`}
                  d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`}
                  fill="none"
                  stroke={met ? 'var(--primary)' : 'var(--border-strong)'}
                  strokeWidth={met ? 2 : 1.5}
                  strokeDasharray={met ? undefined : '4 4'}
                />
              );
            }),
        )}
        {props.skills.map((s) => {
          const v = props.views[s.id];
          const { x, y } = pos(s);
          const color = masteryColor(v?.mastery ?? 0, v?.evidenceCount ?? 0);
          const locked = v ? !v.unlocked && v.evidenceCount === 0 : false;
          const sel = props.selected === s.id;
          return (
            <g key={s.id} className="skill-node" transform={`translate(${x},${y})`} onClick={() => props.onSelect?.(s.id)} opacity={locked ? 0.6 : 1}>
              <rect className="node-card" width={NODE_W} height={NODE_H} rx={12} fill="var(--surface)" stroke={sel ? 'var(--primary)' : 'var(--border-strong)'} strokeWidth={sel ? 2.5 : 1.2} />
              <rect x={0} y={0} width={5} height={NODE_H} rx={2.5} fill={color} />
              <text x={14} y={22} fontSize={12.5} fontWeight={700} fill="var(--text)">
                {s.shortName}
              </text>
              <text x={14} y={38} fontSize={10.5} fontWeight={600} fill="var(--muted)">
                {v ? LEVEL_TEXT[v.level] : 'Not started'}
                {v?.reviewDue ? ' · review due' : ''}
              </text>
              <rect x={14} y={48} width={NODE_W - 28} height={6} rx={3} fill="var(--surface-3)" />
              <rect x={14} y={48} width={(NODE_W - 28) * (v?.evidenceCount ? v.mastery : 0)} height={6} rx={3} fill={color} />
              {locked && (
                <g transform={`translate(${NODE_W - 24}, 10)`}>
                  <Lock width={14} height={14} color="var(--muted)" />
                </g>
              )}
              <title>{`${s.name}: ${s.description}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const REASON_ICON: Record<ReasonKind, LucideIcon> = {
  assignment: ClipboardList,
  focus: Crosshair,
  pattern: Repeat,
  weakness: Target,
  reinforcement: RefreshCw,
  integration: Layers,
  new: Sparkles,
  challenge: Gauge,
};

/** Icon for a recommendation reason. Pass `size` where no surrounding CSS sizes the svg. */
export function ReasonIcon({ kind, size }: { kind: ReasonKind; size?: number }) {
  const Icon = REASON_ICON[kind] ?? Sparkles;
  return size ? <Icon size={size} style={{ flex: 'none' }} /> : <Icon />;
}

export function NextPracticeHero({ recs, title = 'Your next best practice' }: { recs: Recommendation[]; title?: string }) {
  const { template, skill, module } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [showAlt, setShowAlt] = useState(false);
  const top = recs[0];
  if (!top) return null;
  const tpl = template(top.templateId);
  const mod = module(top.moduleId);

  const start = async (r: Recommendation) => {
    setBusy(true);
    try {
      const { attemptId } = await api.startAttempt({ templateId: r.templateId, difficulty: r.difficulty, focusSkills: r.focusSkills, source: 'recommended' });
      navigate(`/play/${attemptId}`);
    } catch (e) {
      toast((e as Error).message, 'danger');
      setBusy(false);
    }
  };

  return (
    <section className="hero-next fade-in">
      <div className="row between top wrap gap-16">
        <div className="col gap-6" style={{ minWidth: 0, flex: '1 1 380px' }}>
          <span className="eyebrow">{title}</span>
          <div className="row gap-10" style={{ gap: 12 }}>
            <ModuleIcon moduleId={top.moduleId} />
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: '1.45rem' }}>{top.title}</h2>
              <div className="row wrap gap-6" style={{ marginTop: 6 }}>
                <span className="meta-pill">{mod?.name}</span>
                <span className="meta-pill">
                  <Gauge /> Difficulty {top.difficulty}/5
                </span>
                <span className="meta-pill">
                  <Target /> ~{Math.round(top.expectedSuccess * 100)}% expected success
                </span>
                {tpl && (
                  <span className="meta-pill">
                    <Clock /> ~{tpl.estimatedMinutes} min
                  </span>
                )}
              </div>
            </div>
          </div>
          {top.focusSkills.length > 0 && (
            <div className="row wrap gap-6" style={{ marginTop: 4 }}>
              <span className="small" style={{ opacity: 0.8 }}>
                Focus:
              </span>
              {top.focusSkills.map((s) => (
                <span key={s} className="meta-pill" style={{ background: 'rgba(255,255,255,0.22)' }}>
                  {skill(s)?.name ?? s}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="col gap-6" style={{ alignItems: 'stretch', minWidth: 200 }}>
          <button className="btn btn-lg btn-light" disabled={busy} onClick={() => start(top)}>
            Start practice <ArrowRight />
          </button>
          {recs.length > 1 && (
            <button className="btn btn-sm btn-outline-light" onClick={() => setShowAlt((v) => !v)}>
              Other options {showAlt ? <ChevronUp /> : <ChevronDown />}
            </button>
          )}
        </div>
      </div>
      <div className="col gap-6" style={{ marginTop: 16 }}>
        <span className="eyebrow">Why SkillBridge picked this</span>
        <div className="grid grid-2" style={{ gap: 8 }}>
          {top.reasons.map((r, i) => (
            <div key={i} className="reason">
              <ReasonIcon kind={r.kind} />
              <span>{r.text}</span>
            </div>
          ))}
        </div>
      </div>
      {showAlt && (
        <div className="col gap-6" style={{ marginTop: 14 }}>
          {recs.slice(1).map((r) => (
            <div key={r.templateId} className="reason" style={{ alignItems: 'center' }}>
              <ModuleIcon moduleId={r.moduleId} size={28} />
              <div className="grow">
                <div className="bold">{r.title}</div>
                <div className="tiny" style={{ opacity: 0.85 }}>
                  Difficulty {r.difficulty}/5 · {r.reasons[0]?.text}
                </div>
              </div>
              <button className="btn btn-sm btn-light" disabled={busy} onClick={() => start(r)}>
                Start
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function RecommendationRow({ rec, onStart, busy }: { rec: Recommendation; onStart: () => void; busy?: boolean }) {
  return (
    <div className="row top gap-16" style={{ padding: '10px 0', borderTop: '1px dashed var(--border)' }}>
      <ModuleIcon moduleId={rec.moduleId} />
      <div className="grow">
        <div className="row wrap gap-6">
          <span className="bold">{rec.title}</span>
          <Difficulty value={rec.difficulty} />
        </div>
        <div className="small text-2" style={{ marginTop: 2 }}>
          {rec.reasons[0]?.text}
        </div>
      </div>
      <button className="btn btn-sm btn-soft" onClick={onStart} disabled={busy}>
        Start
      </button>
    </div>
  );
}
