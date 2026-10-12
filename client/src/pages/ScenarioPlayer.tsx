import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, ChevronDown, ChevronUp, Flag, Lightbulb, Target, Timer, Crosshair, XCircle } from 'lucide-react';
import type { ModuleAction, HintResult } from '../../../shared/types.ts';
import type { ActionResponse, ActiveAttemptResponse, PublicLogEntry } from '../../../shared/api.ts';
import { api, ApiError } from '../api.ts';
import { clientModule } from '../modules/index.ts';
import { ModuleIcon } from '../components/domain.tsx';
import { ReasonIcon } from '../components/adaptive.tsx';
import { Badge, Callout, Difficulty, Modal, PageLoading, useToast } from '../components/ui.tsx';
import { useSession } from '../state/session.tsx';

function useElapsed(startedAt: number | null, serverOffset: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return '0:00';
  const sec = Math.max(0, Math.floor((now + serverOffset - startedAt) / 1000));
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}

export default function ScenarioPlayer() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { skill, module: moduleInfo } = useSession();
  const [data, setData] = useState<ActiveAttemptResponse | null>(null);
  const [publicState, setPublicState] = useState<unknown>(null);
  const [log, setLog] = useState<PublicLogEntry[]>([]);
  const [hints, setHints] = useState<HintResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showBrief, setShowBrief] = useState(true);
  const [confirmHint, setConfirmHint] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const offsetRef = useRef(0);

  useEffect(() => {
    let alive = true;
    api
      .attempt(id)
      .then((d) => {
        if (!alive) return;
        offsetRef.current = d.serverTime - Date.now();
        setData(d);
        setPublicState(d.publicState);
        setLog(d.log);
        setHints(d.hints);
        setShowBrief(d.log.length === 0);
      })
      .catch((e: ApiError) => {
        if (e.status === 409 && /complete/.test(e.message)) navigate(`/debrief/${id}`, { replace: true });
        else setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [id, navigate]);

  const elapsed = useElapsed(data?.attempt.startedAt ?? null, offsetRef.current);

  const dispatch = useCallback(
    async (action: ModuleAction): Promise<ActionResponse> => {
      setBusy(true);
      try {
        const res = await api.act(id, action);
        if (res.ok) {
          if (res.publicState !== undefined) setPublicState(res.publicState);
          if (res.entry) setLog((l) => [...l, res.entry!]);
          if (res.complete) navigate(`/debrief/${id}`);
        }
        return res;
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      } finally {
        setBusy(false);
      }
    },
    [id, navigate],
  );

  const submit = useCallback(
    async (action: ModuleAction) => {
      setSubmitting(true);
      try {
        const res = await api.submit(id, action);
        if (!res.ok) {
          toast(res.error ?? 'Could not submit.', 'danger');
          setSubmitting(false);
          return;
        }
        navigate(`/debrief/${id}`);
      } catch (e) {
        toast((e as Error).message, 'danger');
        setSubmitting(false);
      }
    },
    [id, navigate, toast],
  );

  const takeHint = async () => {
    setConfirmHint(false);
    try {
      const res = await api.hint(id);
      setHints(res.hints);
      setLog((l) => [...l, res.entry]);
      setShowBrief(true);
    } catch (e) {
      toast((e as Error).message, 'warning');
    }
  };

  const quit = async () => {
    try {
      await api.abandon(id);
    } finally {
      navigate(-1);
    }
  };

  if (error)
    return (
      <div className="page">
        <Callout tone="danger" title="Could not open this scenario">
          {error} <Link to="/home">Back to home</Link>
        </Callout>
      </div>
    );
  if (!data) return <PageLoading label="Preparing your scenario…" />;

  const cm = clientModule(data.scenario.moduleId);
  const mod = moduleInfo(data.scenario.moduleId);
  const Workspace = cm?.Workspace;
  const assessment = data.attempt.mode === 'assessment';
  const rec = data.recommendation;

  return (
    <div className="player">
      <div className="player-bar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} title="Leave (your progress is saved)">
          <ArrowLeft /> Exit
        </button>
        <ModuleIcon moduleId={data.scenario.moduleId} size={32} />
        <div className="player-title grow">
          <div className="row gap-6">
            <h1>{data.scenario.title}</h1>
            {assessment && <Badge tone="info">Assessment: no hints</Badge>}
          </div>
          <div className="row gap-6 tiny muted" style={{ flexWrap: 'wrap' }}>
            <span>{mod?.name}</span>
            <span>·</span>
            <Difficulty value={data.scenario.difficulty} />
            {data.scenario.focusSkills.length > 0 && (
              <>
                <span>·</span>
                <span className="row gap-4">
                  <Crosshair width={12} height={12} /> Focus: {data.scenario.focusSkills.map((s) => skill(s)?.shortName ?? s).join(', ')}
                </span>
              </>
            )}
          </div>
        </div>
        <span className="timer row gap-6" title="Time on task">
          <Timer width={14} height={14} />
          {elapsed}
        </span>
        <button className="btn btn-sm" onClick={() => setShowBrief((v) => !v)}>
          <BookOpen /> Briefing {showBrief ? <ChevronUp /> : <ChevronDown />}
        </button>
        {!assessment && (
          <button
            className="btn btn-sm"
            onClick={() => setConfirmHint(true)}
            disabled={hints.length >= data.maxHintLevel}
            title="Hints are logged and slightly reduce your score"
          >
            <Lightbulb /> Hint {hints.length}/{data.maxHintLevel}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmQuit(true)} title="Abandon this attempt">
          <XCircle />
        </button>
      </div>

      <div className="player-body">
        {showBrief && (
          <div className="card briefing fade-in">
            <div className="stack-sm">
              <div className="eyebrow">Briefing</div>
              <p>{data.scenario.briefing}</p>
              <div className="row gap-6 top" style={{ marginTop: 10 }}>
                <Target width={16} height={16} style={{ marginTop: 2, color: 'var(--primary)' }} />
                <p>
                  <b>Goal:</b> {data.scenario.goal}
                </p>
              </div>
              {data.scenario.constraints.length > 0 && (
                <ul className="small text-2">
                  {data.scenario.constraints.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
              {hints.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>
                    Hints used
                  </div>
                  {hints.map((h) => (
                    <div key={h.level} className="hint-box">
                      <b>Level {h.level}:</b> {h.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="stack-sm">
              <div className="eyebrow">Learning objectives</div>
              <ul className="small">
                {data.scenario.objectives.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
              {rec && rec.reasons.length > 0 && (
                <>
                  <div className="eyebrow" style={{ marginTop: 10 }}>
                    Why this scenario
                  </div>
                  <div className="col gap-4">
                    {rec.reasons.slice(0, 3).map((r, i) => (
                      <div key={i} className="row top gap-6 small text-2">
                        <span style={{ color: 'var(--primary)', display: 'inline-flex', flex: 'none', marginTop: 2 }}>
                          <ReasonIcon kind={r.kind} size={14} />
                        </span>
                        <span>{r.text}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {Workspace ? (
          <Workspace
            attemptId={id}
            scenario={data.scenario}
            publicState={publicState}
            log={log}
            mode={data.attempt.mode}
            busy={busy || submitting}
            dispatch={dispatch}
            submit={submit}
          />
        ) : (
          <Callout tone="danger">No workspace is registered for module “{data.scenario.moduleId}”.</Callout>
        )}
      </div>

      <Modal
        open={confirmHint}
        onClose={() => setConfirmHint(false)}
        title="Use a hint?"
        footer={
          <>
            <button className="btn" onClick={() => setConfirmHint(false)}>
              Keep trying
            </button>
            <button className="btn btn-primary" onClick={takeHint}>
              <Lightbulb /> Show hint {hints.length + 1}
            </button>
          </>
        }
      >
        <p className="text-2">
          Hints get more specific at each level. They're recorded in your action log and reduce this attempt's score and skill evidence a little. Productive struggle helps
          you learn, so try one more idea first if you can.
        </p>
      </Modal>
      <Modal
        open={confirmQuit}
        onClose={() => setConfirmQuit(false)}
        title="Abandon this scenario?"
        footer={
          <>
            <button className="btn" onClick={() => setConfirmQuit(false)}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={quit}>
              <Flag /> Abandon
            </button>
          </>
        }
      >
        <p className="text-2">The attempt will be closed without an evaluation. To pause instead, use Exit. Your progress is saved and you can resume later.</p>
      </Modal>
      {submitting && (
        <div className="modal-backdrop">
          <div className="card card-pad col" style={{ alignItems: 'center', gap: 12 }}>
            <span className="spinner" style={{ width: 28, height: 28 }} />
            <div className="bold">Evaluating your process…</div>
            <div className="small muted">Replaying your actions against the simulation and the expert path</div>
          </div>
        </div>
      )}
    </div>
  );
}
