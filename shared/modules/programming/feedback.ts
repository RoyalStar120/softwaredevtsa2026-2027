/** Feedback guidelines (mistakes, strengths) and the offline coach's knowledge base. */

import type { KnowledgeTopic, MistakeDef, StrengthDef } from '../../types.ts';

const m = (d: MistakeDef): [string, MistakeDef] => [d.code, d];
const s = (d: StrengthDef): [string, StrengthDef] => [d.code, d];

export const MISTAKES: Record<string, MistakeDef> = Object.fromEntries([
  m({
    code: 'prog.edited_before_reproducing',
    title: 'Edited code before reproducing the bug',
    severity: 'major',
    skillIds: ['prog.reproduce', 'prog.localize'],
    why: 'Changing code before you have seen the failure means you do not know what "fixed" looks like, and every later result mixes your change with the original bug.',
    instead: 'Run the tests (or call the function in the console) first, note which cases fail and how, then form a hypothesis before touching the code.',
    realWorld: 'On a team, "fixes" made before reproducing a bug report often fix nothing and add new risk to a release.',
  }),
  m({
    code: 'prog.trial_and_error',
    title: 'Guess-and-check edits',
    severity: 'major',
    skillIds: ['prog.trace', 'prog.localize'],
    why: 'Repeatedly editing and re-running without new evidence is slow, and even a passing result does not tell you why the code works.',
    instead: 'After a failed attempt, stop and gather evidence: log the values on the failing path or call the function with a small input, then change the one line the evidence points to.',
    realWorld: 'Random edits that happen to pass the tests often hide the real defect, which comes back in production.',
  }),
  m({
    code: 'prog.shotgun_changes',
    title: 'Unrelated lines changed',
    severity: 'minor',
    skillIds: ['prog.localize', 'prog.verify'],
    why: 'Changes far from the root cause make the fix harder to review and can introduce new bugs in code that was working.',
    instead: 'Keep the diff focused on the faulty line. Undo exploratory edits (or use Reset) once you have found the real cause.',
  }),
  m({
    code: 'prog.submitted_without_verifying',
    title: 'Submitted without re-running the tests',
    severity: 'major',
    skillIds: ['prog.verify'],
    why: 'Without a full test run after your last edit you cannot know whether the fix works or broke something else.',
    instead: 'After every fix, re-run the whole test suite and submit only when you have seen it pass.',
    realWorld: 'Unverified "quick fixes" are a classic cause of broken builds and emergency rollbacks.',
  }),
  m({
    code: 'prog.leftover_debug_code',
    title: 'Debug logging left in the code',
    severity: 'minor',
    skillIds: ['prog.verify'],
    why: 'Leftover console.log calls clutter output, can leak data, and show the change was not cleaned up before shipping.',
    instead: 'Remove your console.log lines once they have served their purpose, then re-run the tests.',
  }),
  m({
    code: 'prog.introduced_regression',
    title: 'Introduced a regression',
    severity: 'minor',
    skillIds: ['prog.verify', 'prog.localize'],
    why: 'A test that passed before your edit and fails after it means the edit broke working behavior.',
    instead: 'When a previously passing test turns red, undo or rethink that edit before continuing. Regressions point to the wrong change.',
  }),
  m({
    code: 'prog.overfit_to_tests',
    title: 'Fix only works for the visible tests',
    severity: 'major',
    skillIds: ['prog.verify', 'prog.boundaries'],
    why: 'The visible tests passed but hidden edge cases failed, so the change patched symptoms instead of the general rule.',
    instead: 'Fix the root cause so the code is correct for every input, and try edge cases yourself (empty input, boundaries, strings) before submitting.',
  }),
  m({
    code: 'prog.misdiagnosed_root_cause',
    title: 'Diagnosis did not match the root cause',
    severity: 'minor',
    skillIds: ['prog.localize'],
    why: 'Naming the wrong cause means the understanding behind the fix is shaky, and the same kind of bug is likely to return.',
    instead: 'Before submitting, explain in one sentence why the faulty line produced the observed symptom.',
  }),
  m({
    code: 'prog.gave_up_unsolved',
    title: 'Submitted with failing tests',
    severity: 'major',
    skillIds: ['prog.verify'],
    why: 'The submitted code still fails tests, so the reported bug is not fixed.',
    instead: 'If you are stuck, go back to evidence: compare expected vs actual for one failing test and trace that single input through the code, or take a hint.',
  }),
  m({
    code: 'prog.oversized_fix',
    title: 'Rewrote more than needed',
    severity: 'minor',
    skillIds: ['prog.verify'],
    why: 'Large rewrites around a one-line bug are harder to review and risk changing behavior that was correct.',
    instead: 'Aim for the smallest change that fixes the root cause; usually that is one line.',
  }),
]);

