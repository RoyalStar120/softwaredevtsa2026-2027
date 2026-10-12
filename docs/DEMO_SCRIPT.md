# SkillBridge: 5-minute judge demo script

A tested path through the demo data that shows the central innovation: SkillBridge watches **how** a learner works, then changes **what** they practice next.

> **Before judging:** run `npm run seed` for fresh demo data, then `npm start`, and open http://localhost:3000. No internet is needed. The built-in coach works offline.

---

## 0:00 – 0:30 · The problem (Landing page)
- Most platforms only check whether the final answer is right. Two learners with the same score can have very different skills.
- SkillBridge records every action in a realistic simulation and grades the **process** separately from the **outcome**.

## 0:30 – 2:15 · Learner demo (Alex Chen)
1. Click **Sign in → Learner demo**.
2. **Learner home → "Why SkillBridge picked this".** The top card targets Alex's *recurring* safety mistake: measuring resistance on a live circuit, seen in several recent attempts. Read one reason out loud. This is the adaptive engine at work, not a fixed lesson order.
3. Start the electrical scenario.
   - Point out the safety banner and that this is a simulation, not certification.
   - Do it the right way:
     1. Switch the **Main disconnect** OFF.
     2. Apply the **Lockout tag**.
     3. Probe two test points in **V** mode to verify 0 V.
     4. Switch to **R** mode and measure the suspect part.
     5. **Replace** the part.
     6. Remove the lockout tag and restore power to confirm the repair.
     7. Record the diagnosis and complete the work order.
4. **Debrief.**
   - **Outcome · did you get it right?** sits next to **Process · how did you get there?** An unsafe process is capped at 60 points even when the answer is correct.
   - **You vs. the expert path** and the **Action replay** show every step with its annotation.
   - **Patterns across attempts** shows whether the recurring mistake is now improving.
   - **AI coach:** click a suggested question such as *"Why was step N a problem?"* or *"What should I have done instead?"* The answer quotes Alex's own action log. The coach explains the engine's results; it never makes up the answer or decides the score.
   - **Practice a targeted weakness** goes straight to the next adaptive scenario.

## 2:15 – 2:50 · Second, contrasting module (Programming debugging)
- **Practice → Programming.** The learner edits real JavaScript, which runs in a sandboxed Web Worker.
- Show **Run all tests**, a console experiment, and flagging a suspect line with **Click a line number to flag a suspect line**. Then **Submit fix** with a diagnosis. Hidden tests catch fixes that only pass the visible tests.
- Same platform, different skill: both modules plug into one shared module contract.

## 2:50 – 3:20 · Progress (Alex)
- **My progress → Skill tree**, **Mastery over time**, **Error reduction**, **Milestones**.
- Mastery needs *repeated* strong performance across scenarios (2 of the last 3 attempts at 80% or higher, and at least 3 pieces of evidence). One lucky success never counts.

## 3:20 – 4:40 · Instructor demo (Ms. Carter)
1. Sign out, then **Instructor demo → Period 3 · Engineering & Technology**.
2. **Overview → Common mistakes across the class.** Use the button on a mistake to assign adaptive practice to just the affected students. See also **Students who may need help** and **Assignment progress**.
3. **Skill mastery** shows the heatmap of every student × skill.
4. Open a student to see **Recurring mistakes** and **What the adaptive engine would assign next**.
5. **Learning evidence** covers **Baseline vs. transfer, per student**, **Error reduction across attempts**, and **Limitations to report**.

> [!IMPORTANT]
> Say this out loud: *"The class data is simulated to demonstrate the dashboard. We make no claim that SkillBridge improves learning until we've collected real pre/post evidence."* See `docs/EVALUATION_PLAN.md`.

## 4:40 – 5:00 · Architecture and close (About page)
- A shared adaptive engine, learner model and coach, plus pluggable skill modules. To add a third skill, implement one interface (`docs/MODULE_GUIDE.md`).
- Rules are deterministic and server-authoritative, and there are automated tests (`npm test`).

---

## Likely judge questions
| Question | Short answer |
|---|---|
| Does the AI grade students? | No. Deterministic rules score accuracy, process, efficiency and safety. The coach (offline, or Gemini/OpenAI if a key is set) only explains those results and the logged actions. |
| How is "mastery" decided? | Each skill has a rating with an uncertainty that updates after every attempt, weighted by difficulty. "Mastered" also needs consistent recent performance. |
| How does it choose the next scenario? | It scores every scenario on skill need, an appropriate challenge level (about 72% expected success), recurring mistakes, spaced review, combined-skill challenges and teacher-assigned focus. The reasons are shown to the learner. |
| Can a student cheat by guessing? | Guessing is visible in the log. Replacing good parts, repeating readings and trial-and-error lower the process score, and the score is capped. |
| Is it safe? | Everything is simulated. Unsafe actions are flagged and penalized, and the safety notice states that this is not certification. |
| How would you prove it works? | Pre/post and transfer tests, error reduction, retention checks and usability surveys, as described in `docs/EVALUATION_PLAN.md`. |

## If something goes wrong
- **Odd data:** run `npm run seed`, which resets the demo accounts and the simulated class.
- **Port busy:** run `PORT=3001 npm start`.
- **No Wi-Fi:** everything runs locally, including the coach.
