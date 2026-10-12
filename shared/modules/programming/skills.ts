/** Skill tree for the Programming: Debugging module. */

import type { SkillDef } from '../../types.ts';
import type { ConceptSkillId } from './types.ts';

export const MODULE_ID = 'programming';

export const SKILLS: SkillDef[] = [
  {
    id: 'prog.reproduce',
    moduleId: MODULE_ID,
    name: 'Reproduce & Observe',
    shortName: 'Reproduce',
    description: 'Run the code and its tests to observe the failure before changing anything.',
    prerequisites: [],
    tier: 0,
    column: 0,
    kind: 'process',
  },
  {
    id: 'prog.trace',
    moduleId: MODULE_ID,
    name: 'Code Tracing',
    shortName: 'Tracing',
    description: 'Read code, predict values, and inspect state with console.log and console experiments.',
    prerequisites: [],
    tier: 0,
    column: 1,
    kind: 'process',
  },
  {
    id: 'prog.localize',
    moduleId: MODULE_ID,
    name: 'Fault Localization',
    shortName: 'Localize',
    description: 'Use evidence to narrow a failure down to the responsible line before editing.',
    prerequisites: ['prog.reproduce', 'prog.trace'],
    tier: 1,
    column: 0,
    kind: 'process',
  },
  {
    id: 'prog.boundaries',
    moduleId: MODULE_ID,
    name: 'Loops & Boundaries',
    shortName: 'Boundaries',
    description: 'Off-by-one errors, inclusive vs exclusive bounds, loop limits and empty inputs.',
    prerequisites: ['prog.trace'],
    tier: 1,
    column: 1,
    kind: 'concept',
  },
  {
    id: 'prog.logic',
    moduleId: MODULE_ID,
    name: 'Conditions & Logic',
    shortName: 'Logic',
    description: 'Comparison and boolean operators, inverted conditions and branch order.',
    prerequisites: ['prog.trace'],
    tier: 1,
    column: 2,
    kind: 'concept',
  },
  {
    id: 'prog.verify',
    moduleId: MODULE_ID,
    name: 'Fix & Verify',
    shortName: 'Verify',
    description: 'Make a minimal root-cause fix, re-run the full suite, and leave no regressions or debug code.',
    prerequisites: ['prog.localize'],
    tier: 2,
    column: 0,
    kind: 'process',
  },
  {
    id: 'prog.state',
    moduleId: MODULE_ID,
    name: 'Data & State',
    shortName: 'State',
    description: 'Accumulators and initial values, mutation and aliasing, types and coercion, missing returns.',
    prerequisites: ['prog.logic'],
    tier: 2,
    column: 2,
    kind: 'concept',
  },
];

export const SKILL_IDS = new Set(SKILLS.map((s) => s.id));
export const SKILL_NAMES: Record<string, string> = Object.fromEntries(SKILLS.map((s) => [s.id, s.name]));

export const CONCEPT_SKILLS: ConceptSkillId[] = ['prog.boundaries', 'prog.logic', 'prog.state'];
export const PROCESS_SKILLS = ['prog.reproduce', 'prog.trace', 'prog.localize', 'prog.verify'];