export const STRENGTHS: Record<string, StrengthDef> = Object.fromEntries([
  s({
    code: 'prog.reproduced_first',
    title: 'Reproduced before editing',
    skillIds: ['prog.reproduce'],
    why: 'Seeing the failure first tells you exactly what "fixed" must look like.',
  }),
  s({
    code: 'prog.evidence_based',
    title: 'Evidence-based localization',
    skillIds: ['prog.localize', 'prog.trace'],
    why: 'You narrowed the failure down with evidence, and your first change went straight to the faulty code.',
  }),
  s({
    code: 'prog.minimal_fix',
    title: 'Minimal, focused fix',
    skillIds: ['prog.verify'],
    why: 'A small diff at the root cause is easy to review and unlikely to break anything else.',
  }),
  s({
    code: 'prog.verified_fix',
    title: 'Verified the fix',
    skillIds: ['prog.verify'],
    why: 'Re-running the full suite after the last edit proves the fix works and nothing regressed.',
  }),
  s({
    code: 'prog.used_experiments',
    title: 'Tested hypotheses in the console',
    skillIds: ['prog.trace'],
    why: 'Small console experiments turn guesses into facts quickly.',
  }),
  s({
    code: 'prog.correct_diagnosis',
    title: 'Accurate diagnosis',
    skillIds: ['prog.localize'],
    why: 'You identified both the faulty line and the kind of mistake, which shows real understanding of the bug.',
  }),
]);

