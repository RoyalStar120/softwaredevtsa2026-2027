/**
 * Shared UI primitives used across the platform and by module workspaces.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle, Check, Minus, Lightbulb, ShieldAlert, TriangleAlert, Trash2 } from 'lucide-react';
import type { MasteryLevel, Tone, Verdict } from '../../../shared/types.ts';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card(props: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section className={cx('card', props.className)} style={props.style}>
      {(props.title || props.actions) && (
        <div className="card-header">
          <h3>
            {props.icon}
            {props.title}
          </h3>
          {props.actions && <div className="row gap-6">{props.actions}</div>}
        </div>
      )}
      <div className={cx('card-body', props.bodyClassName)}>{props.children}</div>
      {props.footer && <div className="card-footer">{props.footer}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const toneClass: Record<Tone, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  neutral: '',
  info: 'badge-info',
};

export function Badge(props: { tone?: Tone | 'primary' | 'elec' | 'prog'; children: ReactNode; title?: string; icon?: ReactNode }) {
  const t = props.tone ?? 'neutral';
  const cls = t === 'primary' ? 'badge-primary' : t === 'elec' ? 'badge-elec' : t === 'prog' ? 'badge-prog' : toneClass[t as Tone];
  return (
    <span className={cx('badge', cls)} title={props.title}>
      {props.icon}
      {props.children}
    </span>
  );
}

export const LEVEL_TEXT: Record<MasteryLevel, string> = {
  not_started: 'Not started',
  novice: 'Novice',
  developing: 'Developing',
  proficient: 'Proficient',
  mastered: 'Mastered',
};

export function LevelBadge({ level }: { level: MasteryLevel }) {
  return (
    <span className="level-badge" data-level={level}>
      {LEVEL_TEXT[level]}
    </span>
  );
}

export function levelColor(level: MasteryLevel): string {
  return `var(--lvl-${level})`;
}

export function VerdictIcon({ verdict }: { verdict: Verdict | null }) {
  const v = verdict ?? 'neutral';
  const icon =
    v === 'good' ? <Check /> : v === 'unsafe' ? <ShieldAlert /> : v === 'mistake' ? <X /> : v === 'wasted' ? <Trash2 /> : v === 'info' ? <Lightbulb /> : <Minus />;
  return (
    <span className="verdict" data-v={v} title={VERDICT_LABEL[v]}>
      {icon}
    </span>
  );
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  good: 'Effective step',
  neutral: 'Neutral',
  info: 'Note',
  wasted: 'Wasted / uninformative',
  mistake: 'Mistake',
  unsafe: 'Unsafe',
};

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export function ProgressBar(props: { value: number; color?: string; small?: boolean; title?: string }) {
  const v = Math.max(0, Math.min(1, props.value));
  return (
    <div className={cx('progress', props.small && 'sm')} title={props.title} role="progressbar" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${v * 100}%`, background: props.color }} />
    </div>
  );
}

export function Ring(props: { value: number; size?: number; stroke?: number; color?: string; label?: ReactNode; sub?: ReactNode; track?: string }) {
  const size = props.size ?? 64;
  const stroke = props.stroke ?? 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, props.value));
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={props.track ?? 'var(--surface-3)'} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={props.color ?? 'var(--primary)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', lineHeight: 1.05 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: size * 0.24 }}>{props.label ?? `${Math.round(v * 100)}`}</div>
          {props.sub && <div style={{ fontSize: Math.max(9, size * 0.13), color: 'var(--muted)', fontWeight: 600 }}>{props.sub}</div>}
        </div>
      </div>
    </div>
  );
}

export function scoreColor(score01: number): string {
  if (score01 >= 0.8) return 'var(--success-500)';
  if (score01 >= 0.6) return 'var(--warning-500)';
  return 'var(--danger-500)';
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

export function PageLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="page-loading">
      <div className="col" style={{ alignItems: 'center' }}>
        <Spinner size={26} />
        <span className="muted small">{label}</span>
      </div>
    </div>
  );
}

export function Empty(props: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      {props.icon}
      <div className="bold" style={{ color: 'var(--text-2)' }}>
        {props.title}
      </div>
      {props.children && <div className="small" style={{ marginTop: 4 }}>{props.children}</div>}
    </div>
  );
}

export function Callout(props: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const tone = props.tone ?? 'info';
  const icon =
    props.icon ??
    (tone === 'warning' ? <TriangleAlert /> : tone === 'danger' ? <AlertTriangle /> : tone === 'success' ? <CheckCircle2 /> : <Info />);
  return (
    <div className={cx('callout', `callout-${tone}`)}>
      {icon}
      <div className="callout-body">
        {props.title && <div className="bold" style={{ marginBottom: 2 }}>{props.title}</div>}
        {props.children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>(props: { tabs: Array<{ id: T; label: ReactNode; icon?: ReactNode }>; value: T; onChange: (id: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {props.tabs.map((t) => (
        <button key={t.id} className="tab" role="tab" aria-selected={props.value === t.id} onClick={() => props.onChange(t.id)}>
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>(props: { options: Array<{ id: T; label: ReactNode }>; value: T; onChange: (id: T) => void }) {
  return (
    <div className="segmented">
      {props.options.map((o) => (
        <button key={o.id} aria-pressed={props.value === o.id} onClick={() => props.onChange(o.id)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal(props: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.open, props.onClose]);
  if (!props.open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={cx('modal', props.wide && 'wide')} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{props.title}</h2>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={props.onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-footer">{props.footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface ToastItem {
  id: number;
  tone: 'success' | 'danger' | 'warning' | 'info';
  text: ReactNode;
}

const ToastCtx = createContext<(text: ReactNode, tone?: ToastItem['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(1);
  const push = useCallback((text: ReactNode, tone: ToastItem['tone'] = 'info') => {
    const id = idRef.current++;
    setItems((xs) => [...xs, { id, tone, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('toast', t.tone)}>
            {t.tone === 'success' ? <CheckCircle2 /> : t.tone === 'danger' ? <XCircle /> : t.tone === 'warning' ? <AlertTriangle /> : <Info />}
            <div>{t.text}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

// ---------------------------------------------------------------------------
// Safe mini-markdown (bold, italics, code, lists, paragraphs). No HTML injection.
// ---------------------------------------------------------------------------

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => {
    const lines = text.replace(/\r/g, '').split('\n');
    const result: ReactNode[] = [];
    let list: { ordered: boolean; items: string[] } | null = null;
    let para: string[] = [];
    const flushPara = () => {
      if (para.length) {
        result.push(<p key={`p${result.length}`}>{inline(para.join(' '), `p${result.length}`)}</p>);
        para = [];
      }
    };
    const flushList = () => {
      if (list) {
        const items = list.items.map((it, idx) => <li key={idx}>{inline(it, `l${result.length}-${idx}`)}</li>);
        result.push(list.ordered ? <ol key={`o${result.length}`}>{items}</ol> : <ul key={`u${result.length}`}>{items}</ul>);
        list = null;
      }
    };
    for (const raw of lines) {
      const line = raw.trim();
      const ul = line.match(/^[-*•]\s+(.*)$/);
      const ol = line.match(/^\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        flushPara();
        const ordered = !!ol;
        if (!list || list.ordered !== ordered) {
          flushList();
          list = { ordered, items: [] };
        }
        list.items.push((ul ?? ol)![1]);
      } else if (line === '') {
        flushPara();
        flushList();
      } else {
        flushList();
        para.push(line.replace(/^#+\s*/, ''));
      }
    }
    flushPara();
    flushList();
    return result;
  }, [text]);
  return <div className={cx('md', className)}>{blocks}</div>;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '-';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtAgo(t: number | null | undefined): string {
  if (!t) return 'never';
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString();
}

export function fmtDate(t: number | null | undefined): string {
  if (!t) return '-';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function Difficulty({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="row gap-4" title={`Difficulty ${value}/${max}`} aria-label={`Difficulty ${value} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} style={{ width: 6, height: 12, borderRadius: 2, background: i < value ? 'var(--primary)' : 'var(--surface-3)' }} />
      ))}
    </span>
  );
}
