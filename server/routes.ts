/**
 * REST API routes.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import type { CatalogResponse, CreateAssignmentRequest, StartAttemptRequest } from '../shared/api.ts';
import { MODULES } from '../shared/modules/index.ts';
import { q } from './db.ts';
import {
  createSession,
  createUser,
  destroySession,
  findUserByUsername,
  readCookie,
  requireInstructor,
  requireUser,
  SESSION_COOKIE,
  setSessionCookie,
  toUserView,
  verifyPassword,
} from './auth.ts';
import { aiStatus } from './llm.ts';
import { profileResponse, progressResponse } from './services/learner.ts';
import {
  abandonAttempt,
  activeView,
  applyAction,
  debriefView,
  HttpError,
  loadCompletedFor,
  requestHint,
  startAttempt,
  submitAttempt,
} from './services/attempts.ts';
import { recommendationsFor, recommendForSkill } from './services/recommend.ts';
import { askCoach, ensureNarrative } from './services/coach.ts';
import {
  classDetail,
  createAssignment,
  createClass,
  deleteAssignment,
  exportCsv,
  joinClass,
  listClasses,
  studentDetail,
} from './services/instructor.ts';

export const api = Router();

const wrap =
  (fn: (req: Request, res: Response) => unknown | Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      next(e);
    }
  };

const param = (req: Request, name: string): string => String((req.params as Record<string, string>)[name] ?? '');

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

api.get('/health', (_req, res) => {
  res.json({ ok: true, ai: aiStatus() });
});

api.get(
  '/auth/me',
  wrap((req) => ({ user: req.user ? toUserView(req.user) : null })),
);

api.post(
  '/auth/login',
  wrap((req, res) => {
    const { username, password } = req.body ?? {};
    const user = typeof username === 'string' ? findUserByUsername(username) : undefined;
    if (!user || typeof password !== 'string' || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Incorrect username or password.');
    }
    setSessionCookie(res, createSession(user.id));
    return { user: toUserView(user) };
  }),
);

api.post(
  '/auth/demo',
  wrap((req, res) => {
    const role = req.body?.role === 'instructor' ? 'instructor' : 'learner';
    const user = findUserByUsername(role === 'instructor' ? 'teacher' : 'student');
    if (!user) throw new HttpError(404, 'Demo accounts are not available. Run `npm run seed`.');
    setSessionCookie(res, createSession(user.id));
    return { user: toUserView(user) };
  }),
);

api.post(
  '/auth/register',
  wrap((req, res) => {
    const { username, password, displayName, role, classCode } = req.body ?? {};
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) {
      throw new HttpError(400, 'Username must be 3-24 characters: letters, numbers, dot, dash or underscore.');
    }
    if (typeof password !== 'string' || password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
    if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 40) throw new HttpError(400, 'Enter your name (up to 40 characters).');
    if (findUserByUsername(username)) throw new HttpError(409, 'That username is taken.');
    const user = createUser({ username, password, displayName, role: role === 'instructor' ? 'instructor' : 'learner' });
    if (classCode && typeof classCode === 'string' && classCode.trim() && user.role === 'learner') {
      try {
        joinClass(user, classCode);
      } catch {
        /* invalid code: account still created */
      }
    }
    setSessionCookie(res, createSession(user.id));
    return { user: toUserView(user) };
  }),
);

api.post(
  '/auth/logout',
  wrap((req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) destroySession(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }),
);

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

api.get(
  '/catalog',
  wrap((): CatalogResponse => ({
    modules: MODULES.map((m) => ({
      id: m.id,
      name: m.name,
      tagline: m.tagline,
      description: m.description,
      color: m.color,
      icon: m.icon,
      safetyNotice: m.safetyNotice,
      skills: m.skills,
      templates: m.templates,
      mistakes: m.mistakes,
      strengths: m.strengths,
    })),
    ai: aiStatus(),
  })),
);