export const KNOWLEDGE: KnowledgeTopic[] = [
  {
    id: 'prog.console-log',
    title: 'Debugging with console.log',
    keywords: ['console', 'log', 'print', 'logging', 'console.log', 'inspect', 'values'],
    answer:
      'Put `console.log` right where you suspect values go wrong and print the variables involved, labeled: `console.log("i", i, "sum", sum)`. Run ONE failing input so the output is short, and compare each printed value with what you predicted. The first line where reality differs from your prediction is where the bug lives. Remove the logs when you are done.',
  },
  {
    id: 'prog.failing-tests',
    title: 'Reading failing tests',
    keywords: ['test', 'tests', 'failing', 'expected', 'actual', 'red', 'assertion'],
    answer:
      'Each failing test tells you an input, the expected output and the actual output. Compare several failing tests: what do their inputs have in common, and how do the passing ones differ? A wrong value of NaN, undefined or a string often points straight at the kind of bug.',
  },
  {
    id: 'prog.scientific',
    title: 'Scientific debugging',
    keywords: ['hypothesis', 'experiment', 'scientific', 'strategy', 'approach', 'method', 'process', 'debug'],
    answer:
      'Treat debugging like an experiment: (1) reproduce the failure, (2) form a specific hypothesis ("the loop reads one element too many"), (3) design a quick test of it (a console call or a log), (4) change ONE thing based on the evidence, (5) re-run everything. If the evidence contradicts your hypothesis, form a new one instead of making random edits.',
  },
  {
    id: 'prog.off-by-one',
    title: 'Off-by-one errors',
    keywords: ['off-by-one', 'off', 'one', 'index', 'loop', 'length', 'boundary', 'fencepost'],
    answer:
      'Arrays are indexed 0 to length - 1, so a loop over every element uses `i < arr.length`. `<=` reads one element past the end (undefined). Counting down, include index 0 with `i >= 0`. When converting between 1-based (pages, people counting) and 0-based (indexes), you usually need a `- 1` or `+ 1`.',
  },
  {
    id: 'prog.boundaries',
    title: 'Comparison operators and boundaries',
    keywords: ['comparison', 'operator', 'greater', 'less', 'inclusive', 'exclusive', 'cutoff', 'threshold', 'boundary'],
    answer:
      'Ask whether the boundary value itself belongs in the range: "90 and above" is `>= 90`, "more than 16" is `> 16`. Test the exact boundary value and one value on each side (89.9, 90, 90.1): that is where `>` vs `>=` bugs hide.',
  },
  {
    id: 'prog.logic',
    title: 'Boolean logic: && vs ||',
    keywords: ['and', 'or', '&&', '||', 'boolean', 'logic', 'condition', 'inverted', 'not'],
    answer:
      'With `&&` every part must be true; with `||` any one part is enough. A range check needs `&&` (`ch >= "a" && ch <= "z"`). "Not a letter AND not a digit" is `!isLetter && !isDigit`. Evaluate the condition by hand for one concrete value to see if it behaves as intended.',
  },
  {
    id: 'prog.mutation',
    title: 'Mutation and copying arrays',
    keywords: ['mutation', 'mutate', 'sort', 'copy', 'reference', 'alias', 'in-place', 'slice', 'spread'],
    answer:
      'Arrays and objects are passed by reference: changing them inside a function changes the caller\'s data. `sort()`, `reverse()`, `push()` and `splice()` modify the array in place. Copy first with `[...arr]` or `arr.slice()` when the caller\'s data must stay unchanged.',
  },
  {
    id: 'prog.coercion',
    title: 'Type coercion (string + number)',
    keywords: ['string', 'number', 'coercion', 'type', 'concatenation', 'parse', 'parseint', 'parsefloat', 'typeof'],
    answer:
      'Form fields and URL parameters are strings. `+` concatenates if either side is a string (`0 + "2"` is "02"), while `*`, `-` and `/` convert to numbers. Convert input explicitly with `Number(x)` or `parseFloat(x)`; `parseInt("23.5")` drops the decimals. Use `typeof` in a log when a value looks wrong.',
  },
  {
    id: 'prog.edge-cases',
    title: 'Edge cases: empty input and NaN',
    keywords: ['edge', 'empty', 'nan', 'null', 'undefined', 'zero', 'infinity', 'truthy', 'falsy'],
    answer:
      'Always ask what happens with an empty array, zero, or missing data. `0 / 0` is NaN and `Math.max()` of nothing is -Infinity. Empty arrays are truthy, so `if (!arr)` does not detect them; check `arr.length === 0`. NaN is not equal to anything (even itself); use `Number.isNaN(x)`. Arrays compare by reference, so `arr === []` is always false.',
  },
  {
    id: 'prog.accumulators',
    title: 'Accumulators and initial values',
    keywords: ['accumulator', 'sum', 'total', 'count', 'initial', 'reduce', 'running', 'reset'],
    answer:
      'A running total starts at the identity value (0 for sums) and must add to itself (`total += x`, not `total = x`). `reduce` needs an explicit initial value (`arr.reduce(fn, 0)`), otherwise the first element is used as the start. When a counter restarts, reset it to the value it should have before counting anything.',
  },
  {
    id: 'prog.returns',
    title: 'Missing returns in arrow functions',
    keywords: ['return', 'arrow', 'undefined', 'map', 'braces', 'callback'],
    answer:
      'An arrow function with an expression body returns automatically: `x => x.name`. With curly braces it needs `return`: `x => { return x.name; }`. Without it, `map` collects `undefined` values.',
  },
  {
    id: 'prog.minimal-fix',
    title: 'Minimal fixes and regression testing',
    keywords: ['minimal', 'fix', 'regression', 'verify', 'rerun', 're-run', 'cleanup', 'diff', 'review'],
    answer:
      'Fix the root cause with the smallest change that makes it correct for every input, usually one line. Then re-run the FULL test suite, not just the test you were watching, to catch regressions, and remove debugging code before submitting.',
  },
];
