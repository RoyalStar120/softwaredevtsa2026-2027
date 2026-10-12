/**
 * SVG schematic for the electrical troubleshooting workspace (and the debrief).
 *
 * Every component's polyline is drawn as wire; non-wire parts get a symbol at the
 * midpoint of their longest segment, oriented along it, with a gap in the wire.
 * Wires are NEVER colored by voltage (that would leak readings); only learner-
 * visible state is shown: switch positions, plugs, lockout, lamp glow, fan spin,
 * relay click, replaced parts and fuses that visibly blew.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ElecPublicState, ElecView, LoadView, PublicComp } from '../../../../shared/modules/electrical/types.ts';

export type Tool = 'probe' | 'inspect' | 'bench' | 'replace';
type Pt = [number, number];

export interface SchematicProps {
  view: ElecView;
  state?: ElecPublicState | null;
  interactive?: boolean;
  tool?: Tool;
  probes?: { red: string | null; black: string | null };
  activeProbe?: 'red' | 'black';
  /** Components outlined in red (debrief: the faulty parts). */
  highlight?: string[];
  onNodeClick?: (nodeId: string) => void;
  onCompClick?: (comp: PublicComp) => void;
  onToggle?: (comp: PublicComp) => void;
  /** Whether the current tool applies to a component (for cursor/dimming). */
  canUseTool?: (comp: PublicComp) => boolean;
}

const WIRE = '#9fb3d9';
const SYM = '#e8eefc';
const ACCENT = '#f59e0b';
const RED = '#ff6b57';

const HALF: Record<string, number> = {
  battery: 22,
  disconnect: 26,
  fuse: 22,
  switch: 22,
  thermostat: 22,
  lamp: 18,
  motor: 18,
  connector: 18,
  relay_coil: 16,
  relay_contact: 22,
};

interface Geo {
  mx: number;
  my: number;
  ux: number;
  uy: number;
  angle: number;
  half: number;
  before: Pt[];
  after: Pt[];
}