// ---------------------------------------------------------------------------
// Learner
// ---------------------------------------------------------------------------

api.get('/profile', requireUser, wrap((req) => profileResponse(req.user!)));
api.get('/progress', requireUser, wrap((req) => progressResponse(req.user!.id)));
api.get('/recommendations', requireUser, wrap((req) => recommendationsFor(req.user!)));
api.get('/recommendations/skill/:skillId', requireUser, wrap((req) => ({ recommendation: recommendForSkill(req.user!, param(req, 'skillId')) })));
api.post(
  '/classes/join',
  requireUser,
  wrap((req) => {
    if (typeof req.body?.code !== 'string') throw new HttpError(400, 'Enter a class code.');
    return { klass: joinClass(req.user!, req.body.code) };
  }),
);

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

api.post(
  '/attempts',
  requireUser,
  wrap((req) => ({ attemptId: startAttempt(req.user!, (req.body ?? {}) as StartAttemptRequest) })),
);

api.get('/attempts/:id', requireUser, wrap((req) => activeView(param(req, 'id'), req.user!)));
api.post('/attempts/:id/actions', requireUser, wrap((req) => applyAction(param(req, 'id'), req.user!, req.body?.action)));
api.post('/attempts/:id/hint', requireUser, wrap((req) => requestHint(param(req, 'id'), req.user!)));
api.post('/attempts/:id/submit', requireUser, wrap((req) => submitAttempt(param(req, 'id'), req.user!, req.body?.action)));
api.post(
  '/attempts/:id/abandon',
  requireUser,
  wrap((req) => {
    abandonAttempt(param(req, 'id'), req.user!);
    return { ok: true };
  }),
);
api.get('/attempts/:id/debrief', requireUser, wrap((req) => debriefView(param(req, 'id'), req.user!)));
api.post(
  '/attempts/:id/coach/narrative',
  requireUser,
  wrap(async (req) => {
    const row = loadCompletedFor(param(req, 'id'), req.user!);
    const coach = await ensureNarrative(row);
    return { narrative: coach.narrative, provider: coach.provider };
  }),
);
api.post(
  '/attempts/:id/coach/ask',
  requireUser,
  wrap(async (req) => {
    const question = req.body?.question;
    if (typeof question !== 'string' || !question.trim()) throw new HttpError(400, 'Ask a question.');
    const row = loadCompletedFor(param(req, 'id'), req.user!, true);
    return askCoach(row, question);
  }),
);

// ---------------------------------------------------------------------------
// Instructor
// ---------------------------------------------------------------------------

api.get('/instructor/classes', requireInstructor, wrap((req) => listClasses(req.user!)));
api.post(
  '/instructor/classes',
  requireInstructor,
  wrap((req) => {
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    if (!name.trim()) throw new HttpError(400, 'Name the class.');
    return { id: createClass(req.user!, name) };
  }),
);
api.get('/instructor/classes/:id', requireInstructor, wrap((req) => classDetail(req.user!, param(req, 'id'))));
api.post(
  '/instructor/classes/:id/assignments',
  requireInstructor,
  wrap((req) => ({ ids: createAssignment(req.user!, param(req, 'id'), (req.body ?? {}) as CreateAssignmentRequest) })),
);
api.delete(
  '/instructor/assignments/:id',
  requireInstructor,
  wrap((req) => {
    deleteAssignment(req.user!, param(req, 'id'));
    return { ok: true };
  }),
);
api.get('/instructor/students/:id', requireInstructor, wrap((req) => studentDetail(req.user!, param(req, 'id'))));
api.get(
  '/instructor/classes/:id/export.csv',
  requireInstructor,
  wrap((req, res) => {
    const csv = exportCsv(req.user!, param(req, 'id'));
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="skillbridge-class-export.csv"');
    res.send(csv);
    return undefined;
  }),
);

api.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body.' });
    return;
  }
  console.error('[api error]', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
}

export function userCount(): number {
  return q.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;
}
