/**
 * Template registry: turns the raw template specs into ScenarioTemplate metadata
 * plus the hidden data (reference code, tests, bug definitions, variants).
 * SERVER-SIDE ONLY: never import this from client code.
 */

import type { ScenarioTemplate } from '../../../types.ts';
import type { BugDef, ConceptSkillId, TemplateSpec } from '../types.ts';
import { functionRanges } from '../codeAnalysis.ts';
import { CONCEPT_SKILLS, MODULE_ID } from '../skills.ts';
import { cart } from './cart.ts';
import { gradebook } from './gradebook.ts';
import { inventory } from './inventory.ts';
import { pagination } from './pagination.ts';
import { sensor } from './sensor.ts';
import { streak } from './streak.ts';
import { username } from './username.ts';

export const TEMPLATE_SPECS: TemplateSpec[] = [gradebook, username, pagination, cart, sensor, inventory, streak];

export interface Variant {
  id: string;
  bugs: BugDef[];
}

export interface TemplateData {
  spec: TemplateSpec;
  template: ScenarioTemplate;
  bugs: BugDef[];
  variants: Variant[];
  functionNames: string[];
}

/** Applies the bug's find/replace on its line (the line count never changes). */
export function injectBugs(reference: string, bugs: readonly BugDef[]): string {
  const lines = reference.split('\n');
  for (const b of bugs) {
    const i = b.line - 1;
    if (i >= 0 && i < lines.length) lines[i] = lines[i].replace(b.find, b.replace);
  }
  return lines.join('\n');
}

function buildBugs(spec: TemplateSpec): BugDef[] {
  const lines = spec.code.split('\n');
  return spec.bugs.map((b) => {
    const ref = lines[b.line - 1] ?? '';
    return { ...b, fixedLine: ref.trim(), buggyLine: ref.replace(b.find, b.replace).trim() };
  });
}

/** Two bugs on different lines, ordered by line ("idA+idB"). */
export function pairId(a: BugDef, b: BugDef): string {
  const [x, y] = a.line <= b.line ? [a, b] : [b, a];
  return `${x.id}+${y.id}`;
}

function buildVariants(spec: TemplateSpec, bugs: BugDef[]): Variant[] {
  const variants: Variant[] = bugs.map((b) => ({ id: b.id, bugs: [b] }));
  if (spec.difficultyRange[1] >= 4) {
    const byId = new Map(bugs.map((b) => [b.id, b]));
    for (const id of spec.pairs ?? []) {
      const [x, y] = id.split('+').map((p) => byId.get(p));
      if (!x || !y || x.line === y.line) continue;
      const ordered = x.line < y.line ? [x, y] : [y, x];
      variants.push({ id: pairId(ordered[0], ordered[1]), bugs: ordered });
    }
  }
  return variants;
}

function conceptWeights(bugs: BugDef[]): Record<ConceptSkillId, number> {
  const counts = Object.fromEntries(CONCEPT_SKILLS.map((c) => [c, 0])) as Record<ConceptSkillId, number>;
  for (const b of bugs) counts[b.conceptSkill]++;
  const max = Math.max(1, ...Object.values(counts));
  const out = {} as Record<ConceptSkillId, number>;
  for (const c of CONCEPT_SKILLS) {
    out[c] = counts[c] > 0 ? Math.round((0.3 + (0.5 * counts[c]) / max) * 100) / 100 : 0;
  }
  return out;
}

function build(spec: TemplateSpec): TemplateData {
  const bugs = buildBugs(spec);
  const variants = buildVariants(spec, bugs);
  const concepts = conceptWeights(bugs);
  const skillWeights: Record<string, number> = { ...spec.processWeights };
  for (const c of CONCEPT_SKILLS) if (concepts[c] > 0) skillWeights[c] = concepts[c];
  const focusable = [
    ...CONCEPT_SKILLS.filter((c) => concepts[c] > 0),
    ...(spec.difficultyRange[0] === 1 ? ['prog.reproduce'] : []),
    'prog.trace',
    'prog.localize',
    ...(spec.difficultyRange[1] >= 4 ? ['prog.verify'] : []),
  ];
  const template: ScenarioTemplate = {
    id: spec.id,
    moduleId: MODULE_ID,
    title: spec.title,
    summary: spec.summary,
    difficultyRange: spec.difficultyRange,
    skillWeights,
    focusable,
    prerequisites: spec.prerequisites,
    estimatedMinutes: spec.estimatedMinutes,
    tags: spec.tags,
    variantCount: variants.length,
  };
  return { spec, template, bugs, variants, functionNames: functionRanges(spec.code).map((f) => f.name) };
}

export const TEMPLATE_DATA: TemplateData[] = TEMPLATE_SPECS.map(build);
export const TEMPLATE_DATA_BY_ID = new Map(TEMPLATE_DATA.map((d) => [d.template.id, d]));
export const TEMPLATES: ScenarioTemplate[] = TEMPLATE_DATA.map((d) => d.template);