function geometry(c: PublicComp): Geo {
  const pts = c.pts.length >= 2 ? c.pts : [c.pts[0] ?? [0, 0], c.pts[0] ?? [0, 0]];
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  const [x0, y0] = pts[best];
  const [x1, y1] = pts[best + 1];
  const len = Math.max(1, bestLen);
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const half = c.kind === 'wire' ? 0 : Math.min(HALF[c.kind] ?? 20, len / 2 - 2);
  return {
    mx,
    my,
    ux,
    uy,
    angle: (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI,
    half,
    before: [...pts.slice(0, best + 1), [mx - ux * half, my - uy * half]],
    after: [[mx + ux * half, my + uy * half], ...pts.slice(best + 1)],
  };
}

/** Local symbol coordinates (x along the part, y across it) -> schematic coordinates. */
const toGlobal = (g: Geo, lx: number, ly: number): Pt => [g.mx + lx * g.ux - ly * g.uy, g.my + lx * g.uy + ly * g.ux];
const ptsAttr = (pts: Pt[]) => pts.map((p) => `${p[0]},${p[1]}`).join(' ');

function anchorFor(nx: number): 'start' | 'middle' | 'end' {
  if (nx > 0.5) return 'start';
  if (nx < -0.5) return 'end';
  return 'middle';
}

function GroundSymbol({ x, y, angle }: { x: number; y: number; angle: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`} stroke={WIRE} strokeWidth={2} strokeLinecap="round">
      <line x1={0} y1={0} x2={6} y2={0} />
      <line x1={6} y1={-10} x2={6} y2={10} />
      <line x1={10.5} y1={-6.5} x2={10.5} y2={6.5} />
      <line x1={15} y1={-3} x2={15} y2={3} />
    </g>
  );
}

function Padlock({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="elec-lock">
      <path d="M -4.5 -2 V -6 a 4.5 4.5 0 0 1 9 0 V -2" fill="none" stroke={ACCENT} strokeWidth={2} />
      <rect x={-7} y={-2.5} width={14} height={11} rx={2} fill={ACCENT} />
      <circle cx={0} cy={2.5} r={1.6} fill="#1b1305" />
      <path d="M 7 4 l 9 4 l -2 5 l -9 -4 z" fill={RED} />
    </g>
  );
}

interface CompVisual {
  closed: boolean;
  plugged: boolean;
  energized: boolean;
  load?: LoadView;
  blown: boolean;
}

function SymbolBody({ comp, v, h, clickPulse }: { comp: PublicComp; v: CompVisual; h: number; clickPulse: number }): ReactNode {
  const lead = (from: number, to: number) => <line x1={from} y1={0} x2={to} y2={0} stroke={WIRE} strokeWidth={2} />;
  switch (comp.kind) {
    case 'battery':
      return (
        <g>
          {lead(-h, -9)}
          {lead(9, h)}
          <line x1={-9} y1={-6} x2={-9} y2={6} stroke={SYM} strokeWidth={3.5} />
          <line x1={-3} y1={-13} x2={-3} y2={13} stroke={SYM} strokeWidth={2} />
          <line x1={3} y1={-6} x2={3} y2={6} stroke={SYM} strokeWidth={3.5} />
          <line x1={9} y1={-13} x2={9} y2={13} stroke={SYM} strokeWidth={2} />
        </g>
      );
    case 'disconnect': {
      const end: Pt = v.closed ? [16, 0] : [-16 + 32 * Math.cos(-0.62), 32 * Math.sin(-0.62)];
      return (
        <g>
          {lead(-h, -16)}
          {lead(16, h)}
          <rect x={-h + 2} y={-15} width={2 * h - 4} height={30} rx={6} fill="none" stroke="rgba(232,238,252,0.22)" strokeDasharray="3 3" />
          <circle cx={-16} cy={0} r={3} fill={SYM} />
          <circle cx={16} cy={0} r={3} fill="none" stroke={SYM} strokeWidth={2} />
          <line x1={-16} y1={0} x2={end[0]} y2={end[1]} stroke={SYM} strokeWidth={3} strokeLinecap="round" className="elec-lever" />
          <circle cx={end[0]} cy={end[1]} r={3.2} fill={v.closed ? ACCENT : SYM} />
        </g>
      );
    }
    case 'fuse':
      return (
        <g>
          {lead(-h, -14)}
          {lead(14, h)}
          <rect x={-14} y={-7} width={28} height={14} rx={7} fill="rgba(232,238,252,0.06)" stroke={SYM} strokeWidth={2} />
          {v.blown ? (
            <g stroke={RED} strokeWidth={1.8} fill="none" strokeLinecap="round">
              <path d="M -11 0 C -7 -6, -4 -6, -2 -2" />
              <path d="M 2 2 C 4 6, 7 6, 11 0" />
              <path d="M -1 -6 l 2 3 l -2 2 l 2 3" stroke={ACCENT} />
            </g>
          ) : (
            <path d="M -11 0 C -6 -8, -1 -8, 0 0 S 6 8, 11 0" fill="none" stroke={SYM} strokeWidth={1.8} />
          )}
        </g>
      );
    case 'switch':
    case 'thermostat':
    case 'relay_contact': {
      const end: Pt = v.closed ? [12, 0] : [-12 + 26 * Math.cos(-0.52), 26 * Math.sin(-0.52)];
      return (
        <g>
          {lead(-h, -12)}
          {lead(12, h)}
          <circle cx={-12} cy={0} r={2.8} fill={SYM} />
          <circle cx={12} cy={0} r={2.8} fill={SYM} />
          {comp.kind === 'relay_contact' && <line x1={0} y1={v.closed ? 0 : -6.5} x2={0} y2={-17} stroke={ACCENT} strokeWidth={1.4} strokeDasharray="2 2" />}
          {comp.kind === 'thermostat' && (
            <path d="M -8 9 q 4 -4 8 0 t 8 0" fill="none" stroke={v.closed ? ACCENT : '#60a5fa'} strokeWidth={1.6} />
          )}
          <line x1={-12} y1={0} x2={end[0]} y2={end[1]} stroke={SYM} strokeWidth={2.6} strokeLinecap="round" className="elec-lever" />
        </g>
      );
    }
    case 'lamp': {
      const intensity = Math.max(0, Math.min(1, v.load?.intensity ?? 0));
      return (
        <g>
          {intensity > 0.02 && <circle r={38} fill="url(#elec-glow)" opacity={0.25 + 0.75 * intensity} className="elec-glow" />}
          {lead(-h, -14)}
          {lead(14, h)}
          <circle r={14} fill={intensity > 0.02 ? `rgba(255, 214, 102, ${0.15 + 0.5 * intensity})` : 'rgba(232,238,252,0.05)'} stroke={SYM} strokeWidth={2} />
          <line x1={-9.9} y1={-9.9} x2={9.9} y2={9.9} stroke={SYM} strokeWidth={1.8} />
          <line x1={-9.9} y1={9.9} x2={9.9} y2={-9.9} stroke={SYM} strokeWidth={1.8} />
        </g>
      );
    }
    case 'motor': {
      const level = v.load?.level;
      return (
        <g>
          {lead(-h, -14)}
          {lead(14, h)}
          <circle r={14} fill="rgba(232,238,252,0.05)" stroke={SYM} strokeWidth={2} />
          <g className={`elec-fan ${level === 'running' ? 'is-running' : level === 'slow' ? 'is-slow' : ''}`}>
            {[0, 120, 240].map((a) => (
              <ellipse key={a} cx={0} cy={-6} rx={3.2} ry={6} fill={level === 'running' || level === 'slow' ? '#a7f3c5' : SYM} opacity={0.85} transform={`rotate(${a})`} />
            ))}
            <circle r={2.4} fill={SYM} />
          </g>
        </g>
      );
    }
    case 'connector': {
      const gap = v.plugged ? 0 : 5;
      return (
        <g>
          {lead(-h, -14 - gap)}
          {lead(14 + gap, h)}
          <rect x={-14 - gap} y={-8} width={10} height={16} rx={2} fill="rgba(232,238,252,0.08)" stroke={SYM} strokeWidth={1.8} />
          <rect x={4 + gap} y={-8} width={10} height={16} rx={2} fill="rgba(232,238,252,0.08)" stroke={SYM} strokeWidth={1.8} />
          <line x1={-4 - gap} y1={-3.5} x2={v.plugged ? 4 : -gap} y2={-3.5} stroke={SYM} strokeWidth={1.6} />
          <line x1={-4 - gap} y1={3.5} x2={v.plugged ? 4 : -gap} y2={3.5} stroke={SYM} strokeWidth={1.6} />
        </g>
      );
    }
    case 'relay_coil':
      return (
        <g>
          {v.energized && <rect x={-17} y={-19} width={34} height={38} rx={6} fill="rgba(245, 158, 11, 0.16)" stroke="rgba(245, 158, 11, 0.55)" />}
          {v.energized && clickPulse > 0 && <circle key={clickPulse} r={16} fill="none" stroke={ACCENT} strokeWidth={2} className="elec-click-ring" />}
          {lead(-h, -11)}
          {lead(11, h)}
          <rect x={-11} y={-14} width={22} height={28} rx={2} fill="rgba(232,238,252,0.05)" stroke={v.energized ? ACCENT : SYM} strokeWidth={2} />
          <line x1={-11} y1={14} x2={11} y2={-14} stroke={v.energized ? ACCENT : SYM} strokeWidth={1.6} />
        </g>
      );
    default:
      return null;
  }
}

export function Schematic(props: SchematicProps) {
  const { view, state } = props;
  const interactive = props.interactive !== false;
  const geos = useMemo(() => new Map(view.comps.map((c) => [c.id, geometry(c)])), [view.comps]);
  const nodeById = useMemo(() => new Map(view.nodes.map((n) => [n.id, n])), [view.nodes]);
  const highlight = useMemo(() => new Set(props.highlight ?? []), [props.highlight]);
  const [hover, setHover] = useState<string | null>(null);

  const loads = state?.loads ?? [];
  const loadById = new Map(loads.map((l) => [l.id, l]));
  const energized = (coilId: string | undefined) => !!coilId && loadById.get(coilId)?.level === 'energized';

  // Relay "click" pulse whenever a coil becomes energized.
  const prevEnergized = useRef<Record<string, boolean>>({});
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const energizedKey = loads.filter((l) => l.kind === 'relay' && l.level === 'energized').map((l) => l.id).join(',');
  useEffect(() => {
    const now = new Set(energizedKey ? energizedKey.split(',') : []);
    const next: Record<string, number> = {};
    let changed = false;
    for (const id of now) {
      if (!prevEnergized.current[id]) {
        next[id] = (pulses[id] ?? 0) + 1;
        changed = true;
      }
    }
    prevEnergized.current = Object.fromEntries([...now].map((id) => [id, true]));
    if (changed) setPulses((p) => ({ ...p, ...next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [energizedKey]);

  const visual = (c: PublicComp): CompVisual => {
    const lastReplace = Math.max(-1, ...(state?.replaced ?? []).filter((r) => r.comp === c.id).map((r) => r.seq));
    const blown = c.kind === 'fuse' && (state?.fuseEvents ?? []).some((f) => f.comp === c.id && f.seq > lastReplace);
    let closed = true;
    if (c.kind === 'disconnect') closed = state ? state.power : true;
    else if (c.kind === 'switch' || c.kind === 'thermostat') closed = state ? !!state.switches[c.id] : true;
    else if (c.kind === 'relay_contact') closed = energized(c.coil);
    return {
      closed,
      plugged: state ? state.plugged[c.id] !== false : true,
      energized: c.kind === 'relay_coil' ? energized(c.id) : false,
      load: loadById.get(c.id),
      blown,
    };
  };

  const isControl = (c: PublicComp) => c.control === 'switch' || c.control === 'thermostat' || c.control === 'plug' || c.control === 'power';
  const replaced = new Set((state?.replaced ?? []).map((r) => r.comp));

  // Coil <-> contact links (same replaceable unit).
  const unitLinks = useMemo(() => {
    const out: Array<{ key: string; d: string }> = [];
    const coils = view.comps.filter((c) => c.kind === 'relay_coil');
    for (const coil of coils) {
      const g1 = geos.get(coil.id)!;
      for (const contact of view.comps.filter((c) => c.kind === 'relay_contact' && (c.coil === coil.id || (c.unit && c.unit === coil.unit)))) {
        const g2 = geos.get(contact.id)!;
        const [sx, sy] = toGlobal(g1, 0, g1.ux === 0 ? 0 : 18);
        const [ex, ey] = toGlobal(g2, 0, -17);
        out.push({ key: `${coil.id}-${contact.id}`, d: `M ${g1.ux === 0 ? sx - 18 : sx} ${sy} H ${ex} V ${ey}` });
      }
    }
    return out;
  }, [view.comps, geos]);

  const groundNode = nodeById.get(view.ground);
  const probes = props.probes ?? { red: null, black: null };

  return (
    <svg
      className={`elec-schematic ${interactive ? `is-interactive tool-${props.tool ?? 'probe'}` : ''}`}
      viewBox={`0 0 ${view.width} ${view.height}`}
      role="img"
      aria-label="Circuit schematic"
    >
      <defs>
        <pattern id="elec-grid" width={20} height={20} patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(130,145,179,0.08)" strokeWidth={1} />
        </pattern>
        <radialGradient id="elec-glow">
          <stop offset="0%" stopColor="#ffe08a" stopOpacity={0.95} />
          <stop offset="45%" stopColor="#ffc93c" stopOpacity={0.4} />
          <stop offset="100%" stopColor="#ffb000" stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={view.width} height={view.height} fill="url(#elec-grid)" />

      {/* Highlighted (faulty) parts underlay */}
      {view.comps
        .filter((c) => highlight.has(c.id))
        .map((c) => (
          <polyline key={`hl-${c.id}`} points={ptsAttr(c.pts)} fill="none" stroke={RED} strokeWidth={9} strokeOpacity={0.35} strokeLinecap="round" strokeLinejoin="round" />
        ))}

      {/* Unit links (relay coil <-> contacts) */}
      {unitLinks.map((l) => (
        <path key={l.key} d={l.d} fill="none" stroke={ACCENT} strokeOpacity={0.45} strokeWidth={1.4} strokeDasharray="4 4" />
      ))}

      {/* Wires and leads */}
      {view.comps.map((c) => {
        const g = geos.get(c.id)!;
        return c.kind === 'wire' ? (
          <polyline key={`w-${c.id}`} points={ptsAttr(c.pts)} fill="none" stroke={WIRE} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <g key={`w-${c.id}`} stroke={WIRE} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <polyline points={ptsAttr(g.before)} />
            <polyline points={ptsAttr(g.after)} />
          </g>
        );
      })}

      {/* Ground symbols */}
      {groundNode && <GroundSymbol x={groundNode.x} y={groundNode.y} angle={90} />}
      {view.comps
        .filter((c) => c.groundEnd && c.pts.length >= 2)
        .map((c) => {
          const p = c.pts[c.pts.length - 1];
          const q = c.pts[c.pts.length - 2];
          return <GroundSymbol key={`g-${c.id}`} x={p[0]} y={p[1]} angle={(Math.atan2(p[1] - q[1], p[0] - q[0]) * 180) / Math.PI} />;
        })}

      {/* Components */}
      {view.comps.map((c) => {
        const g = geos.get(c.id)!;
        const v = visual(c);
        const usable = interactive && (props.canUseTool ? props.canUseTool(c) : false);
        const nx = g.uy;
        const ny = -g.ux;
        const off = c.kind === 'wire' ? 12 : g.half + 12;
        const lx = g.mx + nx * off;
        const ly = g.my + ny * off + (Math.abs(ny) < 0.5 ? 4 : 0);
        const anchor = anchorFor(nx);
        const title = `${c.label}: ${c.spec}${c.replaceable ? ` · replacement $${c.cost}` : ''}`;
        const toggleable = interactive && isControl(c) && !!props.onToggle;
        const onClick = () => {
          if (!interactive) return;
          if (props.tool === 'probe' || !props.tool) {
            if (toggleable) props.onToggle!(c);
            return;
          }
          props.onCompClick?.(c);
        };
        const leverEnd: Pt | null =
          c.kind === 'switch' || c.kind === 'thermostat'
            ? v.closed
              ? [12, 0]
              : [-12 + 26 * Math.cos(-0.52), 26 * Math.sin(-0.52)]
            : c.kind === 'disconnect'
              ? v.closed
                ? [16, 0]
                : [-16 + 32 * Math.cos(-0.62), 32 * Math.sin(-0.62)]
              : c.kind === 'connector' && c.control === 'plug'
                ? [9 + (v.plugged ? 0 : 5), 0]
                : null;
        return (
          <g
            key={c.id}
            className={`elec-comp kind-${c.kind}${hover === c.id ? ' is-hover' : ''}${usable ? ' is-usable' : ''}${toggleable ? ' is-control' : ''}${highlight.has(c.id) ? ' is-highlight' : ''}`}
            onMouseEnter={() => interactive && setHover(c.id)}
            onMouseLeave={() => interactive && setHover((h) => (h === c.id ? null : h))}
            onClick={onClick}
          >
            <title>{title}</title>
            {interactive && <polyline points={ptsAttr(c.pts)} fill="none" stroke="transparent" strokeWidth={14} className="elec-hit" />}
            {c.kind !== 'wire' && (
              <g transform={`translate(${g.mx} ${g.my}) rotate(${g.angle})`}>
                {interactive && <rect x={-g.half - 4} y={-20} width={2 * g.half + 8} height={40} fill="transparent" className="elec-hit" />}
                {highlight.has(c.id) && (
                  <rect x={-g.half - 7} y={-22} width={2 * g.half + 14} height={44} rx={8} fill="none" stroke={RED} strokeWidth={2} strokeDasharray="5 3" />
                )}
                <SymbolBody comp={c} v={v} h={g.half} clickPulse={pulses[c.id] ?? 0} />
                {toggleable && leverEnd && (
                  <circle
                    cx={leverEnd[0]}
                    cy={leverEnd[1]}
                    r={9}
                    className="elec-toggle-hot"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onToggle!(c);
                    }}
                  >
                    <title>{c.control === 'plug' ? (v.plugged ? `Unplug ${c.label}` : `Plug in ${c.label}`) : `Toggle ${c.label}`}</title>
                  </circle>
                )}
              </g>
            )}
            <text x={lx} y={ly} textAnchor={anchor} className="elec-label">
              {c.id}
            </text>
            {c.kind === 'thermostat' && (
              <text x={lx} y={ly + 13} textAnchor={anchor} className={`elec-sublabel ${v.closed ? 'is-hot' : 'is-cold'}`}>
                {v.closed ? 'HOT' : 'COLD'}
              </text>
            )}
            {c.kind === 'disconnect' && (
              <text x={lx} y={ly + 13} textAnchor={anchor} className={`elec-sublabel ${v.closed ? 'is-on' : 'is-off'}`}>
                {v.closed ? 'ON' : 'OFF'}
              </text>
            )}
            {c.kind === 'connector' && !v.plugged && (
              <text x={lx} y={ly + 13} textAnchor={anchor} className="elec-sublabel is-off">
                UNPLUGGED
              </text>
            )}
            {replaced.has(c.id) && (
              <g transform={`translate(${anchor === 'end' ? lx - 30 : anchor === 'start' ? lx : lx - 15} ${ly + (c.kind === 'thermostat' || c.kind === 'disconnect' ? 18 : 5)})`}>
                <rect width={30} height={13} rx={6.5} fill="#16a34a" />
                <text x={15} y={9.5} textAnchor="middle" className="elec-new">
                  NEW
                </text>
              </g>
            )}
            {c.kind === 'battery' &&
              (() => {
                const [px, py] = toGlobal(g, 15, -15);
                const [mx2, my2] = toGlobal(g, -15, -15);
                return (
                  <>
                    <text x={px} y={py + 4} textAnchor="middle" className="elec-polarity">
                      +
                    </text>
                    <text x={mx2} y={my2 + 4} textAnchor="middle" className="elec-polarity">
                      −
                    </text>
                  </>
                );
              })()}
            {c.kind === 'disconnect' && state?.lockout && (() => {
              const [px, py] = toGlobal(g, 0, 28);
              return <Padlock x={px} y={py} />;
            })()}
          </g>
        );
      })}

      {/* Test points */}
      {view.nodes.map((n) => {
        const isRed = probes.red === n.id;
        const isBlack = probes.black === n.id;
        const clickable = interactive && (props.tool ?? 'probe') === 'probe' && !!props.onNodeClick;
        return (
          <g
            key={n.id}
            className={`elec-node${clickable ? ' is-clickable' : ''}${n.id === view.ground ? ' is-ground' : ''}`}
            onClick={(e) => {
              if (!clickable) return;
              e.stopPropagation();
              props.onNodeClick!(n.id);
            }}
          >
            <title>{clickable ? `Place the ${props.activeProbe === 'black' ? 'BLACK' : 'RED'} probe on ${n.label}` : n.label}</title>
            {clickable && <circle cx={n.x} cy={n.y} r={13} fill="transparent" />}
            <circle cx={n.x} cy={n.y} r={6} className="elec-tp" />
            <circle cx={n.x} cy={n.y} r={2.2} fill={WIRE} />
            {isBlack && <circle cx={n.x} cy={n.y} r={isRed ? 15 : 11} fill="none" stroke="#cbd5e1" strokeWidth={3} className="elec-probe" />}
            {isRed && <circle cx={n.x} cy={n.y} r={11} fill="none" stroke="#ff4d4f" strokeWidth={3} className="elec-probe" />}
            {isRed && (
              <g transform={`translate(${n.x + 12} ${n.y - 22})`}>
                <rect width={20} height={14} rx={3} fill="#ff4d4f" />
                <text x={10} y={10.5} textAnchor="middle" className="elec-probe-tag">
                  +
                </text>
              </g>
            )}
            {isBlack && (
              <g transform={`translate(${n.x - 32} ${n.y - 22})`}>
                <rect width={20} height={14} rx={3} fill="#334155" stroke="#cbd5e1" />
                <text x={10} y={10.5} textAnchor="middle" className="elec-probe-tag">
                  −
                </text>
              </g>
            )}
            <text x={n.x + 9} y={n.y + 17} className="elec-tp-label">
              {n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default Schematic;
