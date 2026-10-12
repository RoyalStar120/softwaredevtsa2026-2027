import type { TemplateSpec } from '../types.ts';

export const streak: TemplateSpec = {
  id: 'prog.streak',
  title: 'Habit Streak Counter',
  summary: 'Users say their habit streaks are wrong. Trace the loop state carefully, including what happens at the ends.',
  difficultyRange: [3, 5],
  processWeights: { 'prog.reproduce': 0.5, 'prog.trace': 0.8, 'prog.localize': 0.7, 'prog.verify': 0.7 },
  prerequisites: ['prog.trace', 'prog.localize'],
  estimatedMinutes: 12,
  tags: ['javascript', 'loops', 'state', 'counters'],
  fileName: 'streaks.js',
  context: 'The habit-tracker app computes streaks and the motivational message on its home screen.',
  reporters: ['App-store review', 'Beta tester Kai', 'Product designer Lena'],
  pairs: [
    'inverted-done+first-day',
    'inverted-done+week-boundary',
    'best-overwrite+first-day',
    'best-overwrite+week-boundary',
    'reset-one+first-day',
    'reset-one+week-boundary',
    'last-run+first-day',
    'last-run+week-boundary',
    'inverted-done+best-overwrite',
    'best-overwrite+last-run',
  ],
  code: `// Habit tracker: days[i] is true if the habit was done that day (oldest first).
// A streak is a run of consecutive true days; the current streak ends today.
function longestStreak(days) {
  let best = 0;
  let run = 0;
  for (const done of days) {
    if (done) {
      run++;
    } else {
      best = Math.max(best, run);
      run = 0;
    }
  }
  return Math.max(best, run);
}

function currentStreak(days) {
  let count = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (!days[i]) break;
    count++;
  }
  return count;
}

function streakMessage(days) {
  const streak = currentStreak(days);
  if (streak >= 7) return 'On fire! ' + streak + ' days in a row';
  if (streak > 0) return streak + ' day streak';
  return 'Start a new streak today';
}`,
  tests: [
    { id: 'longest-middle', name: 'longest run in the middle', call: 'longestStreak([true, true, false, true])', expected: 2, visible: true },
    { id: 'longest-after-miss', name: 'run after a missed day', call: 'longestStreak([true, false, true, true])', expected: 2, visible: true },
    { id: 'longest-ends-today', name: 'longest run still going', call: 'longestStreak([false, true, true, true])', expected: 3, visible: true },
    {
      id: 'longest-first',
      name: 'long run first, shorter run later',
      call: 'longestStreak([true, true, true, false, true, false])',
      expected: 3,
      visible: true,
    },
    { id: 'current', name: 'current streak after a miss', call: 'currentStreak([true, true, false, true, true])', expected: 2, visible: true },
    { id: 'current-all', name: 'every day done', call: 'currentStreak([true, true, true])', expected: 3, visible: true },
    {
      id: 'message-week',
      name: '7-day streak message',
      call: 'streakMessage([true, true, true, true, true, true, true])',
      expected: 'On fire! 7 days in a row',
      visible: true,
    },
    { id: 'longest-empty', name: 'no days recorded yet', call: 'longestStreak([])', expected: 0, visible: false },
    {
      id: 'message-broken',
      name: 'streak broken today',
      call: 'streakMessage([true, false])',
      expected: 'Start a new streak today',
      visible: false,
    },
    { id: 'message-short', name: 'short streak message', call: 'streakMessage([false, true, true])', expected: '2 day streak', visible: false },
  ],
  bugs: [
    {
      id: 'inverted-done',
      line: 7,
      find: 'if (done)',
      replace: 'if (!done)',
      category: 'wrong_operator',
      conceptSkill: 'prog.logic',
      title: 'Condition is inverted: counts missed days',
      explanation:
        '`if (!done)` grows the run on MISSED days and resets it on completed days, so the function measures the longest run of misses. The run must grow when `done` is true.',
      symptom: 'longestStreak() seems to count missed days instead of completed ones',
      repro: 'longest-middle',
      actual: '1',
      subtlety: 2,
      probe: 'Log `done` and `run` on every iteration for `longestStreak([true, true, false, true])`.',
      examine: 'Which branch runs on a day when the habit WAS done?',
    },
    {
      id: 'reset-one',
      line: 11,
      find: 'run = 0',
      replace: 'run = 1',
      category: 'wrong_initial_value',
      conceptSkill: 'prog.state',
      title: 'Run restarts at 1 after a missed day',
      explanation:
        'After a missed day the new run has 0 days so far, so `run` must reset to 0. Resetting to 1 counts the missed day itself as part of the next streak.',
      symptom: 'Streaks come out one day too long after a missed day',
      repro: 'longest-after-miss',
      actual: '3',
      subtlety: 3,
      probe: 'Log `run` right after a missed day in `longestStreak([true, false, true, true])`.',
      examine: 'Right after a missed day, how many days long is the new streak?',
    },
    {
      id: 'best-overwrite',
      line: 10,
      find: 'best = Math.max(best, run)',
      replace: 'best = run',
      category: 'wrong_variable',
      accept: ['wrong_operator'],
      conceptSkill: 'prog.state',
      title: 'Best streak is overwritten by a shorter later run',
      explanation:
        '`best = run` replaces the record with whatever run just ended, even when it is shorter. Keep the larger of the two: `best = Math.max(best, run)`.',
      symptom: 'An old long streak disappears after a later, shorter one',
      repro: 'longest-first',
      actual: '1',
      subtlety: 4,
      probe: 'Log `best` and `run` each time a missed day ends a run in `longestStreak([true, true, true, false, true, false])`.',
      examine: 'When a run ends, should `best` always become that run, or only when it is longer?',
    },
    {
      id: 'last-run',
      line: 14,
      find: 'return Math.max(best, run)',
      replace: 'return best',
      category: 'missing_edge_case',
      accept: ['off_by_one'],
      conceptSkill: 'prog.boundaries',
      title: 'A streak still going at the end is never counted',
      explanation:
        '`best` is only updated when a missed day ends a run. If the array ends with completed days, that final run never reaches the update. Compare it once more after the loop: `Math.max(best, run)`.',
      symptom: "A streak that is still going isn't counted: [miss, done, done, done] shows 0",
      repro: 'longest-ends-today',
      actual: '0',
      subtlety: 3,
      probe: 'Log `best` and `run` after the loop for `longestStreak([false, true, true, true])`.',
      examine: 'What happens to the run that is still in progress when the loop finishes?',
    },
    {
      id: 'first-day',
      line: 19,
      find: 'i >= 0',
      replace: 'i > 0',
      category: 'off_by_one',
      conceptSkill: 'prog.boundaries',
      title: 'Backward loop stops before the first day',
      explanation:
        'Counting down, the loop must include index 0. With `i > 0` it stops at index 1, so the first day is never checked and a streak covering every day is one short.',
      symptom: 'A streak covering every recorded day shows one day too few',
      repro: 'current-all',
      actual: '2',
      subtlety: 4,
      probe: 'Log `i` on each iteration of `currentStreak([true, true, true])`.',
      examine: 'Which indexes does this loop visit? Does it include the first element?',
    },
    {
      id: 'week-boundary',
      line: 28,
      find: 'streak >= 7',
      replace: 'streak > 7',
      category: 'off_by_one',
      accept: ['wrong_operator'],
      conceptSkill: 'prog.boundaries',
      title: "'On fire' message needs 8 days instead of 7",
      explanation: 'The message is for streaks of 7 days or more, so the comparison must include 7: `streak >= 7`.',
      symptom: "A full 7-day streak shows '7 day streak' instead of the 'On fire!' message",
      repro: 'message-week',
      actual: "'7 day streak'",
      subtlety: 3,
      probe: 'Call `streakMessage()` with 6, 7 and 8 true days and compare the messages.',
      examine: 'Does this comparison include a streak of exactly 7?',
    },
  ],
};
