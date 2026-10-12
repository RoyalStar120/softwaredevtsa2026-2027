/**
 * Skill module registry. Adding a new skill area (e.g. Communication) means
 * implementing `SkillModule` in a new folder and adding it to MODULES. The shared
 * platform (accounts, logging, learner model, adaptive engine, coaching, dashboards)
 * works with it automatically.
 */

import type { MistakeDef, ScenarioTemplate, SkillDef, SkillModule, StrengthDef } from '../types.ts';
import type { Catalog } from '../adaptive.ts';
import { electricalModule } from './electrical/index.ts';
import { programmingModule } from './programming/index.ts';

export const MODULES: SkillModule[] = [programmingModule, electricalModule];

const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]));

export function getModule(id: string): SkillModule {
  const m = MODULE_BY_ID.get(id);
  if (!m) throw new Error(`Unknown module "${id}"`);
  return m;
}

export function findTemplate(templateId: string): { module: SkillModule; template: ScenarioTemplate } | null {
  for (const module of MODULES) {
    const template = module.templates.find((t) => t.id === templateId);
    if (template) return { module, template };
  }
  return null;
}

export const ALL_SKILLS: SkillDef[] = MODULES.flatMap((m) => m.skills);
export const SKILL_BY_ID = new Map(ALL_SKILLS.map((s) => [s.id, s]));
export const ALL_TEMPLATES: ScenarioTemplate[] = MODULES.flatMap((m) => m.templates);
export const ALL_MISTAKES: Record<string, MistakeDef> = Object.assign({}, ...MODULES.map((m) => m.mistakes));
export const ALL_STRENGTHS: Record<string, StrengthDef> = Object.assign({}, ...MODULES.map((m) => m.strengths));

export function buildCatalog(): Catalog {
  return {
    skills: ALL_SKILLS,
    templates: ALL_TEMPLATES,
    mistakes: ALL_MISTAKES,
    moduleNames: Object.fromEntries(MODULES.map((m) => [m.id, m.name])),
  };
}
