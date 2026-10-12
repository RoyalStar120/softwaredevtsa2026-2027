import type { TemplateSpec } from '../types.ts';

export const pagination: TemplateSpec = {
  id: 'prog.pagination',
  title: 'Search Results Pager',
  summary: 'Search results land on the wrong pages or get mislabeled. Find the boundary that slipped.',
  difficultyRange: [1, 3],
  processWeights: { 'prog.reproduce': 0.6, 'prog.trace': 0.7, 'prog.localize': 0.5, 'prog.verify': 0.5 },
  prerequisites: [],
  estimatedMinutes: 9,
  tags: ['javascript', 'arrays', 'off-by-one', 'pagination'],
  fileName: 'pager.js',
  context: 'The search page uses these helpers to split results into pages and label them.',
  reporters: ['QA tester Marcus', 'Library volunteer Ana', 'Support ticket from a user'],
  code: `// Search results pager. page and perPage come from the URL query string
// (e.g. ?page=2&perPage=10), so they may arrive as strings. Pages start at 1.
function pageCount(total, perPage) {
  if (total <= 0) return 1;
  return Math.ceil(total / Number(perPage));
}

function getPage(items, page, perPage) {
  const size = Number(perPage);
  const start = (Number(page) - 1) * size;
  return items.slice(start, start + size);
}

function pageLabel(page, total, perPage) {
  if (total === 0) return 'No results';
  const size = Number(perPage);
  const first = (Number(page) - 1) * size + 1;
  const last = Math.min(Number(page) * size, total);
  return 'Showing ' + first + '-' + last + ' of ' + total;
}`,
  tests: [
    { id: 'count-partial', name: '7 results at 3 per page need 3 pages', call: 'pageCount(7, 3)', expected: 3, visible: true },
    { id: 'count-exact', name: '6 results at 3 per page need 2 pages', call: 'pageCount(6, 3)', expected: 2, visible: true },
    { id: 'count-zero', name: 'no results still shows 1 page', call: 'pageCount(0, 10)', expected: 1, visible: true },
    {
      id: 'page-first',
      name: 'first page',
      call: "getPage(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 1, 3)",
      expected: ['a', 'b', 'c'],
      visible: true,
    },
    {
      id: 'page-last',
      name: 'last, partial page',
      call: "getPage(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 3, 3)",
      expected: ['g'],
      visible: true,
    },
    {
      id: 'page-strings',
      name: 'page and perPage given as URL strings',
      call: "getPage(['a', 'b', 'c', 'd', 'e', 'f', 'g'], '2', '3')",
      expected: ['d', 'e', 'f'],
      visible: true,
    },
    { id: 'label-first', name: 'label for page 1', call: 'pageLabel(1, 25, 10)', expected: 'Showing 1-10 of 25', visible: true },
    {
      id: 'label-last',
      name: 'label for the last page (string perPage)',
      call: "pageLabel(3, 25, '10')",
      expected: 'Showing 21-25 of 25',
      visible: false,
    },
    { id: 'page-empty', name: 'empty result list', call: 'getPage([], 1, 10)', expected: [], visible: false },
    { id: 'count-string', name: 'perPage given as a string', call: "pageCount(7, '5')", expected: 2, visible: false },
  ],
  bugs: [
    {
      id: 'ceil-floor',
      line: 5,
      find: 'Math.ceil',
      replace: 'Math.floor',
      category: 'off_by_one',
      conceptSkill: 'prog.boundaries',
      title: 'Rounds the page count down instead of up',
      explanation:
        '`Math.floor(7 / 3)` is 2, which drops the last partial page. Leftover results need one more page, so the division must round UP with `Math.ceil`.',
      symptom: "With 7 results at 3 per page the pager shows only 2 pages, so result 'g' is unreachable",
      repro: 'count-partial',
      actual: '2',
      subtlety: 2,
      probe: 'Log `total / Number(perPage)` for `pageCount(7, 3)` and compare it with the returned value.',
      examine: 'Should a leftover partial page make the count round up or down?',
    },
    {
      id: 'zero-total',
      line: 4,
      find: 'total <= 0',
      replace: 'total < 0',
      category: 'missing_edge_case',
      accept: ['off_by_one', 'wrong_operator'],
      conceptSkill: 'prog.boundaries',
      title: 'Zero results are not treated as an empty search',
      explanation:
        'With `total < 0`, a search with 0 results skips the guard and returns `Math.ceil(0 / 10)`, which is 0 pages. An empty search still shows one (empty) page, so the guard must include 0: `total <= 0`.',
      symptom: "Searches with no results show 'Page 1 of 0'",
      repro: 'count-zero',
      actual: '0',
      subtlety: 3,
      probe: 'Call `pageCount(0, 10)` and log which line returns.',
      examine: 'Does the guard on this line catch a total of exactly 0?',
    },
    {
      id: 'start-index',
      line: 10,
      find: '(Number(page) - 1) * size',
      replace: 'Number(page) * size',
      category: 'off_by_one',
      conceptSkill: 'prog.boundaries',
      title: 'Page start index skips the first page',
      explanation:
        'Pages are numbered from 1 but array indexes from 0, so page 1 must start at index 0: `(page - 1) * size`. Using `page * size` starts every page one page too late.',
      symptom: 'Page 1 shows results d-f; the first results never appear',
      repro: 'page-first',
      actual: "['d', 'e', 'f']",
      subtlety: 1,
      probe: 'Log `start` inside `getPage()` for page 1 and for page 2.',
      examine: 'Which index should page 1 start at, given that arrays are indexed from 0?',
    },
    {
      id: 'size-string',
      line: 9,
      find: 'const size = Number(perPage);',
      replace: 'const size = perPage;',
      category: 'type_coercion',
      conceptSkill: 'prog.state',
      title: 'perPage from the URL is used as a string',
      explanation:
        "`perPage` arrives from the URL as the string '3'. `(page - 1) * size` still works because `*` converts strings to numbers, but `start + size` concatenates: 3 + '3' is '33', so the slice runs far past the page. Convert with `Number(perPage)` first.",
      symptom: 'Page 2 shows too many results when perPage comes from the URL',
      repro: 'page-strings',
      actual: "['d', 'e', 'f', 'g']",
      subtlety: 3,
      probe: "Log `start`, `start + size` and `typeof size` inside `getPage(items, '2', '3')`.",
      examine: 'What type is `size` here when perPage comes from the URL, and what does `+` do with a string?',
    },
    {
      id: 'label-max',
      line: 18,
      find: 'Math.min',
      replace: 'Math.max',
      category: 'wrong_operator',
      accept: ['wrong_variable'],
      conceptSkill: 'prog.logic',
      title: 'Uses Math.max where the label needs Math.min',
      explanation:
        'The last item shown is the smaller of `page * size` and `total` (a page cannot go past the last result). `Math.max` picks the larger value, so page 1 claims to show everything.',
      symptom: "The label on page 1 says 'Showing 1-25 of 25' but only 10 results are listed",
      repro: 'label-first',
      actual: "'Showing 1-25 of 25'",
      subtlety: 2,
      probe: 'Log `Number(page) * size` and `total` in `pageLabel(1, 25, 10)`. Which should the label use?',
      examine: 'Should the last shown item number be the larger or the smaller of these two values?',
    },
    {
      id: 'label-zero',
      line: 17,
      find: '(Number(page) - 1) * size + 1',
      replace: '(Number(page) - 1) * size',
      category: 'off_by_one',
      conceptSkill: 'prog.boundaries',
      title: "Label's first item number is zero-based",
      explanation:
        'People count results from 1, so the first item on a page is `(page - 1) * size + 1`. Without the `+ 1` the label starts at 0.',
      symptom: "The label on page 1 starts at 0: 'Showing 0-10 of 25'",
      repro: 'label-first',
      actual: "'Showing 0-10 of 25'",
      subtlety: 2,
      probe: 'Log `first` and `last` in `pageLabel(1, 25, 10)`.',
      examine: 'Results are counted from 1 for people. What number should the first item on page 1 have?',
    },
  ],
};
