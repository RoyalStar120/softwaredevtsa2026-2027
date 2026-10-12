# Evaluation plan: does SkillBridge help people improve?

The question is not "does the app work" but "do learners get better at the skill, and does that transfer to new situations?"

## Study design (small-group pilot)

| Phase | What | SkillBridge feature |
|---|---|---|
| 1. Baseline | Each participant completes a **baseline assessment** (e.g. *Porch Light*, difficulty 2), with no hints and no coaching until it's done. | Instructor → New assignment → type **Baseline test** |
| 2. Practice | 3–5 short sessions of adaptive practice (about 20 minutes each). The adaptive engine picks scenarios. | Learner home → *Start practice* |
| 3. Transfer | A **different** scenario that measures the same skills (e.g. *Workshop Lights*, difficulty 3). | New assignment → type **Transfer test** |
| 4. Retention | Repeat a transfer-style assessment about 1 week later. | Another transfer assignment |
| 5. Feedback | Short survey: Were explanations useful? Were recommended scenarios relevant? Was anything confusing? | (external form) |

### Measures (all computed or exportable in the app)
* **Pre vs. post:** baseline score vs. transfer score per student (Learning evidence tab).
* **Process change:** safety violations, wasted readings, edits-before-reproducing per attempt (CSV `mistakes`, `process`, `safety` columns).
* **Error reduction:** average mistakes on the 1st, 2nd, 3rd… attempt.
* **Recurring patterns resolved:** mistakes that stopped recurring after targeted practice.
* **Usability:** time to start a first scenario without help; number of times a participant asks for help; SUS questionnaire (optional).

### Reporting
Report the **actual** numbers, the sample size (n), and these limitations:
* Small sample from one class.
* No control group (a stronger version would randomize half to fixed-sequence practice).
* Novelty effects; short time frame.
* Simulation fidelity: performance in a simulator is not certification.

**Do not claim improvement before collecting data.** The bundled demo class is *simulated* and must not be presented as results.

## Software testing performed
* Unit and integration tests (`npm test`): programming templates (each bug reproducible, each reference passes), generators (deterministic, honor focus, avoid repeats), evaluators (expert vs. careless sequences), learner model (mastery requires repetition), adaptive engine (targets weaknesses and recurring mistakes, raises difficulty with ability, avoids repeats), electrical solver (series/parallel physics) and safety detection.
* End-to-end (`scripts/verify.mjs`): full learner loop through the API, coach answers, instructor analytics, CSV export, and screenshots of every page, including mobile.
