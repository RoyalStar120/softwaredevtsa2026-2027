import { Bot, Brain, ClipboardCheck, Cpu, Database, FlaskConical, Gauge, Layers, ShieldCheck, Activity, ArrowDown } from 'lucide-react';
import { PageHeader } from '../components/Layout.tsx';
import { Card, Badge } from '../components/ui.tsx';
import { useSession } from '../state/session.tsx';

const PIPELINE = [
  { i: <Layers />, t: 'Skill module', d: 'Interactions, rules, safety checks, feedback guidelines' },
  { i: <Cpu />, t: 'Simulation engine', d: 'Server-authoritative state; every action validated' },
  { i: <Activity />, t: 'Action logger', d: 'Each step + hidden annotations (informative? unsafe?)' },
  { i: <ClipboardCheck />, t: 'Rules & evaluation', d: 'Accuracy · process · efficiency · safety, deterministic' },
  { i: <Database />, t: 'Learner skill profile', d: 'Per-skill ability, uncertainty, spaced review' },
  { i: <Gauge />, t: 'Adaptive practice engine', d: 'Chooses the next scenario + focus + difficulty' },
  { i: <Bot />, t: 'AI coaching', d: 'Explains the evaluation; never decides it' },
];

export default function About() {
  const { catalog } = useSession();
  const ai = catalog?.ai;
  return (
    <div className="page">
      <PageHeader
        title="How SkillBridge works"
        subtitle="One central idea: observe how a learner performs a skill, then change what they practice next. Everything else supports that loop."
      />
      <div className="stack-lg">
        <div className="grid grid-2">
          <Card title="Architecture" icon={<Layers />}>
            <div className="col gap-4">
              {PIPELINE.map((p, i) => (
                <div key={p.t}>
                  <div className="row gap-10" style={{ gap: 10, padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)' }}>
                    <span style={{ color: 'var(--primary)', display: 'inline-flex' }}>{p.i}</span>
                    <div>
                      <div className="bold small">{p.t}</div>
                      <div className="tiny muted">{p.d}</div>
                    </div>
                  </div>
                  {i < PIPELINE.length - 1 && (
                    <div style={{ display: 'grid', placeItems: 'center', color: 'var(--border-strong)' }}>
                      <ArrowDown width={14} height={14} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="small text-2" style={{ marginTop: 10 }}>
              The shared platform standardizes <b>how skills are tracked and improved</b>. Each module defines its own interactions and evaluation rules, which is why
              debugging code and diagnosing circuits can feel completely different but feed the same learner model.
            </p>
          </Card>
          <div className="col gap-16">
            <Card title="The adaptive practice engine" icon={<Gauge />}>
              <p className="small text-2">For every scenario template and difficulty level, the engine computes:</p>
              <pre className="mono small" style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 10, whiteSpace: 'pre-wrap', marginTop: 8 }}>
{`score = 1.2·need + 1.0·zpd + 1.4·pattern
      + 0.6·reinforce + 0.5·integration
      + 0.35·explore + 1.5·focus − recency`}
              </pre>
              <ul className="small text-2" style={{ paddingLeft: 18, margin: '8px 0 0' }}>
                <li><b>need</b>: weakness in the skills the scenario exercises</li>
                <li><b>zpd</b>: desirable difficulty, with expected success near 72%</li>
                <li><b>pattern</b>: targets skills tied to a mistake that keeps recurring</li>
                <li><b>reinforce</b>: spaced review of skills not practiced recently</li>
                <li><b>integration</b>: combines skills you've become proficient in</li>
                <li><b>recency</b>: avoids repeating the scenario you just did</li>
              </ul>
              <p className="small text-2" style={{ marginTop: 8 }}>
                The chosen focus skills are passed to the module's generator, which picks a fault or bug configuration that emphasizes them. You get a <i>different</i>{' '}
                scenario, not the same exercise again. Every recommendation shows its reasons.
              </p>
            </Card>
            <Card title="The learner model" icon={<Brain />}>
              <p className="small text-2">
                Each skill has an ability estimate on a logit scale, updated like an Elo/IRT rating: <code>rating += K·uncertainty·weight·(score − expected)</code>.
                Succeeding at a hard scenario counts more than succeeding at an easy one. <b>Mastered</b> requires a high estimate <i>and</i> 2 of the last 3 attempts at
                80% or better, so one lucky success is never enough. Review intervals grow after strong performance and reset after weak performance.
              </p>
            </Card>
          </div>
        </div>

        <div className="grid grid-3">
          <Card title="Process, not just answers" icon={<ClipboardCheck />}>
            <p className="small text-2">
              Electrical: every action runs against every fault hypothesis still consistent with what you've observed. A reading that rules nothing out is flagged, and
              your number of readings is compared with a greedy expert path. Programming: did you reproduce before editing? Were your edits on target? Did you verify?
              Unsafe or trial-and-error processes are capped at 60 and 80 points.
            </p>
          </Card>
          <Card title="Grounded AI coaching" icon={<Bot />}>
            <p className="small text-2">
              The coach receives only engine output: the evaluation, the annotated action log, the expert path and the module's feedback guidelines. It explains and
              answers follow-ups. It never invents the correct answer or changes a score.
            </p>
            <div className="row gap-6" style={{ marginTop: 10 }}>
              <Badge tone="primary">Current provider: {ai?.provider === 'offline' || !ai ? 'built-in offline coach' : `${ai.provider} · ${ai.model}`}</Badge>
            </div>
            <p className="tiny muted" style={{ marginTop: 6 }}>
              Set GEMINI_API_KEY or OPENAI_API_KEY in .env to enable an LLM. Without a key, everything still works offline.
            </p>
          </Card>
          <Card title="Safety & data" icon={<ShieldCheck />}>
            <p className="small text-2">
              Simulations are practice only and never replace certified instruction or supervision. Learner code runs only in a sandboxed browser Web Worker. Scenario
              answers stay on the server until you finish. Passwords are hashed with scrypt, and data is stored locally in SQLite.
            </p>
          </Card>
        </div>

        <Card title="Measuring effectiveness" icon={<FlaskConical />}>
          <div className="grid grid-3">
            {[
              ['Pre-test vs. post-test', 'Baseline assessment, then the same skills later on (no hints).'],
              ['Transfer test', 'A different scenario that measures the same skills.'],
              ['Error reduction', 'Do repeated mistakes decline across attempts?'],
              ['Retention', 'Re-test after a delay (for example, one week).'],
              ['Usability', 'Can new users navigate without help? Observe and time them.'],
              ['Learner feedback', 'Were the explanations and recommended scenarios useful?'],
            ].map(([t, d]) => (
              <div key={t} className="card card-pad" style={{ background: 'var(--surface-2)' }}>
                <div className="bold small">{t}</div>
                <div className="tiny text-2" style={{ marginTop: 4 }}>
                  {d}
                </div>
              </div>
            ))}
          </div>
          <p className="small text-2" style={{ marginTop: 12 }}>
            The instructor dashboard's <b>Learning evidence</b> tab computes these from real attempts and exports attempt-level CSV. Demo classes contain simulated learners
            and are labeled as such. Report actual results, sample sizes and limitations.
          </p>
        </Card>
      </div>
    </div>
  );
}
