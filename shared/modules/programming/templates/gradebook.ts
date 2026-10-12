import type { TemplateSpec } from '../types.ts';

export const gradebook: TemplateSpec = {
  id: 'prog.gradebook',
  title: 'Gradebook Average',
  summary: 'A report-card script prints wrong averages or grades. Reproduce it, trace the math, and fix the root cause.',
  difficultyRange: [1, 3],
  processWeights: { 'prog.reproduce': 0.7, 'prog.trace': 0.7, 'prog.localize': 0.5, 'prog.verify': 0.5 },
  prerequisites: [],
  estimatedMinutes: 8,
  tags: ['javascript', 'loops', 'arrays', 'averages'],
  fileName: 'gradebook.js',
  context: "The class gradebook script computes each student's average and letter grade for report cards.",
  reporters: ['Ms. Rivera (7th-grade math teacher)', 'Mr. Okafor (science department)', 'Front office (report-card printing)'],
  code: `// Gradebook helpers used to print report cards.
// Scores are numbers from 0 to 100; a student with no scores averages 0.
function average(scores) {
  if (scores.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < scores.length; i++) {
    sum += scores[i];
  }
  return sum / scores.length;
}

function letterGrade(avg) {
  if (avg >= 90) return 'A';
  if (avg >= 80) return 'B';
  if (avg >= 70) return 'C';
  if (avg >= 60) return 'D';
  return 'F';
}

function reportCard(name, scores) {
  const avg = average(scores);
  return name + ': ' + avg.toFixed(1) + ' (' + letterGrade(avg) + ')';
}`,
  tests: [
    { id: 'avg-basic', name: 'average of three scores', call: 'average([90, 80, 70])', expected: 80, visible: true },
    { id: 'avg-single', name: 'average of a single score', call: 'average([100])', expected: 100, visible: true },
    { id: 'avg-empty', name: 'no scores averages 0', call: 'average([])', expected: 0, visible: true },
    { id: 'grade-b', name: '85 is a B', call: 'letterGrade(85)', expected: 'B', visible: true },
    { id: 'grade-cutoff', name: 'exactly 90 is an A', call: 'letterGrade(90)', expected: 'A', visible: true },
    {
      id: 'report-card',
      name: 'report card line',
      call: "reportCard('Ana', [95, 88, 92])",
      expected: 'Ana: 91.7 (A)',
      visible: true,
    },
    { id: 'avg-decimals', name: 'average with decimal scores', call: 'average([72.5, 88, 91, 64])', expected: 78.875, visible: false },
    { id: 'grade-f', name: '59.9 is an F', call: 'letterGrade(59.9)', expected: 'F', visible: false },
    { id: 'report-empty', name: 'report card with no scores', call: "reportCard('Lee', [])", expected: 'Lee: 0.0 (F)', visible: false },
  ],
  bugs: [
    {
      id: 'loop-bound',
      line: 8,
      find: 'i < scores.length',
      replace: 'i <= scores.length',
      category: 'off_by_one',
      conceptSkill: 'prog.boundaries',
      title: 'Loop runs one step past the end of the array',
      explanation:
        'The condition `i <= scores.length` runs one extra iteration. On the last pass `scores[i]` is `undefined`, and `sum + undefined` is `NaN`, which poisons the whole average. Indexes run from 0 to length - 1, so the loop must use `i < scores.length`.',
      symptom: 'Report cards show NaN for every student who has scores',
      repro: 'avg-basic',
      actual: 'NaN',
      subtlety: 1,
      probe: 'Log `i` and `scores[i]` inside the loop for `average([90, 80, 70])` and watch the last iteration.',
      examine: 'Trace the final iteration of the loop: which index does it read, and does that element exist?',
    },
    {
      id: 'sum-init',
      line: 7,
      find: 'let sum = 0',
      replace: 'let sum = 1',
      category: 'wrong_initial_value',
      conceptSkill: 'prog.state',
      title: 'Running total starts at 1 instead of 0',
      explanation:
        'The accumulator `sum` starts at 1, so every average includes an extra point. A running total that adds values must start at 0, the identity for addition.',
      symptom: 'Averages come out slightly too high on every report card',
      repro: 'avg-basic',
      actual: '80.33333333333333',
      subtlety: 2,
      probe: 'Log `sum` before the loop and after each iteration for `average([90, 80, 70])`.',
      examine: 'Check the value `sum` holds before the first score is added.',
    },
    {
      id: 'divisor',
      line: 11,
      find: 'sum / scores.length',
      replace: 'sum / (scores.length - 1)',
      category: 'off_by_one',
      conceptSkill: 'prog.boundaries',
      title: 'Divides by one less than the number of scores',
      explanation:
        'The average divides by `scores.length - 1`, spreading the total over one fewer score than there are. An average divides the sum by the count of values, `scores.length`.',
      symptom: 'Averages are far too high, some even above 100',
      repro: 'avg-basic',
      actual: '120',
      subtlety: 1,
      probe: 'Log `sum` and the divisor at the return statement for `average([90, 80, 70])`.',
      examine: 'Compare the divisor in the return statement with the number of scores that were added up.',
    },
    {
      id: 'empty-guard',
      line: 4,
      find: 'scores.length === 0',
      replace: 'scores === []',
      category: 'missing_edge_case',
      accept: ['wrong_operator'],
      conceptSkill: 'prog.boundaries',
      title: 'Empty-list check can never be true',
      explanation:
        '`scores === []` compares the input with a brand-new empty array. Arrays are compared by reference, not contents, so the guard never fires and an empty list reaches `0 / 0`, which is `NaN`. Check `scores.length === 0` instead.',
      symptom: 'Students with no scores yet show NaN instead of 0',
      repro: 'avg-empty',
      actual: 'NaN',
      subtlety: 3,
      probe: 'Call `average([])` in the console and log whether the first `if` in `average()` is taken.',
      examine: 'Ask what `===` does when both sides are arrays. Can a new `[]` ever be identical to the argument?',
    },
    {
      id: 'grade-cutoff',
      line: 15,
      find: 'avg >= 90',
      replace: 'avg > 90',
      category: 'wrong_operator',
      accept: ['off_by_one'],
      conceptSkill: 'prog.boundaries',
      title: 'Grade cutoff excludes exactly 90',
      explanation:
        '`avg > 90` leaves out a student with exactly 90, who falls through to the B branch. Grade cutoffs are inclusive (90 and above is an A), so the comparison must be `>=`.',
      symptom: 'A student with exactly 90.0 got a B instead of an A',
      repro: 'grade-cutoff',
      actual: "'B'",
      subtlety: 3,
      probe: 'Try `letterGrade(90)`, `letterGrade(90.1)` and `letterGrade(89.9)` in the console and compare.',
      examine: 'Check whether the comparison on this line includes the boundary value itself.',
    },
    {
      id: 'grade-arg',
      line: 24,
      find: 'letterGrade(avg)',
      replace: 'letterGrade(scores)',
      category: 'wrong_variable',
      conceptSkill: 'prog.state',
      title: 'Passes the score list instead of the average to letterGrade',
      explanation:
        '`reportCard` calls `letterGrade(scores)` with the whole array. Comparing an array with a number converts it to `NaN`, every comparison is false, and the grade falls through to F. It must pass the computed average, `avg`.',
      symptom: 'Every report card shows an F, even for top students',
      repro: 'report-card',
      actual: "'Ana: 91.7 (F)'",
      subtlety: 2,
      probe: "Log the argument that `reportCard()` passes to `letterGrade()` for `reportCard('Ana', [95, 88, 92])`.",
      examine: 'Check which variable is passed to `letterGrade()` on this line.',
    },
  ],
};
