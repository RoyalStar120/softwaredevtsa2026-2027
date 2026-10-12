# SkillBridge: Universal Adaptive Skills-Training Platform

**TSA Software Development.** SkillBridge observes *how* a learner performs a skill, then changes *what* they practice next.

Learners don't read lessons and take quizzes. They work through interactive simulations: debugging real JavaScript, or diagnosing faults in physically simulated circuits. Every action is recorded and evaluated for **process** as well as outcome, then explained by a grounded AI coach. The **adaptive practice engine** picks the next scenario to target the learner's specific weaknesses and recurring mistakes.

---

## Quick start

Requirements: **Node.js 22.18+ or 24+** (uses Node's built-in TypeScript type stripping and built-in SQLite, with no native modules to compile).

```bash
npm install
npm run build      # build the React client
npm start          # http://localhost:3000  (auto-creates demo data on first run)
```

Shortcut: after `npm install`, `node server.js` does the same as `npm start` and builds the client first if `dist/` is missing.

Development mode (hot reload): `npm run dev`, then open http://localhost:5173.

### Demo accounts
| Role | Username | Password | What you'll see |
|---|---|---|---|
| Learner | `student` | `skillbridge` | Alex Chen, whose history includes a *recurring* safety mistake, so the adaptive engine's targeted recommendation is visible immediately |
| Instructor | `teacher` | `skillbridge` | Ms. Carter's class "Period 3", with simulated learners, assignments, assessments and analytics |

The sign-in page also has one-click demo buttons. To reset the demo data, run `npm run seed`. For a timed 5-minute judge walkthrough with likely questions, see [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

### Optional: LLM coach
Copy `.env.example` to `.env` and set `GEMINI_API_KEY` or `OPENAI_API_KEY`. Without a key, the built-in coach answers from the same grounded data and everything works offline, which is useful at competition venues with unreliable Wi-Fi.

---

## What's inside

| Feature | Where |
|---|---|
| Interactive simulations | Electrical: DC circuits solved with nodal analysis (multimeter, lockout/tagout, inspection, bench tests, repairs, fuses that re-blow, relays). Programming: real JS in a sandboxed Web Worker (tests, console experiments, line flagging, diagnosis). |
| Detailed action tracking | Every action is applied by the **server-authoritative** engine and stored with hidden annotations: was the reading informative? was it unsafe? was the edit on target? |
| Process evaluation | Deterministic rules score accuracy, process, efficiency and safety separately. Electrical runs each action against every still-plausible fault hypothesis and compares the learner with a greedy **expert path**. Unsafe processes are capped at 60 points; trial-and-error at 80. |
| AI coaching | Debrief, plus follow-up chat grounded only in engine output (evaluation, annotated log, expert path, feedback guidelines). Gemini/OpenAI optional; offline coach built in. |
| Adaptive practice engine | `shared/adaptive.ts`. Scores every template × difficulty on weakness, desirable difficulty (~72% expected success), recurring mistakes, spaced reinforcement, skill integration, novelty and recency. Every recommendation explains itself. |
| Scenario variation | Seeded generators pick faults or bugs that emphasize the engine's chosen focus skills. 4 circuit templates (35 faults, including double faults) and 7 programming templates (6 bugs each, plus two-bug variants). |
| Learner model & mastery | `shared/learnerModel.ts`. An Elo/IRT-style ability per skill with shrinking uncertainty. "Mastered" requires repeated strong performance. Spaced review intervals. |
| Instructor dashboard | Class mastery heatmap, common mistakes with one-click targeted practice, assignments (scenarios or adaptive skill objectives), baseline/transfer assessments, a learning-evidence tab, student drill-down, CSV export. |
| Skill progression | Skill trees with prerequisites, mastery history, error-reduction trend, process-based achievements. |

---

## Architecture

```
client/ (React + Vite)          server/ (Express + node:sqlite)          shared/ (isomorphic TypeScript)
 ├─ pages/ScenarioPlayer  ──▶  /api/attempts/:id/actions  ──▶  module.applyAction()  (simulation engine)
 ├─ modules/electrical          action log (attempt_actions)        module.evaluate()     (rules & evaluation)
 ├─ modules/programming         finalize():                         learnerModel.updateSkill()
 └─ pages/Debrief      ◀──────  scoring → learner model → patterns → adaptive.recommend()
                                → achievements → coach                coach.offlineDebrief() / LLM
```

* **Server-authoritative simulation:** hidden answers (`ScenarioInstance.config`) never leave the server before completion. The client bundle never imports module engine code.
* **Universal by design:** every module implements one contract, `SkillModule` (`shared/types.ts`). The platform supplies accounts, logging, learner model, adaptive engine, coaching and dashboards. See [docs/MODULE_GUIDE.md](docs/MODULE_GUIDE.md).

```
shared/
  types.ts           SkillModule contract, evaluation types
  learnerModel.ts    skill estimates and mastery
  adaptive.ts        adaptive practice engine
  patterns.ts        recurring-mistake detection
  scoring.ts         platform scoring (process caps)
  coach.ts           offline grounded coach + LLM context builder
  achievements.ts
  modules/electrical/   solver, sim, planner (expert path), engine, evaluate, content, circuits, bot
  modules/programming/  templates, grading, codeAnalysis, engine, evaluate, feedback, bot
server/
  index.ts, routes.ts, db.ts, auth.ts, llm.ts, seed.ts
  services/          attempts (practice loop), learner, recommend, coach, instructor
client/src/
  pages/             Landing, Auth, LearnerHome, Practice, ScenarioPlayer, Debrief, Progress,
                     InstructorHome, ClassDetail, StudentDetail, About
  modules/           electrical + programming workspaces
```

---

## Testing

```bash
npm test             # unit + integration tests (node:test)
npm run typecheck    # TypeScript
node scripts/verify.mjs http://localhost:3000   # API smoke test + headless Chrome screenshots
```

## Measuring effectiveness (not just "does it work")

See [docs/EVALUATION_PLAN.md](docs/EVALUATION_PLAN.md): baseline vs. transfer assessment, error reduction, retention, usability and learner feedback. The **Learning evidence** tab computes these from real attempts.

> **Honesty note:** the demo class contains **simulated learners**. Their histories were generated by running simulated learners through the real engines, and they are labeled as simulated in the UI and CSV. They demonstrate the analytics; they are **not** evidence that SkillBridge improves learning. Collect real data before making claims.

## Safety

The electrical simulations are practice only. They do not replace certified instruction, professional supervision, or local electrical codes. Learner code runs only in a sandboxed browser Web Worker, never on the server.
