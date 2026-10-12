/**
 * Demo data seeder.
 *
 * Creates demo accounts and a class of SIMULATED learners. Their history is not
 * hand-written: each simulated learner (with an ability that grows over time and
 * personal habits) is run through the real adaptive engine, real scenario
 * generator, real simulations and real evaluators. All simulated students are
 * flagged `is_simulated` and labeled as such in the instructor dashboard.
 * They demonstrate the analytics; they are NOT evidence that SkillBridge improves learning.
 *
 *   npm run seed            (reset + reseed)
 */

import { pathToFileURL } from 'node:url';
import type { ModuleAction } from '../shared/types.ts';
import type { StartAttemptRequest } from '../shared/api.ts';
import { createRng, type Rng } from '../shared/rng.ts';
import { getModule } from '../shared/modules/index.ts';
import { closeDb, json, openDb, q, resetDb } from './db.ts';
import { createUser, type UserRow } from './auth.ts';
import { applyAction, finalize, requestHint, startAttempt } from './services/attempts.ts';
import { createAssignment, createClass, joinClass } from './services/instructor.ts';
import { execTrusted } from './codeRunner.ts';

const DAY = 86400000;
const HOUR = 3600000;

interface Traits {
  careful: number;
  safe: number;
  systematic: number;
}

interface SimProfile {
  name: string;
  username: string;
  ability: number;
  growth: number; // per attempt
  traits: Traits;
  attempts: number;
  prefer: 'electrical' | 'programming' | 'mixed';
  doesTransfer: boolean;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function grow(t: Traits, k: number, growth: number): Traits {
  return {
    careful: clamp01(t.careful + growth * k * 0.9),
    safe: clamp01(t.safe + growth * k * 1.1),
    systematic: clamp01(t.systematic + growth * k * 0.9),
  };
}

function runSimulatedAttempt(
  user: UserRow,
  req: StartAttemptRequest,
  startAt: number,
  ability: number,
  traits: Traits,
  rng: Rng,
  opts: { prepend?: ModuleAction[]; allowHints?: boolean } = {},
): number {
  const seed = rng.int(1, 2 ** 30);
  const id = startAttempt(user, req, startAt, { seed });
  const row = q.get<any>('SELECT * FROM attempts WHERE id = ?', id)!;
  const module = getModule(row.module_id);
  const instance = json<any>(row.instance, null);
  let clock = startAt;
  if (!module.simulateLearner) {
    finalize(id, clock + 60000);
    return clock + 60000;
  }
  const actions = [...(opts.prepend ?? []), ...module.simulateLearner(instance, { rng: createRng(seed), ability, traits, exec: execTrusted })];
  let done = false;
  let hintsLeft = opts.allowHints === false || row.mode === 'assessment' ? 0 : rng.chance(0.55 * (1 - ability)) ? rng.int(1, 2) : 0;
  for (const action of actions) {
    clock += 4000 + rng.int(0, 22000);
    if (hintsLeft > 0 && rng.chance(0.25)) {
      try {
        requestHint(id, user, clock);
        hintsLeft--;
        clock += 8000;
      } catch {
        hintsLeft = 0;
      }
    }
    try {
      const r = applyAction(id, user, action, clock);
      if (r.complete) {
        done = true;
        break;
      }
    } catch {
      break;
    }
  }
  const status = q.get<any>('SELECT status FROM attempts WHERE id = ?', id)!.status;
  if (!done && status === 'active') finalize(id, clock + 5000);
  return clock;
}

const PROFILES: SimProfile[] = [
  { name: 'Jordan Patel', username: 'jordan.p', ability: 0.3, growth: 0.05, traits: { careful: 0.35, safe: 0.2, systematic: 0.3 }, attempts: 14, prefer: 'electrical', doesTransfer: true },
  { name: 'Maya Johnson', username: 'maya.j', ability: 0.6, growth: 0.035, traits: { careful: 0.65, safe: 0.75, systematic: 0.6 }, attempts: 16, prefer: 'mixed', doesTransfer: true },
  { name: 'Ethan Brooks', username: 'ethan.b', ability: 0.2, growth: 0.05, traits: { careful: 0.2, safe: 0.35, systematic: 0.2 }, attempts: 10, prefer: 'programming', doesTransfer: true },
  { name: 'Sofia Garcia', username: 'sofia.g', ability: 0.8, growth: 0.02, traits: { careful: 0.85, safe: 0.9, systematic: 0.8 }, attempts: 22, prefer: 'mixed', doesTransfer: true },
  { name: 'Liam Nguyen', username: 'liam.n', ability: 0.4, growth: 0.05, traits: { careful: 0.3, safe: 0.45, systematic: 0.5 }, attempts: 11, prefer: 'electrical', doesTransfer: true },
  { name: 'Ava Thompson', username: 'ava.t', ability: 0.45, growth: 0.05, traits: { careful: 0.55, safe: 0.25, systematic: 0.4 }, attempts: 12, prefer: 'mixed', doesTransfer: true },
  { name: 'Noah Kim', username: 'noah.k', ability: 0.25, growth: 0.02, traits: { careful: 0.25, safe: 0.3, systematic: 0.25 }, attempts: 7, prefer: 'programming', doesTransfer: false },
  { name: 'Zoe Martinez', username: 'zoe.m', ability: 0.7, growth: 0.03, traits: { careful: 0.6, safe: 0.7, systematic: 0.75 }, attempts: 18, prefer: 'electrical', doesTransfer: true },
];

export function seedDemo(opts: { reset?: boolean; quiet?: boolean } = {}) {
  openDb();
  if (opts.reset) resetDb();
  if (q.get('SELECT 1 FROM users LIMIT 1')) {
    if (!opts.quiet) console.log('Database already has users. Use --reset to reseed.');
    return;
  }
  const log = (...a: unknown[]) => !opts.quiet && console.log(...a);
  const now = Date.now();
  const rng = createRng(20261011);

  const teacher = createUser({ username: 'teacher', password: 'skillbridge', displayName: 'Ms. Carter', role: 'instructor', isDemo: true, createdAt: now - 30 * DAY });
  const classId = createClass(teacher, 'Period 3 · Engineering & Technology', 'TSA-2026', now - 28 * DAY);
  const [baselineId] = createAssignment(
    teacher,
    classId,
    { title: 'Baseline check: Porch Light (no hints)', kind: 'baseline', templateId: 'elec.porch-light', difficulty: 2, note: 'Pre-test. Do your best without hints; this measures where you are starting.', dueAt: now - 20 * DAY },
    now - 26 * DAY,
  );
  const [transferId] = createAssignment(
    teacher,
    classId,
    { title: 'Transfer check: Workshop Lights (no hints)', kind: 'transfer', templateId: 'elec.workshop-lights', difficulty: 3, note: 'Post-test in a NEW circuit: same skills, different scenario.', dueAt: now + 2 * DAY },
    now - 6 * DAY,
  );
  createAssignment(
    teacher,
    classId,
    { title: 'Objective: safe resistance testing', kind: 'practice', focusSkills: ['elec.resistance', 'elec.safety'], note: 'SkillBridge will pick a scenario for each of you that targets these skills.', dueAt: now + 4 * DAY },
    now - 2 * DAY,
  );
  createAssignment(
    teacher,
    classId,
    { title: 'Debugging: reproduce before you edit', kind: 'practice', focusSkills: ['prog.reproduce', 'prog.localize'], dueAt: now + 6 * DAY },
    now - 1 * DAY,
  );

  // ---------------- Simulated class ----------------
  for (const p of PROFILES) {
    const user = createUser({ username: p.username, password: 'skillbridge', displayName: p.name, role: 'learner', isSimulated: true, createdAt: now - 27 * DAY });
    joinClass(user, 'TSA-2026', now - 27 * DAY);
    const span = 23 * DAY;
    const start = now - 24 * DAY;
    for (let k = 0; k < p.attempts; k++) {
      const at = start + (span * k) / p.attempts + rng.int(0, 10) * HOUR;
      const ability = clamp01(p.ability + p.growth * k);
      const traits = grow(p.traits, k, p.growth);
      let req: StartAttemptRequest;
      if (k === 0) req = { assignmentId: baselineId };
      else if (k === p.attempts - 1 && p.doesTransfer) req = { assignmentId: transferId };
      else {
        const moduleId = p.prefer === 'mixed' ? (k % 2 === 0 ? 'electrical' : 'programming') : rng.chance(0.7) ? p.prefer : p.prefer === 'electrical' ? 'programming' : 'electrical';
        req = { moduleId, source: 'recommended' };
      }
      runSimulatedAttempt(user, req, at, ability, traits, rng);
    }
    log(`  simulated ${p.name}: ${p.attempts} attempts`);
  }

  // ---------------- Demo learner (Alex) ----------------
  // A realistic, modest history with a RECURRING safety mistake, so the adaptive engine's
  // targeted recommendation is visible on first login.
  const alex = createUser({ username: 'student', password: 'skillbridge', displayName: 'Alex Chen', role: 'learner', isDemo: true, createdAt: now - 22 * DAY });
  joinClass(alex, 'TSA-2026', now - 22 * DAY);
  const liveOhms: ModuleAction = { type: 'measure', payload: { mode: 'R', red: 'N1', black: 'N0' } };
  const plan: Array<{ req: StartAttemptRequest; ability: number; traits: Traits; prepend?: ModuleAction[]; daysAgo: number }> = [
    { req: { assignmentId: baselineId }, ability: 0.35, traits: { careful: 0.4, safe: 0.5, systematic: 0.35 }, daysAgo: 19 },
    { req: { moduleId: 'programming', source: 'recommended' }, ability: 0.4, traits: { careful: 0.3, safe: 1, systematic: 0.3 }, daysAgo: 16 },
    { req: { moduleId: 'electrical', source: 'recommended' }, ability: 0.45, traits: { careful: 0.5, safe: 0.4, systematic: 0.5 }, prepend: [liveOhms], daysAgo: 12 },
    { req: { moduleId: 'programming', source: 'recommended' }, ability: 0.5, traits: { careful: 0.55, safe: 1, systematic: 0.5 }, daysAgo: 9 },
    { req: { moduleId: 'electrical', source: 'recommended' }, ability: 0.55, traits: { careful: 0.6, safe: 0.4, systematic: 0.65 }, prepend: [liveOhms], daysAgo: 5 },
    { req: { moduleId: 'programming', source: 'recommended' }, ability: 0.6, traits: { careful: 0.65, safe: 1, systematic: 0.6 }, daysAgo: 3 },
    { req: { moduleId: 'electrical', source: 'recommended' }, ability: 0.6, traits: { careful: 0.65, safe: 0.45, systematic: 0.7 }, prepend: [liveOhms], daysAgo: 1 },
  ];
  for (const step of plan) {
    runSimulatedAttempt(alex, step.req, now - step.daysAgo * DAY - rng.int(1, 6) * HOUR, step.ability, step.traits, rng, { prepend: step.prepend });
  }
  log('  demo learner Alex Chen ready');
  log('Seed complete. Logins: student / skillbridge (learner), teacher / skillbridge (instructor).');
}

// CLI: node server/seed.ts [--reset]
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const t0 = Date.now();
  seedDemo({ reset: process.argv.includes('--reset') });
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  closeDb();
}
