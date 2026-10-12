/**
 * Lightweight SVG charts (no chart library): line chart, sparkline, radar, bar list.
 */

import { useMemo, useState, type ReactNode } from 'react';

export interface Series {
  id: string;
  label: string;
  color: string;
  points: Array<{ x: number; y: number; label?: string }>;
}

export function LineChart(props: {
  series: Series[];
  height?: number;
  yMin?: number;
  yMax?: number;
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  bands?: Array<{ from: number; to: number; color: string; label?: string }>;
  emptyText?: string;
}) {
  const height = props.height ?? 220;
  const width = 640;
  const pad = { l: 40, r: 12, t: 12, b: 26 };
  const all = props.series.flatMap((s) => s.points);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  if (all.length === 0) return <div className="empty small">{props.emptyText ?? 'No data yet.'}</div>;
  const xMin = Math.min(...all.map((p) => p.x));
  const xMax = Math.max(...all.map((p) => p.x));
  const yMin = props.yMin ?? Math.min(...all.map((p) => p.y));
  const yMax = props.yMax ?? Math.max(...all.map((p) => p.y));
  const sx = (x: number) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * (width - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - (y - yMin) / (yMax - yMin || 1)) * (height - pad.t - pad.b);
  const yTicks = 4;
  const fmtY = props.yFormat ?? ((v: number) => String(Math.round(v)));
  const fmtX = props.xFormat ?? ((v: number) => String(v));
  const tickCount = Math.min(6, new Set(all.map((p) => p.x)).size);
  const xTicks: number[] = Array.from({ length: tickCount }, (_, i) => xMin + ((xMax - xMin) * i) / Math.max(1, tickCount - 1));
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img">
        {props.bands?.map((b, i) => (
          <rect key={i} x={pad.l} width={width - pad.l - pad.r} y={sy(b.to)} height={Math.max(0, sy(b.from) - sy(b.to))} fill={b.color} opacity={0.08} />
        ))}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = yMin + ((yMax - yMin) * i) / yTicks;
          return (
            <g key={i}>
              <line x1={pad.l} x2={width - pad.r} y1={sy(v)} y2={sy(v)} stroke="var(--border)" strokeDasharray="3 4" />
              <text x={pad.l - 6} y={sy(v) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">
                {fmtY(v)}
              </text>
            </g>
          );
        })}
        {xTicks.map((x, i) => (
          <text key={i} x={sx(x)} y={height - 6} fontSize="10" textAnchor="middle" fill="var(--muted)">
            {fmtX(x)}
          </text>
        ))}
        {props.series.map((s) => {
          const pts = [...s.points].sort((a, b) => a.x - b.x);
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
          return (
            <g key={s.id}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, i) => (
                <circle
                  key={i}
                  cx={sx(p.x)}
                  cy={sy(p.y)}
                  r={3.6}
                  fill="var(--surface)"
                  stroke={s.color}
                  strokeWidth={2}
                  onMouseEnter={() => setHover({ x: sx(p.x), y: sy(p.y), text: `${s.label}: ${p.label ?? fmtY(p.y)}` })}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div
          style={{
            position: 'absolute',
            left: `${(hover.x / width) * 100}%`,
            top: `${(hover.y / height) * 100}%`,
            transform: 'translate(-50%, -130%)',
            background: 'var(--panel)',
            color: 'var(--panel-text)',
            fontSize: 12,
            padding: '4px 8px',
            borderRadius: 6,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {hover.text}
        </div>
      )}
      {props.series.length > 1 && (
        <div className="row wrap gap-16 small" style={{ marginTop: 6 }}>
          {props.series.map((s) => (
            <span key={s.id} className="row gap-6">
              <span className="dot" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, color = 'var(--primary)', width = 110, height = 30 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return <span className="muted tiny">-</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (width - 4) + 2},${height - 2 - ((v - min) / (max - min || 1)) * (height - 4)}`);
  return (
    <svg width={width} height={height}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RadarChart(props: { axes: Array<{ id: string; label: string; value: number; color?: string }>; size?: number; color?: string }) {
  const size = props.size ?? 260;
  const c = size / 2;
  const r = size / 2 - 42;
  const n = props.axes.length;
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const point = (i: number, v: number) => [c + Math.cos(angle(i)) * r * v, c + Math.sin(angle(i)) * r * v];
  const poly = props.axes.map((a, i) => point(i, Math.max(0.02, a.value)).join(',')).join(' ');
  const color = props.color ?? 'var(--primary)';
  if (n < 3) return null;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size }}>
      {[0.25, 0.5, 0.75, 1].map((lv) => (
        <polygon key={lv} points={props.axes.map((_, i) => point(i, lv).join(',')).join(' ')} fill="none" stroke="var(--border)" />
      ))}
      {props.axes.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="var(--border)" />;
      })}
      <polygon points={poly} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={2} />
      {props.axes.map((a, i) => {
        const [x, y] = point(i, Math.max(0.02, a.value));
        return <circle key={a.id} cx={x} cy={y} r={3.5} fill={color} />;
      })}
      {props.axes.map((a, i) => {
        const [x, y] = point(i, 1.22);
        return (
          <text key={a.id} x={x} y={y} fontSize="10.5" fontWeight={600} textAnchor="middle" dominantBaseline="middle" fill="var(--text-2)">
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}

export function BarList(props: { items: Array<{ id: string; label: ReactNode; value: number; max?: number; color?: string; right?: ReactNode }> }) {
  const max = useMemo(() => Math.max(1, ...props.items.map((i) => i.max ?? i.value)), [props.items]);
  return (
    <div className="col gap-6">
      {props.items.map((it) => (
        <div key={it.id}>
          <div className="row between small" style={{ marginBottom: 3 }}>
            <span className="grow" style={{ minWidth: 0 }}>
              {it.label}
            </span>
            <span className="muted">{it.right ?? it.value}</span>
          </div>
          <div className="progress sm">
            <span style={{ width: `${(it.value / max) * 100}%`, background: it.color ?? 'var(--primary)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function masteryColor(m: number, evidence: number): string {
  if (evidence === 0) return 'var(--lvl-not_started)';
  if (m < 0.4) return 'var(--lvl-novice)';
  if (m < 0.65) return 'var(--lvl-developing)';
  if (m < 0.85) return 'var(--lvl-proficient)';
  return 'var(--lvl-mastered)';
}
