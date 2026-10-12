/**
 * Digital multimeter panel: LCD, mode selector, probe slots and actions.
 */

import { Eraser, Repeat, Volume2, Zap } from 'lucide-react';
import type { MeterMode, MeterReading } from '../../../../shared/modules/electrical/types.ts';
import { cx } from '../../components/ui.tsx';

export type ProbeColor = 'red' | 'black';

interface Props {
  mode: MeterMode;
  onMode: (m: MeterMode) => void;
  red: string | null;
  black: string | null;
  active: ProbeColor;
  onActive: (p: ProbeColor) => void;
  nodeLabel: (id: string) => string;
  reading: MeterReading | null;
  busy: boolean;
  disabled?: boolean;
  onMeasure: () => void;
  onClearProbe: (p: ProbeColor) => void;
  onSwap: () => void;
  onClear: () => void;
}

const MODES: Array<{ id: MeterMode; label: string; title: string }> = [
  { id: 'V', label: 'V⎓', title: 'DC voltage' },
  { id: 'R', label: 'Ω', title: 'Resistance' },
  { id: 'C', label: '•)))', title: 'Continuity (beeps below 2 Ω)' },
];

const MODE_UNIT: Record<MeterMode, string> = { V: 'DC V', R: 'Ω', C: 'CONT' };

export function Multimeter(props: Props) {
  const r = props.reading;
  const fresh = !!r && r.mode === props.mode && r.red === props.red && r.black === props.black;
  const ready = !!props.red && !!props.black;
  let main = '----';
  let unit = MODE_UNIT[props.mode];
  if (r && fresh) {
    if (r.voltagePresent) main = 'VOLT!';
    else if (r.overload) main = 'OL';
    else {
      const m = /^(-?[\d.]+)\s*(.*)$/.exec(r.display);
      main = m ? m[1] : r.display;
      unit = m && m[2] ? m[2] : unit;
    }
  }
  return (
    <section className="panel elec-meter" aria-label="Multimeter">
      <div className="panel-head">
        <span>Multimeter</span>
        <span className="muted tiny">{MODES.find((m) => m.id === props.mode)?.title}</span>
      </div>
      <div className="panel-body elec-meter-body">
        <div className={cx('elec-lcd', r && fresh && r.voltagePresent && 'is-volt', !fresh && 'is-idle')} aria-live="polite">
          <div className="elec-lcd-top">
            <span>{MODE_UNIT[props.mode]}</span>
            <span className="elec-lcd-icons">
              {r && fresh && r.beep && <Volume2 aria-label="Beep" />}
              {r && fresh && r.voltagePresent && <Zap aria-label="Voltage present" />}
            </span>
          </div>
          <div className="elec-lcd-main">
            <span className={cx('elec-lcd-value', r && fresh && r.voltagePresent && 'elec-blink')}>{main}</span>
            {!(r && fresh && (r.voltagePresent || r.overload)) && <span className="elec-lcd-unit">{unit}</span>}
          </div>
          <div className="elec-lcd-bottom">
            {r && !fresh ? `last: ${r.display} (${props.nodeLabel(r.red)} → ${props.nodeLabel(r.black)})` : ready ? 'ready' : 'place both probes'}
          </div>
        </div>

        <div className="elec-dial" role="radiogroup" aria-label="Meter mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={props.mode === m.id}
              className={cx('elec-dial-btn', props.mode === m.id && 'is-on')}
              title={m.title}
              onClick={() => props.onMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="elec-probes">
          {(['red', 'black'] as const).map((p) => {
            const node = p === 'red' ? props.red : props.black;
            return (
              <div key={p} className={cx('elec-probe-slot', `is-${p}`, props.active === p && 'is-active')}>
                <button type="button" className="elec-probe-pick" onClick={() => props.onActive(p)} title={`Next test point click places the ${p.toUpperCase()} probe`}>
                  <span className="elec-probe-dot" />
                  <span className="elec-probe-name">{p === 'red' ? 'RED (+)' : 'BLACK (COM)'}</span>
                  <span className="elec-probe-node mono">{node ? props.nodeLabel(node) : '—'}</span>
                </button>
                {node && (
                  <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => props.onClearProbe(p)} aria-label={`Remove ${p} probe`}>
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="row gap-6">
          <button type="button" className="btn btn-primary btn-sm grow" onClick={props.onMeasure} disabled={!ready || props.busy || props.disabled} title="Take a reading (Enter)">
            Take reading
          </button>
          <button type="button" className="btn btn-sm btn-icon" onClick={props.onSwap} disabled={!props.red && !props.black} title="Swap probes" aria-label="Swap probes">
            <Repeat />
          </button>
          <button type="button" className="btn btn-sm btn-icon" onClick={props.onClear} disabled={!props.red && !props.black} title="Clear probes" aria-label="Clear probes">
            <Eraser />
          </button>
        </div>
      </div>
    </section>
  );
}

export default Multimeter;
