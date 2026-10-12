import type { TemplateSpec } from '../types.ts';

const STOCK = "[{ name: 'Bolts', qty: 12 }, { name: 'Nuts', qty: 3 }, { name: 'Washers', qty: 7 }]";

export const inventory: TemplateSpec = {
  id: 'prog.inventory',
  title: 'Restock Report',
  summary: 'The warehouse restock report misbehaves and may be corrupting shared data. Find out what really changed.',
  difficultyRange: [3, 5],
  processWeights: { 'prog.reproduce': 0.5, 'prog.trace': 0.6, 'prog.localize': 0.8, 'prog.verify': 0.8 },
  prerequisites: ['prog.trace', 'prog.localize'],
  estimatedMinutes: 12,
  tags: ['javascript', 'arrays', 'mutation', 'sorting', 'callbacks'],
  fileName: 'restock.js',
  context: 'The warehouse app builds a restock report and a purchase order from the live inventory list.',
  reporters: ['Warehouse lead Sam', 'Purchasing (Mr. Daniels)', 'Inventory clerk Jo'],
  pairs: [
    'sort-mutates+threshold-exclusive',
    'sort-mutates+map-no-return',
    'sort-mutates+order-property',
    'sort-mutates+reduce-initial',
    'comparator-reversed+threshold-exclusive',
    'comparator-reversed+order-property',
    'comparator-reversed+reduce-initial',
    'threshold-exclusive+order-property',
    'threshold-exclusive+reduce-initial',
    'map-no-return+order-property',
    'map-no-return+reduce-initial',
    'order-property+reduce-initial',
  ],
  code: `// Warehouse restock report. Items look like { name: 'Bolts', qty: 12 }.
// lowStock: names of items at or below the threshold, lowest quantity first.
// The inventory screen shares the items array, so nothing here may modify it.
function lowStock(items, threshold) {
  const sorted = [...items].sort((a, b) => a.qty - b.qty);
  const low = sorted.filter((item) => item.qty <= threshold);
  return low.map((item) => item.name);
}

function restockOrder(items, threshold, target) {
  const order = {};
  for (const item of items) {
    if (item.qty <= threshold) {
      order[item.name] = target - item.qty;
    }
  }
  return order;
}

function totalUnits(items) {
  return items.reduce((sum, item) => sum + item.qty, 0);
}`,
  tests: [
    { id: 'low-basic', name: 'items at or below 10, lowest first', call: `lowStock(${STOCK}, 10)`, expected: ['Nuts', 'Washers'], visible: true },
    {
      id: 'low-threshold',
      name: 'an item exactly at the threshold is included',
      call: "lowStock([{ name: 'Gloves', qty: 5 }, { name: 'Tape', qty: 2 }, { name: 'Glue', qty: 9 }], 5)",
      expected: ['Tape', 'Gloves'],
      visible: true,
    },
    {
      id: 'no-mutation',
      name: "the caller's inventory order is unchanged",
      call: `(() => { const stock = ${STOCK}; lowStock(stock, 10); return stock.map((s) => s.name); })()`,
      expected: ['Bolts', 'Nuts', 'Washers'],
      visible: true,
    },
    {
      id: 'order',
      name: 'restock order tops items up to the target',
      call: `restockOrder(${STOCK}, 10, 20)`,
      expected: { Nuts: 17, Washers: 13 },
      visible: true,
    },
    {
      id: 'units',
      name: 'total units in stock',
      call: "totalUnits([{ name: 'Bolts', qty: 12 }, { name: 'Nuts', qty: 3 }])",
      expected: 15,
      visible: true,
    },
    { id: 'low-none', name: 'nothing at or below the threshold', call: "lowStock([{ name: 'Bolts', qty: 12 }], 10)", expected: [], visible: true },
    { id: 'units-empty', name: 'an empty inventory has 0 units', call: 'totalUnits([])', expected: 0, visible: false },
    {
      id: 'low-ties',
      name: 'equal quantities keep their original order',
      call: "lowStock([{ name: 'A', qty: 4 }, { name: 'B', qty: 1 }, { name: 'C', qty: 4 }, { name: 'D', qty: 0 }], 4)",
      expected: ['D', 'B', 'A', 'C'],
      visible: false,
    },
    { id: 'order-empty', name: 'restock order for an empty list', call: 'restockOrder([], 5, 10)', expected: {}, visible: false },
  ],
  bugs: [
    {
      id: 'sort-mutates',
      line: 5,
      find: '[...items].sort',
      replace: 'items.sort',
      category: 'mutation',
      conceptSkill: 'prog.state',
      title: "Sorts the caller's array in place",
      explanation:
        "`Array.prototype.sort` reorders the array IN PLACE and returns that same array. `items.sort(...)` scrambles the inventory array the main screen also uses. Copy first (`[...items].sort(...)` or `items.slice().sort(...)`) so the caller's data is untouched.",
      symptom: 'After the restock report runs, the main inventory table is shown in a different order',
      repro: 'no-mutation',
      actual: "['Nuts', 'Washers', 'Bolts']",
      subtlety: 4,
      probe: 'In the console, build an array, pass it to `lowStock()`, then print the original array again.',
      examine: 'Does `sort()` return a new array, or reorder the one it is called on?',
    },
    {
      id: 'comparator-reversed',
      line: 5,
      find: 'a.qty - b.qty',
      replace: 'b.qty - a.qty',
      category: 'wrong_operator',
      accept: ['wrong_variable'],
      conceptSkill: 'prog.logic',
      title: 'Comparator sorts from highest to lowest',
      explanation:
        'A sort comparator returns a negative number when `a` should come first. `b.qty - a.qty` puts larger quantities first; buyers need the lowest stock first, which is `a.qty - b.qty`.',
      symptom: 'The report lists the best-stocked items first instead of the emptiest',
      repro: 'low-basic',
      actual: "['Washers', 'Nuts']",
      subtlety: 2,
      probe: 'Log `sorted.map((i) => i.qty)` inside `lowStock()`.',
      examine: "For a comparator, which sign means 'a comes first'? Work it out for qty 3 vs qty 7.",
    },
    {
      id: 'threshold-exclusive',
      line: 6,
      find: 'item.qty <= threshold',
      replace: 'item.qty < threshold',
      category: 'off_by_one',
      accept: ['wrong_operator'],
      conceptSkill: 'prog.boundaries',
      title: 'Items exactly at the threshold are left out',
      explanation:
        'The report covers items AT or below the threshold, so the filter must be `<=`. With `<`, an item whose quantity equals the threshold is skipped.',
      symptom: 'Gloves (5 left, threshold 5) is missing from the restock report',
      repro: 'low-threshold',
      actual: "['Tape']",
      subtlety: 3,
      probe: 'Log each `item.qty` and whether it passes the filter when the threshold is 5.',
      examine: 'Does the filter include an item whose quantity equals the threshold?',
    },
    {
      id: 'map-no-return',
      line: 7,
      find: '(item) => item.name',
      replace: '(item) => { item.name; }',
      category: 'missing_return',
      conceptSkill: 'prog.state',
      title: 'Arrow function with braces returns nothing',
      explanation:
        'With curly braces, an arrow function needs an explicit `return`. `(item) => { item.name; }` evaluates the name and throws it away, so `map` collects `undefined`. Use `(item) => item.name` or add `return`.',
      symptom: 'The restock report is a list of blank (undefined) entries',
      repro: 'low-basic',
      actual: '[undefined, undefined]',
      subtlety: 2,
      probe: 'Log `low` and the result of the `map` call separately in `lowStock()`.',
      examine: 'What does an arrow function with a `{ }` body return when it has no `return` statement?',
    },
    {
      id: 'order-property',
      line: 14,
      find: 'order[item.name]',
      replace: 'order.name',
      category: 'wrong_variable',
      conceptSkill: 'prog.state',
      title: "Writes to a property literally called 'name'",
      explanation:
        '`order.name` always sets the property named "name". To use the item\'s name as the key, use bracket notation: `order[item.name]`.',
      symptom: 'The restock order comes back as { name: 13 } instead of one entry per item',
      repro: 'order',
      actual: '{ name: 13 }',
      subtlety: 3,
      probe: 'Log `order` after each loop iteration in `restockOrder()`.',
      examine: 'Dot notation uses the literal property name. How do you use a variable as the key?',
    },
    {
      id: 'reduce-initial',
      line: 21,
      find: 'sum + item.qty, 0)',
      replace: 'sum + item.qty)',
      category: 'wrong_initial_value',
      conceptSkill: 'prog.state',
      title: 'reduce() has no initial value',
      explanation:
        "Without an initial value, `reduce` uses the first ITEM OBJECT as the starting sum, so `sum + item.qty` becomes '[object Object]3' (string concatenation). Pass 0 as the initial value.",
      symptom: "Total units shows '[object Object]3' instead of a number",
      repro: 'units',
      actual: "'[object Object]3'",
      subtlety: 4,
      probe: "Log `sum` inside the reducer for `totalUnits([{ name: 'A', qty: 1 }, { name: 'B', qty: 2 }])`.",
      examine: 'What is the accumulator on the first call when `reduce` gets no initial value?',
    },
  ],
};
