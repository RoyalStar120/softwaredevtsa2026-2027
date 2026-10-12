# Adding a skill module

SkillBridge is universal by design: the shared platform standardizes how skills are **tracked and improved**, while each module defines its own **interactions and evaluation rules**. Debugging code, diagnosing a circuit and practicing a hard conversation are fundamentally different activities, so modules do not share mechanics. They share a contract.

## 1. Implement `SkillModule` (shared/types.ts)

Create `shared/modules/<your-module>/index.ts` exporting an object with:

| Member | Purpose |
|---|---|
| `skills: SkillDef[]` | Skill definitions with prerequisites and tree position (`tier`, `column`). Ids must be globally unique (e.g. `comm.empathy`). |
| `templates: ScenarioTemplate[]` | Scenario templates with `skillWeights`, `focusable` skills, `difficultyRange`, `prerequisites`. |
| `mistakes`, `strengths` | Feedback guidelines: title, severity, related skills, *why it matters*, *what to do instead*. Codes must be globally unique (prefix them). |
| `knowledge` | Concept explanations used by the offline coach for follow-up questions. |
| `generate(template, { seed, difficulty, focusSkills, avoidVariants })` | Deterministic, seeded generation. Honor `focusSkills` by choosing a variant that emphasizes them, and avoid recently seen variants. Put the hidden answer in `config`. |
| `publicScenario(instance)` | Everything the learner may see. **Never include `config`.** |
| `initialState`, `applyAction`, `publicState` | The server-authoritative simulation. `applyAction` must be pure and deterministic, return `annotations` describing the quality of the action, and reject invalid actions with `error`. |
| `hint(instance, state, log, level)` | Tiered hints: strategy, then localization, then a specific next step, without solving the scenario. |
| `evaluate(instance, state, log)` | Deterministic rules producing accuracy / process / efficiency / safety, per-skill evidence, mistakes and strengths with step references, a verdict for every step, ground truth, and an expert path. |
| `describeAction(entry)` | One-line description used in logs, the replay and coaching. |
| `reveal?`, `simulateLearner?` | Post-completion reveal data, and a simulated learner for demo data and integration tests. |

Register it in `shared/modules/index.ts`.

## 2. Build the workspace (client)

Create `client/src/modules/<your-module>/index.tsx` exporting a `ClientModule` with a `Workspace` component (see `client/src/modules/types.ts`). The Scenario Player gives you `scenario`, `publicState`, `log`, `dispatch(action)` and `submit(action)`. Client code may only import **types** from `shared/modules/**`, so hidden answers never ship to the browser.

Register it in `client/src/modules/index.ts`.

## 3. What you get for free

Accounts and classes, the action log, scoring with process caps, the learner model and mastery, recurring-mistake detection, adaptive recommendations with explanations, the offline and LLM coach, debrief and replay pages, skill trees, achievements, instructor analytics and CSV export.

## Example: a Communication module (future)

* **Interactions:** branching dialogue; the learner picks or writes responses to a frustrated customer.
* **Skills:** `comm.listening`, `comm.empathy`, `comm.clarity`, `comm.deescalation`, `comm.problem_solving`.
* **Evaluation:** each choice is annotated (acknowledges feelings? asks a clarifying question? makes a promise it can't keep?). The process score rewards active listening before proposing solutions.
* **Variation:** personas, starting moods and underlying problems are seeded, and focus skills choose personas that stress empathy or clarity.
