/**
 * Debrief visualization for the debugging module: unified diffs of the original
 * buggy code vs the learner's final code and vs the reference fix, with the
 * faulty lines highlighted, plus a root-cause card per bug.
 */

import { useMemo, useState } from 'react';
import { Bug, GitCompare } from 'lucide-react';
import type { ProgReveal, ProgView } from '../../../../shared/modules/programming/types.ts';
import { diffSeq, normalizedCode } from '../../../../shared/modules/programming/codeAnalysis.ts';
import type { DebriefExtrasProps } from '../types.ts';
import { Badge, Callout, Card, Segmented, cx } from '../../components/ui.tsx';
import './programming.css';

type Row =
  | { kind: 'eq' | 'del' | 'ins'; oldNo: number | null; newNo: number | null; text: string }
  | { kind: 'skip'; count: number };

const CONTEXT = 2;

function buildRows(original: string, target: string, bugLines: Set<number>): { rows: Row[]; added: number; removed: number } {
  const a = original.split('\n');
  const b = target.split('\n');
  const ops = diffSeq(
    a.map((s) => s.trimEnd()),
    b.map((s) => s.trimEnd()),
  );
  const full = ops.map((op) =>
    op.k === 'eq'
      ? { kind: 'eq' as const, oldNo: op.a + 1, newNo: op.b + 1, text: b[op.b] }
      : op.k === 'del'
        ? { kind: 'del' as const, oldNo: op.a + 1, newNo: null, text: a[op.a] }
        : { kind: 'ins' as const, oldNo: null, newNo: op.b + 1, text: b[op.b] },
  );
  const keep = full.map((r) => r.kind !== 'eq' || (r.oldNo !== null && bugLines.has(r.oldNo)));
  const near = keep.map((_, i) => {
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(full.length - 1, i + CONTEXT); j++) if (keep[j]) return true;
    return false;
  });
  const rows: Row[] = [];
  let skipped = 0;
  full.forEach((r, i) => {
    if (near[i]) {
      if (skipped) rows.push({ kind: 'skip', count: skipped });
      skipped = 0;
      rows.push(r);
    } else skipped++;
  });
  if (skipped) rows.push({ kind: 'skip', count: skipped });
  return {
    rows,
    added: full.filter((r) => r.kind === 'ins').length,
    removed: full.filter((r) => r.kind === 'del').length,
  };
}

export function DebriefExtras({ reveal, evaluation }: DebriefExtrasProps<ProgView, ProgReveal>) {
  const [mode, setMode] = useState<'yours' | 'expert'>('yours');
  const bugByLine = useMemo(() => new Map((reveal?.bugs ?? []).map((b) => [b.line, b])), [reveal]);
  const diff = useMemo(() => {
    if (!reveal) return null;
    return buildRows(reveal.originalCode, mode === 'yours' ? reveal.finalCode : reveal.referenceCode, new Set(bugByLine.keys()));
  }, [reveal, mode, bugByLine]);
  if (!reveal || !diff) return null;

  const sameAsReference = normalizedCode(reveal.finalCode) === normalizedCode(reveal.referenceCode);
  const unchanged = normalizedCode(reveal.finalCode) === normalizedCode(reveal.originalCode);
  const linesMetric = evaluation.metrics.find((m) => m.key === 'lines_changed');

  return (
    <div className="prog-debrief stack">
      <Card
        title="Code changes"
        icon={<GitCompare />}
        actions={
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { id: 'yours', label: 'Your fix' },
              { id: 'expert', label: 'Reference fix' },
            ]}
          />
        }
      >
        <div className="row wrap gap-6" style={{ marginBottom: 10 }}>
          <span className="mono small">{reveal.fileName}</span>
          <Badge tone="success">+{diff.added}</Badge>
          <Badge tone="danger">-{diff.removed}</Badge>
          {mode === 'yours' && linesMetric && (
            <span className="small text-2">
              Lines changed: <b>{linesMetric.value}</b>
              {linesMetric.benchmark !== undefined ? ` (minimal fix: ${linesMetric.benchmark})` : ''}
            </span>
          )}
        </div>
        {mode === 'yours' && sameAsReference && (
          <Callout tone="success">Your final code matches the reference fix (ignoring formatting and comments).</Callout>
        )}
        {mode === 'yours' && unchanged && <Callout tone="warning">You submitted the original code without changes.</Callout>}
        <div className="panel prog-diff" role="table" aria-label={mode === 'yours' ? 'Your changes' : 'Reference fix'}>
          {diff.rows.map((r, i) =>
            r.kind === 'skip' ? (
              <div key={`s${i}`} className="prog-diff-skip" role="row">
                ⋯ {r.count} unchanged line{r.count === 1 ? '' : 's'}
              </div>
            ) : (
              <div
                key={i}
                role="row"
                className={cx('prog-diff-row', `is-${r.kind}`, r.oldNo !== null && bugByLine.has(r.oldNo) && 'is-bug')}
                title={r.oldNo !== null ? bugByLine.get(r.oldNo)?.title : undefined}
              >
                <span className="prog-diff-no">{r.oldNo ?? ''}</span>
                <span className="prog-diff-no">{r.newNo ?? ''}</span>
                <span className="prog-diff-sign">{r.kind === 'del' ? '−' : r.kind === 'ins' ? '+' : ' '}</span>
                <span className="prog-diff-code">{r.text || ' '}</span>
                {r.oldNo !== null && bugByLine.has(r.oldNo) && r.kind !== 'ins' && <span className="prog-diff-bug">bug</span>}
              </div>
            ),
          )}
        </div>
      </Card>

      <Card title={reveal.bugs.length === 1 ? 'Root cause' : 'Root causes'} icon={<Bug />}>
        <div className="stack">
          {reveal.bugs.map((b) => (
            <div key={b.line} className="prog-rootcause">
              <div className="row wrap gap-6">
                <Badge tone="prog">Line {b.line}</Badge>
                <span className="bold">{b.title}</span>
                <Badge>{b.categoryLabel}</Badge>
              </div>
              <div className="prog-fixline">
                <div>
                  <span className="prog-fix-tag is-del">bug</span>
                  <code>{b.buggyLine}</code>
                </div>
                <div>
                  <span className="prog-fix-tag is-ins">fix</span>
                  <code>{b.fixedLine}</code>
                </div>
              </div>
              <p className="small text-2">{b.explanation}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default DebriefExtras;
