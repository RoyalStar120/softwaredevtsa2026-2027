/**
 * Typed fetch wrapper for the SkillBridge API.
 */

import type { ModuleAction } from '../../shared/types.ts';
import type {
  ActionResponse,
  ActiveAttemptResponse,
  CatalogResponse,
  ClassDetailResponse,
  ClassSummary,
  CoachReplyResponse,
  CreateAssignmentRequest,
  DebriefResponse,
  HintResponse,
  ProfileResponse,
  ProgressResponse,
  RecommendationsResponse,
  StartAttemptRequest,
  StudentDetailResponse,
  UserView,
} from '../../shared/api.ts';
import type { Recommendation } from '../../shared/adaptive.ts';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the SkillBridge server. Is it running?');
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  me: () => request<{ user: UserView | null }>('GET', '/auth/me'),
  login: (username: string, password: string) => request<{ user: UserView }>('POST', '/auth/login', { username, password }),
  demo: (role: 'learner' | 'instructor') => request<{ user: UserView }>('POST', '/auth/demo', { role }),
  register: (body: { username: string; password: string; displayName: string; role: 'learner' | 'instructor'; classCode?: string }) =>
    request<{ user: UserView }>('POST', '/auth/register', body),
  logout: () => request<{ ok: boolean }>('POST', '/auth/logout', {}),

  catalog: () => request<CatalogResponse>('GET', '/catalog'),
  profile: () => request<ProfileResponse>('GET', '/profile'),
  progress: () => request<ProgressResponse>('GET', '/progress'),
  recommendations: () => request<RecommendationsResponse>('GET', '/recommendations'),
  recommendForSkill: (skillId: string) => request<{ recommendation: Recommendation | null }>('GET', `/recommendations/skill/${encodeURIComponent(skillId)}`),
  joinClass: (code: string) => request<{ klass: { id: string; name: string } }>('POST', '/classes/join', { code }),

  startAttempt: (req: StartAttemptRequest) => request<{ attemptId: string }>('POST', '/attempts', req),
  attempt: (id: string) => request<ActiveAttemptResponse>('GET', `/attempts/${id}`),
  act: (id: string, action: ModuleAction) => request<ActionResponse>('POST', `/attempts/${id}/actions`, { action }),
  hint: (id: string) => request<HintResponse>('POST', `/attempts/${id}/hint`, {}),
  submit: (id: string, action: ModuleAction) => request<ActionResponse>('POST', `/attempts/${id}/submit`, { action }),
  abandon: (id: string) => request<{ ok: boolean }>('POST', `/attempts/${id}/abandon`, {}),
  debrief: (id: string) => request<DebriefResponse>('GET', `/attempts/${id}/debrief`),
  narrative: (id: string) => request<{ narrative: string | null; provider: string }>('POST', `/attempts/${id}/coach/narrative`, {}),
  ask: (id: string, question: string) => request<CoachReplyResponse>('POST', `/attempts/${id}/coach/ask`, { question }),

  classes: () => request<ClassSummary[]>('GET', '/instructor/classes'),
  createClass: (name: string) => request<{ id: string }>('POST', '/instructor/classes', { name }),
  classDetail: (id: string) => request<ClassDetailResponse>('GET', `/instructor/classes/${id}`),
  createAssignment: (classId: string, body: CreateAssignmentRequest) => request<{ ids: string[] }>('POST', `/instructor/classes/${classId}/assignments`, body),
  deleteAssignment: (id: string) => request<{ ok: boolean }>('DELETE', `/instructor/assignments/${id}`),
  student: (id: string) => request<StudentDetailResponse>('GET', `/instructor/students/${id}`),
  exportUrl: (classId: string) => `/api/instructor/classes/${classId}/export.csv`,
};
