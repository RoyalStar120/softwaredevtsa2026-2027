import type { TemplateSpec } from '../types.ts';

export const sensor: TemplateSpec = {
  id: 'prog.sensor',
  title: 'Sensor Log Parser',
  summary: 'The greenhouse dashboard shows odd temperatures. Parse messy sensor text and handle the edge cases.',
  difficultyRange: [2, 4],
  processWeights: { 'prog.reproduce': 0.5, 'prog.trace': 0.7, 'prog.localize': 0.7, 'prog.verify': 0.6 },
  prerequisites: ['prog.reproduce', 'prog.trace'],
  estimatedMinutes: 10,
  tags: ['javascript', 'parsing', 'NaN', 'edge cases'],
  fileName: 'sensor-stats.js',
  context: 'The greenhouse dashboard parses sensor logs to show the max and average temperature.',
  reporters: ['Ag-science teacher Ms. Lopez', 'Greenhouse club student lead', 'Dashboard user report'],
  pairs: ['split-delim+empty-guard', 'parse-int+empty-guard', 'empty-guard+total-init', 'empty-guard+avg-divisor'],
  code: `// Greenhouse sensor uploads temperature logs as text, e.g. "23.5,24.1,,22.9".
// Blank or garbled readings are skipped. With no valid readings, stats are null.
function parseReadings(log) {
  const readings = [];
  for (const part of log.split(',')) {
    const value = parseFloat(part);
    if (!Number.isNaN(value)) {
      readings.push(value);
    }
  }
  return readings;
}

function maxReading(log) {
  const readings = parseReadings(log);
  if (readings.length === 0) return null;
  return Math.max(...readings);
}

function averageReading(log) {
  const readings = parseReadings(log);
  if (readings.length === 0) return null;
  let total = 0;
  for (const r of readings) total += r;
  return Math.round((total / readings.length) * 10) / 10;
}`,
  tests: [
    { id: 'parse-basic', name: 'parses decimal readings', call: "parseReadings('23.5,24.1,22.9')", expected: [23.5, 24.1, 22.9], visible: true },
    {
      id: 'parse-skip',
      name: 'skips blank and garbled readings',
      call: "parseReadings('23.5,,err,22.9')",
      expected: [23.5, 22.9],
      visible: true,
    },
    { id: 'max', name: 'highest reading', call: "maxReading('23.5,24.1,,22.9')", expected: 24.1, visible: true },
    { id: 'average', name: 'average of the valid readings', call: "averageReading('23.5,24.1,,22.9')", expected: 23.5, visible: true },
    { id: 'max-empty', name: 'an empty log has no max', call: "maxReading('')", expected: null, visible: true },
    { id: 'average-garbled', name: 'average ignores garbled entries', call: "averageReading('20,21,err')", expected: 20.5, visible: true },
    { id: 'average-blank-only', name: 'log with only blanks', call: "averageReading(',,')", expected: null, visible: false },
    { id: 'max-negative', name: 'negative temperatures', call: "maxReading('-3.5,-1.25,-7')", expected: -1.25, visible: false },
    {
      id: 'average-rounding',
      name: 'average rounds to one decimal',
      call: "averageReading('18.25,19.75,20')",
      expected: 19.3,
      visible: false,
    },
  ],
  bugs: [
    {
      id: 'parse-int',
      line: 6,
      find: 'parseFloat(part)',
      replace: 'parseInt(part)',
      category: 'type_coercion',
      conceptSkill: 'prog.state',
      title: 'parseInt drops the decimal part',
      explanation:
        "`parseInt('23.5')` stops at the decimal point and returns 23. Temperatures have decimals, so parse with `parseFloat` (or `Number`).",
      symptom: 'Temperatures lose their decimals: 24.1 shows as 24',
      repro: 'parse-basic',
      actual: '[23, 24, 22]',
      subtlety: 2,
      probe: "Call `parseReadings('23.5')` and log `part` and `value` inside the loop.",
      examine: 'What does this parsing function do with the digits after the decimal point?',
    },
    {
      id: 'nan-compare',
      line: 7,
      find: '!Number.isNaN(value)',
      replace: 'value !== NaN',
      category: 'wrong_operator',
      accept: ['type_coercion', 'missing_edge_case'],
      conceptSkill: 'prog.logic',
      title: 'Comparing with NaN is always true',
      explanation:
        '`NaN` is not equal to anything, not even itself, so `value !== NaN` is ALWAYS true and blank readings (NaN) get pushed. Use `Number.isNaN(value)` to detect NaN.',
      symptom: 'Any log with a blank reading reports NaN for the max and the average',
      repro: 'parse-skip',
      actual: '[23.5, NaN, NaN, 22.9]',
      subtlety: 3,
      probe: "Log `value` and `value !== NaN` for each part of `parseReadings('23.5,,22.9')`.",
      examine: 'What is `NaN !== NaN` in JavaScript? Try it in the console.',
    },
    {
      id: 'empty-guard',
      line: 16,
      find: 'readings.length === 0',
      replace: '!readings',
      category: 'missing_edge_case',
      conceptSkill: 'prog.boundaries',
      title: 'Empty-array guard never fires',
      explanation:
        '`!readings` is false for an empty array because arrays are always truthy in JavaScript. The guard never runs, and `Math.max()` with no arguments returns -Infinity. Check the length: `readings.length === 0`.',
      symptom: 'An empty sensor log shows a max temperature of -Infinity',
      repro: 'max-empty',
      actual: '-Infinity',
      subtlety: 2,
      probe: "Call `maxReading('')` and log `readings` and `!readings` in `maxReading()`.",
      examine: 'Is an empty array truthy or falsy in JavaScript?',
    },
    {
      id: 'split-delim',
      line: 5,
      find: "log.split(',')",
      replace: "log.split(', ')",
      category: 'wrong_variable',
      conceptSkill: 'prog.state',
      title: "Splits on ', ' but the log has no spaces",
      explanation:
        "The sensor separates readings with a bare comma. Splitting on ', ' (comma + space) finds no separator, so the whole log is one part and `parseFloat` reads only the first number.",
      symptom: 'Only the first reading in each log is used',
      repro: 'parse-basic',
      actual: '[23.5]',
      subtlety: 3,
      probe: "Log the result of the `split` call for `parseReadings('23.5,24.1,22.9')`.",
      examine: 'Compare the separator passed to `split` with the exact format of the log text.',
    },
    {
      id: 'avg-divisor',
      line: 25,
      find: 'total / readings.length',
      replace: "total / log.split(',').length",
      category: 'wrong_variable',
      conceptSkill: 'prog.state',
      title: 'Average divides by raw entries, including blanks',
      explanation:
        "The average must divide by the number of VALID readings (`readings.length`). `log.split(',').length` also counts blank and garbled entries, so every skipped reading drags the average down.",
      symptom: 'Averages drop whenever the log contains blank readings',
      repro: 'average',
      actual: '17.6',
      subtlety: 3,
      probe: "Log `total`, `readings.length` and the divisor in `averageReading('23.5,24.1,,22.9')`.",
      examine: 'Which count should the average divide by: every entry in the log, or only the valid readings?',
    },
    {
      id: 'total-init',
      line: 23,
      find: 'let total = 0',
      replace: 'let total = readings[0]',
      category: 'wrong_initial_value',
      conceptSkill: 'prog.state',
      title: 'Total starts with the first reading, counting it twice',
      explanation:
        '`total` starts at `readings[0]` and then the loop adds every reading, including the first one again. Start the accumulator at 0.',
      symptom: 'Average temperatures come out too high',
      repro: 'average',
      actual: '31.3',
      subtlety: 2,
      probe: "Log `total` before the loop in `averageReading('20,21')`. What should it start at?",
      examine: 'What value does the running total hold before the loop adds anything?',
    },
  ],
};
