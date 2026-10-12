/**
 * Electrical Troubleshooting module. Implements the shared SkillModule contract with
 * its own interactions (multimeter, lockout, inspection, repair), simulation (DC circuit
 * physics), safety checks, evaluation rules and feedback guidelines.
 */

import type { SkillModule } from '../../types.ts';
import type { ElecConfig } from './types.ts';
import { TEMPLATE_DEFS } from './circuits.ts';
import { ELEC_KNOWLEDGE, ELEC_MISTAKES, ELEC_SKILLS, ELEC_STRENGTHS, SAFETY_NOTICE } from './content.ts';
import {
  applyActionElectrical,
  describeElectricalAction,
  generateElectrical,
  hintElectrical,
  initialStateElectrical,
  publicScenarioElectrical,
  publicStateElectrical,
  revealElectrical,
  type ElecState,
} from './engine.ts';
import { evaluateElectrical } from './evaluate.ts';
import { simulateElectricalLearner } from './bot.ts';

export const electricalModule: SkillModule<ElecConfig, ElecState> = {
  id: 'electrical',
  name: 'Electrical: Troubleshooting',
  tagline: 'Diagnose circuit faults safely, using real circuit physics',
  description:
    'Work orders on simulated DC circuits: a porch light, workshop lighting, a fuse that keeps blowing, and a relay-controlled cooling fan. Use a multimeter, follow lockout procedure, and repair only what your evidence supports. Every reading is computed from the circuit, and SkillBridge tracks how much each one actually told you.',
  color: '#F59E0B',
  icon: 'zap',
  safetyNotice: SAFETY_NOTICE,
  skills: ELEC_SKILLS,
  templates: Object.values(TEMPLATE_DEFS).map((d) => d.template),
  mistakes: ELEC_MISTAKES,
  strengths: ELEC_STRENGTHS,
  knowledge: ELEC_KNOWLEDGE,
  submitActionType: 'complete_work_order',
  generate: generateElectrical,
  publicScenario: publicScenarioElectrical,
  initialState: initialStateElectrical,
  publicState: publicStateElectrical,
  applyAction: applyActionElectrical,
  hint: hintElectrical,
  evaluate: evaluateElectrical,
  describeAction: describeElectricalAction,
  reveal: revealElectrical,
  simulateLearner: simulateElectricalLearner,
};
