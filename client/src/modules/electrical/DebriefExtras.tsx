/**
 * Electrical debrief extras: read-only schematic with the faulty parts outlined,
 * what each fault was, and the expert's path through the job.
 */

import { Route, TriangleAlert, Zap } from 'lucide-react';
import type { ElecReveal, ElecView } from '../../../../shared/modules/electrical/types.ts';
import type { DebriefExtrasProps } from '../types.ts';
import { Badge, Card } from '../../components/ui.tsx';
import { Schematic } from './Schematic.tsx';
import './electrical.css';

export function DebriefExtras({ scenario, reveal }: DebriefExtrasProps<ElecView, ElecReveal>) {
  if (!reveal) return null;
  const view = scenario.view;
  const label = (id: string) => view.comps.find((c) => c.id === id)?.label ?? id;
  return (
    <div className="elec-debrief stack">
      <Card title="Where the fault was" icon={<Zap />}>
        <div className="panel elec-schem-wrap is-static">
          <Schematic view={view} interactive={false} highlight={reveal.faultyComps} />
        </div>
        <div className="row wrap gap-6" style={{ marginTop: 10 }}>
          {reveal.faultyComps.map((id) => (
            <Badge key={id} tone="danger" icon={<TriangleAlert />}>
              {label(id)}
            </Badge>
          ))}
        </div>
      </Card>

      <Card title={reveal.faults.length === 1 ? 'The fault' : 'The faults'} icon={<TriangleAlert />}>
        <div className="stack-sm">
          {reveal.faults.map((f, i) => (
            <div key={i} className="elec-fault">
              <div className="row wrap gap-6">
                <span className="bold">{f.title}</span>
                <Badge tone="elec">{label(f.comp)}</Badge>
              </div>
              <p className="small text-2">{f.detail}</p>
            </div>
          ))}
        </div>
      </Card>

      {reveal.expertSteps.length > 0 && (
        <Card title="Expert path" icon={<Route />}>
          <ol className="elec-expert">
            {reveal.expertSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

export default DebriefExtras;
