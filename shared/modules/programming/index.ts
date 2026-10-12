/**
 * Programming: Debugging - a SkillBridge skill module.
 *
 * Learners debug small, realistic JavaScript programs: reproduce the failure,
 * form and test hypotheses (console experiments, logging), localize the faulty
 * line, make a minimal fix and verify it with the full test suite. Code runs in
 * the browser (Web Worker); this server-side module holds the hidden bug
 * definitions, records every action and evaluates the debugging PROCESS as well
 * as the final answer.
 */

import type { SkillModule } from '../../types.ts';
import type { ProgConfig, ProgState } from './types.ts';
import { simulateLearner } from './bot.ts';
import { applyAction, describeAction, generate, initialState, publicScenario, publicState } from './engine.ts';
import { evaluate, hint, reveal } from './evaluate.ts';
import { KNOWLEDGE, MISTAKES, STRENGTHS } from './feedback.ts';
import { MODULE_ID, SKILLS } from './skills.ts';
import { TEMPLATES } from './templates/index.ts';

export const programmingModule: SkillModule<ProgConfig, ProgState> = {
  id: MODULE_ID,
  name: 'Programming: Debugging',
  tagline: 'Debug real code by forming and testing hypotheses',
  description:
    'Fix realistic JavaScript bugs the way professionals do: reproduce the failure, trace values with console experiments and logging, localize the faulty line, make a minimal fix, and verify it with the full test suite. SkillBridge scores your process, not just whether the tests end up green.',
  color: '#7C5CFF',
  icon: 'code',
  skills: SKILLS,
  templates: TEMPLATES,
  mistakes: MISTAKES,
  strengths: STRENGTHS,
  knowledge: KNOWLEDGE,
  submitActionType: 'submit_fix',
  generate,
  publicScenario,
  initialState,
  publicState,
  applyAction,
  hint,
  evaluate,
  describeAction,
  reveal,
  simulateLearner,
};

export default programmingModule;
