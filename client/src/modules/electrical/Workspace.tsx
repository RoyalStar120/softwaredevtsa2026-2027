/**
 * Electrical troubleshooting workspace: interactive schematic, multimeter,
 * tools (probe / inspect / bench test / replace), controls, loads, work log and
 * the diagnosis + work-order completion flow. Every action goes to the
 * server-authoritative simulation; this component only renders learner-visible state.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardCheck,
  ClipboardList,
  Fan,
  Lightbulb,
  Lock,
  LockOpen,
  Plus,
  Power,
  Search,
  ShieldAlert,
  Trash2,
  Wrench,
  X,
  Zap,
  FlaskConical,
  Crosshair,
} from 'lucide-react';
import type { ModuleAction } from '../../../../shared/types.ts';
import type { ActionResponse, PublicLogEntry } from '../../../../shared/api.ts';
import type { ElecPublicState, ElecView, FaultType, LoadView, MeterMode, PublicComp } from '../../../../shared/modules/electrical/types.ts';
import type { WorkspaceProps } from '../types.ts';
import { Badge, Callout, Modal, Segmented, cx, fmtDuration, useToast } from '../../components/ui.tsx';
import { Schematic, type Tool } from './Schematic.tsx';
import { Multimeter, type ProbeColor } from './Multimeter.tsx';
import './electrical.css';

const TOOL_HINT: Record<Tool, string> = {
  probe: 'Click test points to place the RED probe, then the BLACK probe. Click a switch lever or plug to operate it.',
  inspect: 'Click any part to look at it closely.',
  bench: 'Click a part to remove it and test it on the bench with the meter.',
  replace: 'Click a part to replace it. Every part costs money, so replace only what your evidence supports.',
};

const LEVEL_TONE: Record<LoadView['level'], 'on' | 'partial' | 'off'> = {
  normal: 'on',
  running: 'on',
  energized: 'on',
  dim: 'partial',
  slow: 'partial',
  off: 'off',
  stopped: 'off',
  idle: 'off',
};

type DiagRow = { comp: string; type: FaultType | '' };

export function Workspace(props: WorkspaceProps<ElecView, ElecPublicState>) {
  const { scenario, publicState: ps, log, mode, busy, dispatch, submit } = props;
  const view = scenario.view;
  const toast = useToast();

  const [tool, setTool] = useState<Tool>('probe');
  const [meterMode, setMeterMode] = useState<MeterMode>('V');
  const [probes, setProbes] = useState<{ red: string | null; black: string | null }>(() => ({
    red: ps?.lastReading?.red ?? null,
    black: ps?.lastReading?.black ?? null,
  }));
  const [active, setActive] = useState<ProbeColor>('red');
  const [pending, setPending] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState<PublicComp | null>(null);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [showSafety, setShowSafety] = useState(true);
  const [rows, setRows] = useState<DiagRow[]>(() =>
    ps?.diagnosis?.length ? ps.diagnosis.map((d) => ({ comp: d.comp, type: d.type })) : [{ comp: '', type: '' }],
  );

  const compById = useMemo(() => new Map(view.comps.map((c) => [c.id, c])), [view.comps]);
  const nodeLabel = useCallback((id: string) => view.nodes.find((n) => n.id === id)?.label ?? id, [view.nodes]);
  const working = busy || pending;

  /** Sends an action and surfaces the engine's message / error as a toast. */
  const act = useCallback(
    async (action: ModuleAction): Promise<ActionResponse | null> => {
      setPending(true);
      try {
        const res = await dispatch(action);
        if (!res.ok) toast(res.error ?? 'That action was not possible.', 'danger');
        else if (res.message) {
          const t = res.messageTone;
          toast(res.message, t === 'danger' ? 'danger' : t === 'warning' ? 'warning' : t === 'success' ? 'success' : 'info');
        }
        return res;
      } catch (e) {
        toast(String(e), 'danger');
        return null;
      } finally {
        setPending(false);
      }
    },
    [dispatch, toast],
  );

  // ---- controls -----------------------------------------------------------
  const setPower = (on: boolean) => {
    if (on && ps?.lockout) {
      toast('Remove your lockout tag before restoring power.', 'warning');
      return;
    }
    void act({ type: 'set_power', payload: { on } });
  };
  const toggleComp = (c: PublicComp) => {
    if (!ps) return;
    if (c.control === 'power') setPower(!ps.power);
    else if (c.control === 'switch' || c.control === 'thermostat') void act({ type: 'toggle', payload: { comp: c.id, on: !ps.switches[c.id] } });
    else if (c.control === 'plug') void act({ type: 'set_plug', payload: { comp: c.id, plugged: ps.plugged[c.id] === false } });
  };

  // ---- meter --------------------------------------------------------------
  const placeProbe = (nodeId: string) => {
    setProbes((p) => ({ ...p, [active]: nodeId }));
    setActive((a) => (a === 'red' ? 'black' : 'red'));
  };
  const measure = useCallback(() => {
    if (!probes.red || !probes.black || working) return;
    void act({ type: 'measure', payload: { mode: meterMode, red: probes.red, black: probes.black } });
  }, [probes, meterMode, working, act]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.closest('input, select, textarea, button, [role="dialog"]') || el.isContentEditable)) return;
      if (probes.red && probes.black) {
        e.preventDefault();
        measure();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [measure, probes]);

  // ---- tools --------------------------------------------------------------
  const canUseTool = useCallback(
    (c: PublicComp) => {
      if (tool === 'inspect') return true;
      if (tool === 'bench') return c.replaceable && c.kind !== 'relay_contact';
      if (tool === 'replace') return c.replaceable;
      return false;
    },
    [tool],
  );
  const onCompClick = (c: PublicComp) => {
    if (tool === 'inspect') void act({ type: 'inspect', payload: { comp: c.id } });
    else if (tool === 'bench') {
      if (!canUseTool(c)) toast(`${c.label} can't be bench-tested on its own.`, 'warning');
      else void act({ type: 'bench_test', payload: { comp: c.id } });
    } else if (tool === 'replace') {
      if (!c.replaceable) toast(`${c.label} is not a replaceable part.`, 'warning');
      else setConfirmReplace(c);
    }
  };

  // ---- diagnosis ----------------------------------------------------------
  const replaceable = view.comps.filter((c) => c.replaceable && (view.faultOptions[c.id]?.length ?? 0) > 0);
  const validRows = rows.filter((r) => r.comp && r.type) as Array<{ comp: string; type: FaultType }>;
  const dupe = new Set(validRows.map((r) => `${r.comp}:${r.type}`)).size !== validRows.length;
  const recordDiagnosis = () => {
    if (!validRows.length || dupe) return;
    void act({ type: 'diagnose', payload: { faults: validRows } });
  };
  const faultLabel = (comp: string, type: FaultType) => view.faultOptions[comp]?.find((o) => o.type === type)?.label ?? type;

  const switches = view.comps.filter((c) => c.control === 'switch' || c.control === 'thermostat');
  const plugs = view.comps.filter((c) => c.control === 'plug');
  const loads = ps?.loads ?? [];
  const entries = [...log].reverse();
  const replacedList = ps?.replaced ?? [];

  return (
    <div className="elec-ws">
      {showSafety && view.safetyNotice && (
        <div className="elec-safety" role="note">
          <ShieldAlert />
          <span className="grow">{view.safetyNotice}</span>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowSafety(false)} aria-label="Dismiss safety notice">
            <X />
          </button>
        </div>
      )}

      <div className="elec-top">
        <section className="panel elec-schem-panel">
          <div className="panel-head">
            <span className="row gap-6">
              <Zap className="elec-head-icon" /> Schematic
            </span>
            <span className="row gap-6 elec-status">
              <span className={cx('elec-pill', ps?.power ? 'is-live' : 'is-dead')}>{ps?.power ? 'POWER ON' : 'POWER OFF'}</span>
              {ps?.lockout && <span className="elec-pill is-lock">LOCKED OUT</span>}
            </span>
          </div>
          <div className="elec-schem-wrap">
            <Schematic
              view={view}
              state={ps}
              tool={tool}
              probes={probes}
              activeProbe={active}
              onNodeClick={placeProbe}
              onCompClick={onCompClick}
              onToggle={toggleComp}
              canUseTool={canUseTool}
            />
          </div>
          <div className="elec-loads" aria-label="Loads">
            {loads.map((l) => {
              const c = compById.get(l.id);
              return (
                <span key={l.id} className={cx('elec-load', `is-${LEVEL_TONE[l.level]}`)} title={c?.label}>
                  {l.kind === 'lamp' ? <Lightbulb /> : l.kind === 'motor' ? <Fan /> : <Zap />}
                  <span className="elec-load-name">{c?.label ?? l.id}</span>
                  <span className="elec-load-level">{l.level}</span>
                </span>
              );
            })}
          </div>
        </section>

        <div className="elec-side">
          <section className="card elec-tools">
            <div className="elec-tools-head">
              <span className="eyebrow">Tool</span>
              <Segmented
                value={tool}
                onChange={setTool}
                options={[
                  { id: 'probe', label: <span className="row gap-4"><Crosshair className="elec-seg-icon" />Probe</span> },
                  { id: 'inspect', label: <span className="row gap-4"><Search className="elec-seg-icon" />Inspect</span> },
                  { id: 'bench', label: <span className="row gap-4"><FlaskConical className="elec-seg-icon" />Bench</span> },
                  { id: 'replace', label: <span className="row gap-4"><Wrench className="elec-seg-icon" />Replace</span> },
                ]}
              />
            </div>
            <p className="small text-2">{TOOL_HINT[tool]}</p>
          </section>

          <Multimeter
            mode={meterMode}
            onMode={setMeterMode}
            red={probes.red}
            black={probes.black}
            active={active}
            onActive={setActive}
            nodeLabel={nodeLabel}
            reading={ps?.lastReading ?? null}
            busy={working}
            onMeasure={measure}
            onClearProbe={(p) => {
              setProbes((s) => ({ ...s, [p]: null }));
              setActive(p);
            }}
            onSwap={() => setProbes((s) => ({ red: s.black, black: s.red }))}
            onClear={() => {
              setProbes({ red: null, black: null });
              setActive('red');
            }}
          />

          <section className="card elec-controls">
            <div className="card-header">
              <h3>
                <Power /> Controls
              </h3>
            </div>
            <div className="card-body stack-sm">
              <div className="elec-ctrl">
                <span className="elec-ctrl-name">Main disconnect</span>
                <button
                  type="button"
                  className={cx('elec-toggle', ps?.power && 'is-on')}
                  aria-pressed={!!ps?.power}
                  disabled={working || (!ps?.power && !!ps?.lockout)}
                  onClick={() => setPower(!ps?.power)}
                  title={!ps?.power && ps?.lockout ? 'Remove the lockout tag first' : undefined}
                >
                  <span className="elec-toggle-knob" />
                  {ps?.power ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="elec-ctrl">
                <span className="elec-ctrl-name">Lockout tag</span>
                <button
                  type="button"
                  className={cx('btn btn-sm', ps?.lockout ? 'btn-soft' : '')}
                  disabled={working || !!ps?.power}
                  onClick={() => void act({ type: 'set_lockout', payload: { applied: !ps?.lockout } })}
                  title={ps?.power ? 'Switch the disconnect OFF before applying a lockout tag' : undefined}
                >
                  {ps?.lockout ? <Lock /> : <LockOpen />}
                  {ps?.lockout ? 'Applied' : ps?.power ? 'Power off first' : 'Apply'}
                </button>
              </div>
              {switches.map((c) => {
                const on = !!ps?.switches[c.id];
                const thermo = c.control === 'thermostat';
                return (
                  <div key={c.id} className="elec-ctrl">
                    <span className="elec-ctrl-name">{c.label}</span>
                    <button type="button" className={cx('elec-toggle', on && (thermo ? 'is-hot' : 'is-on'))} aria-pressed={on} disabled={working} onClick={() => toggleComp(c)}>
                      <span className="elec-toggle-knob" />
                      {thermo ? (on ? 'HOT' : 'COLD') : on ? 'ON' : 'OFF'}
                    </button>
                  </div>
                );
              })}
              {plugs.map((c) => {
                const plugged = ps?.plugged[c.id] !== false;
                return (
                  <div key={c.id} className="elec-ctrl">
                    <span className="elec-ctrl-name">{c.label}</span>
                    <button type="button" className={cx('elec-toggle', plugged && 'is-on')} aria-pressed={plugged} disabled={working} onClick={() => toggleComp(c)}>
                      <span className="elec-toggle-knob" />
                      {plugged ? 'Plugged' : 'Unplugged'}
                    </button>
                  </div>
                );
              })}
              {view.reproduce && <div className="help">Tip from the work order: {view.reproduce.label.toLowerCase()} to reproduce the complaint.</div>}
            </div>
          </section>
        </div>
      </div>

      <div className="elec-bottom">
        <section className="card elec-log">
          <div className="card-header">
            <h3>
              <ClipboardList /> Work log
            </h3>
            <div className="row gap-6">
              <Badge tone="elec">{ps?.readings ?? 0} readings</Badge>
              <Badge tone={ps && ps.partsCost > 0 ? 'warning' : 'neutral'}>Parts ${ps?.partsCost ?? 0}</Badge>
            </div>
          </div>
          <div className="card-body">
            {entries.length === 0 ? (
              <div className="muted small">No actions yet. Start by confirming the complaint and checking the supply.</div>
            ) : (
              <ol className="elec-log-list">
                {entries.map((e) => (
                  <LogRow key={e.seq} entry={e} />
                ))}
              </ol>
            )}
          </div>
        </section>

        <section className="card elec-diag">
          <div className="card-header">
            <h3>
              <ClipboardCheck /> Diagnosis &amp; completion
            </h3>
          </div>
          <div className="card-body stack-sm">
            {rows.map((r, i) => (
              <div key={i} className="elec-diag-row">
                <select
                  className="select"
                  value={r.comp}
                  aria-label={`Failed part ${i + 1}`}
                  onChange={(e) => setRows((rs) => rs.map((x, k) => (k === i ? { comp: e.target.value, type: '' } : x)))}
                >
                  <option value="">Failed part…</option>
                  {replaceable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select
                  className="select"
                  value={r.type}
                  aria-label={`Failure mode ${i + 1}`}
                  disabled={!r.comp}
                  onChange={(e) => setRows((rs) => rs.map((x, k) => (k === i ? { ...x, type: e.target.value as FaultType } : x)))}
                >
                  <option value="">Failure mode…</option>
                  {(view.faultOptions[r.comp] ?? []).map((o) => (
                    <option key={o.type} value={o.type}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon"
                  aria-label="Remove row"
                  disabled={rows.length === 1}
                  onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}
                >
                  <Trash2 />
                </button>
              </div>
            ))}
            <div className="row between wrap">
              <button type="button" className="btn btn-ghost btn-sm" disabled={rows.length >= 3} onClick={() => setRows((rs) => [...rs, { comp: '', type: '' }])}>
                <Plus /> Add fault
              </button>
              <button type="button" className="btn btn-sm" disabled={working || !validRows.length || dupe} onClick={recordDiagnosis}>
                Record diagnosis
              </button>
            </div>
            {dupe && <div className="error-text">The same fault is listed twice.</div>}
            {ps?.diagnosis?.length ? (
              <div className="elec-recorded">
                <div className="label">Recorded diagnosis</div>
                <ul>
                  {ps.diagnosis.map((d) => (
                    <li key={`${d.comp}:${d.type}`}>
                      <b>{compById.get(d.comp)?.label ?? d.comp}</b>: {faultLabel(d.comp, d.type)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="muted small">No diagnosis recorded yet.</div>
            )}
            <hr className="divider" />
            <button type="button" className="btn btn-primary btn-block elec-complete" disabled={working} onClick={() => setConfirmComplete(true)}>
              <ClipboardCheck /> Complete work order
            </button>
          </div>
        </section>
      </div>

      <Modal
        open={!!confirmReplace}
        onClose={() => setConfirmReplace(null)}
        title={confirmReplace ? `${confirmReplace.repairVerb || 'Replace'} ${confirmReplace.label}?` : ''}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirmReplace(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={working}
              onClick={() => {
                const c = confirmReplace;
                setConfirmReplace(null);
                if (c) void act({ type: 'replace', payload: { comp: c.id } });
              }}
            >
              <Wrench /> {confirmReplace?.repairVerb || 'Replace'} (${confirmReplace?.cost ?? 0})
            </button>
          </>
        }
      >
        {confirmReplace && (
          <div className="stack-sm">
            <div className="row between">
              <span className="text-2">{confirmReplace.spec}</span>
              <Badge tone="warning">${confirmReplace.cost}</Badge>
            </div>
            <Callout tone={ps?.power ? 'danger' : 'warning'} title="Safety first">
              Contact work needs a dead circuit: disconnect OFF, lockout tag applied, and 0 V verified with your meter.
              {ps && (
                <div className="small" style={{ marginTop: 4 }}>
                  Right now: power {ps.power ? 'ON' : 'OFF'}, lockout {ps.lockout ? 'applied' : 'not applied'}.
                </div>
              )}
            </Callout>
          </div>
        )}
      </Modal>

      <Modal
        open={confirmComplete}
        onClose={() => setConfirmComplete(false)}
        title="Complete the work order?"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirmComplete(false)}>
              Keep working
            </button>
            <button
              className="btn btn-primary"
              disabled={working}
              onClick={() => {
                setConfirmComplete(false);
                void submit({ type: 'complete_work_order', payload: {} });
              }}
            >
              <ClipboardCheck /> Complete work order
            </button>
          </>
        }
      >
        <div className="stack-sm">
          <div className="elec-summary">
            <div>
              <span className="label">Diagnosis</span>
              <div>
                {ps?.diagnosis?.length
                  ? ps.diagnosis.map((d) => `${compById.get(d.comp)?.label ?? d.comp}: ${faultLabel(d.comp, d.type)}`).join('; ')
                  : 'None recorded'}
              </div>
            </div>
            <div>
              <span className="label">Power</span>
              <div>{ps?.power ? 'ON' : 'OFF'}{ps?.lockout ? ' (locked out)' : ''}</div>
            </div>
            <div>
              <span className="label">Parts replaced</span>
              <div>
                {replacedList.length
                  ? `${replacedList.map((r) => compById.get(r.comp)?.label ?? r.comp).join(', ')} ($${ps?.partsCost ?? 0})`
                  : 'None'}
              </div>
            </div>
            <div>
              <span className="label">Meter readings</span>
              <div>{ps?.readings ?? 0}</div>
            </div>
          </div>
          {mode === 'practice' && (
            <div className="stack-sm">
              {!ps?.diagnosis?.length && <Callout tone="warning">You haven't recorded a diagnosis yet.</Callout>}
              {!ps?.power && <Callout tone="warning">Power is OFF, so you haven't verified that the circuit works again.</Callout>}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

function LogRow({ entry }: { entry: PublicLogEntry }) {
  const tone = entry.messageTone;
  const isReading = entry.type === 'measure' || entry.type === 'bench_test';
  return (
    <li className={cx('elec-log-row', `type-${entry.type}`)}>
      <span className="elec-log-time mono">{fmtDuration(entry.t / 1000)}</span>
      <div className="grow">
        <div className={cx(isReading && 'mono', 'elec-log-desc')}>{entry.description}</div>
        {entry.message && <div className={cx('elec-log-msg', tone && `is-${tone}`)}>{entry.message}</div>}
      </div>
    </li>
  );
}

export default Workspace;
