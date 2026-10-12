/**
 * Client-side module contract. Each skill module supplies its own interactive
 * workspace; the platform's Scenario Player hosts it, routes its actions to the
 * server-authoritative simulation, and handles hints, timing and submission.
 *
 * IMPORTANT: client module code must never import runtime code from
 * shared/modules/** (that would ship hidden answers to the browser).
 * Type-only imports (`import type`) are fine because they are erased.
 */

import type { ComponentType } from 'react';
import type { Evaluation, ModuleAction, PublicScenario } from '../../../shared/types.ts';
import type { ActionResponse, DebriefLogEntry, PublicLogEntry } from '../../../shared/api.ts';

export interface WorkspaceProps<V = any, P = any> {
  attemptId: string;
  scenario: PublicScenario<V>;
  /** Learner-visible simulation state returned by the server after every action. */
  publicState: P;
  /** Learner-visible action history (no hidden verdicts). */
  log: PublicLogEntry[];
  mode: 'practice' | 'assessment';
  /** True while an action is in flight. */
  busy: boolean;
  /** Sends an action to the server-authoritative simulation engine. */
  dispatch: (action: ModuleAction) => Promise<ActionResponse>;
  /**
   * Finishes the scenario with the module's submit action. The module owns any
   * pre-submit UI (diagnosis form, confirmation); the platform sends the action,
   * finalizes the attempt and navigates to the debrief.
   */
  submit: (action: ModuleAction) => Promise<void>;
}

export interface DebriefExtrasProps<V = any, R = any> {
  scenario: PublicScenario<V>;
  evaluation: Evaluation;
  log: DebriefLogEntry[];
  /** Module-specific post-completion data from SkillModule.reveal(). */
  reveal: R;
}

export interface ClientModule {
  id: string;
  Workspace: ComponentType<WorkspaceProps>;
  /** Optional module-specific debrief visualization (e.g. code diff, highlighted faulty part). */
  DebriefExtras?: ComponentType<DebriefExtrasProps>;
}
