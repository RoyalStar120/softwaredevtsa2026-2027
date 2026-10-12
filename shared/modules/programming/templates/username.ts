import type { TemplateSpec } from '../types.ts';

export const username: TemplateSpec = {
  id: 'prog.username',
  title: 'Username Validator',
  summary: 'The sign-up form accepts or rejects the wrong usernames. Pin down which rule misbehaves and why.',
  difficultyRange: [1, 3],
  processWeights: { 'prog.reproduce': 0.7, 'prog.trace': 0.6, 'prog.localize': 0.5, 'prog.verify': 0.5 },
  prerequisites: [],
  estimatedMinutes: 8,
  tags: ['javascript', 'strings', 'conditions', 'validation'],
  fileName: 'signup.js',
  context: 'The sign-up form uses these functions to validate new usernames.',
  reporters: ['Support ticket from a new user', 'QA tester Priya', 'Product manager Dana'],
  code: `// Sign-up rule: usernames are 3-16 characters, use only letters, digits or
// underscores, and must start with a letter. '' means the name is valid.
function isLetter(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

function usernameError(name) {
  if (name.length < 3) return 'too short';
  if (name.length > 16) return 'too long';
  if (!isLetter(name[0])) return 'must start with a letter';
  for (const ch of name) {
    if (!isLetter(ch) && !isDigit(ch) && ch !== '_') {
      return 'invalid character: ' + ch;
    }
  }
  return '';
}

function isValidUsername(name) {
  return usernameError(name) === '';
}`,
  tests: [
    { id: 'valid-simple', name: 'plain name is valid', call: "isValidUsername('alice')", expected: true, visible: true },
    { id: 'valid-mixed', name: 'letters, digits and underscore', call: "isValidUsername('player_1')", expected: true, visible: true },
    { id: 'too-short', name: 'two characters is too short', call: "usernameError('al')", expected: 'too short', visible: true },
    { id: 'min-length', name: 'exactly 3 characters is allowed', call: "isValidUsername('bob')", expected: true, visible: true },
    {
      id: 'max-length',
      name: 'exactly 16 characters is allowed',
      call: "isValidUsername('abcdefghijklmnop')",
      expected: true,
      visible: true,
    },
    {
      id: 'starts-digit',
      name: 'cannot start with a digit',
      call: "usernameError('9lives')",
      expected: 'must start with a letter',
      visible: true,
    },
    { id: 'symbol', name: 'symbols are rejected', call: "usernameError('bob!')", expected: 'invalid character: !', visible: true },
    {
      id: 'too-long',
      name: '17 characters is too long',
      call: "usernameError('abcdefghijklmnopq')",
      expected: 'too long',
      visible: false,
    },
    { id: 'upper', name: 'uppercase letters and digits', call: "isValidUsername('Zed_2024')", expected: true, visible: false },
    {
      id: 'starts-underscore',
      name: 'cannot start with an underscore',
      call: "usernameError('_hidden')",
      expected: 'must start with a letter',
      visible: false,
    },
    {
      id: 'max-length-other',
      name: 'another 16-character name',
      call: "isValidUsername('Player_Number_16')",
      expected: true,
      visible: false,
    },
  ],
  bugs: [
    {
      id: 'letter-or',
      line: 4,
      find: "ch >= 'a' && ch <= 'z'",
      replace: "ch >= 'a' || ch <= 'z'",
      category: 'wrong_operator',
      conceptSkill: 'prog.logic',
      title: '`||` instead of `&&` makes every character a letter',
      explanation:
        "`ch >= 'a' || ch <= 'z'` is true for every character (anything is either after 'a' or before 'z'), so `isLetter` accepts digits and symbols. A range check needs both ends to hold: `ch >= 'a' && ch <= 'z'`.",
      symptom: "Usernames like '9lives' and 'bob!' are accepted",
      repro: 'starts-digit',
      actual: "''",
      subtlety: 2,
      probe: "Call `isLetter('9')` and `isLetter('!')` in the console. Which result surprises you?",
      examine: 'Read the lowercase range check aloud: must BOTH comparisons hold, or is one enough?',
    },
    {
      id: 'min-len',
      line: 12,
      find: 'name.length < 3',
      replace: 'name.length <= 3',
      category: 'off_by_one',
      accept: ['wrong_operator'],
      conceptSkill: 'prog.boundaries',
      title: 'Minimum length check rejects exactly 3 characters',
      explanation:
        '`name.length <= 3` treats a 3-character name as too short, but 3 is allowed. To reject only names shorter than 3, use `< 3`.',
      symptom: "Three-letter usernames like 'bob' are rejected as too short",
      repro: 'min-length',
      actual: 'false',
      subtlety: 2,
      probe: "Try `usernameError('bob')` and `usernameError('bobb')` in the console. Which rule rejects 'bob'?",
      examine: 'Is a name of exactly 3 characters supposed to pass this check?',
    },
    {
      id: 'max-len',
      line: 13,
      find: 'name.length > 16',
      replace: 'name.length >= 16',
      category: 'off_by_one',
      accept: ['wrong_operator'],
      conceptSkill: 'prog.boundaries',
      title: 'Maximum length check rejects exactly 16 characters',
      explanation:
        '`name.length >= 16` rejects a 16-character name, but up to 16 is allowed. Only names longer than 16 should fail: `> 16`.',
      symptom: '16-character usernames are rejected as too long',
      repro: 'max-length',
      actual: 'false',
      subtlety: 3,
      probe: "Call `usernameError('abcdefghijklmnop')` (16 letters) and log `name.length` inside `usernameError`.",
      examine: 'Should a name of exactly 16 characters be rejected by this comparison?',
    },
    {
      id: 'first-index',
      line: 14,
      find: 'name[0]',
      replace: 'name[1]',
      category: 'off_by_one',
      accept: ['wrong_variable'],
      conceptSkill: 'prog.boundaries',
      title: 'Checks the second character instead of the first',
      explanation:
        "Strings are zero-indexed: `name[1]` is the SECOND character. The 'must start with a letter' rule has to look at `name[0]`.",
      symptom: "'9lives' is accepted even though usernames must start with a letter",
      repro: 'starts-digit',
      actual: "''",
      subtlety: 3,
      probe: "Log `name[0]` and `name[1]` inside `usernameError('9lives')`.",
      examine: 'Which character does this line actually test? Remember that strings are indexed from 0.',
    },
    {
      id: 'loop-or',
      line: 16,
      find: '!isLetter(ch) && !isDigit(ch)',
      replace: '!isLetter(ch) || !isDigit(ch)',
      category: 'wrong_operator',
      conceptSkill: 'prog.logic',
      title: '`||` instead of `&&` rejects every character',
      explanation:
        "A character is invalid only if it is NOT a letter AND NOT a digit AND not '_'. With `||`, a letter (which is not a digit) already counts as invalid, so every name is rejected.",
      symptom: "Every username is rejected, even 'alice'",
      repro: 'valid-simple',
      actual: 'false',
      subtlety: 1,
      probe: "Log `ch`, `isLetter(ch)` and `isDigit(ch)` inside the loop for `usernameError('alice')`.",
      examine: "Evaluate this condition by hand for the character 'a'. Should it be true?",
    },
    {
      id: 'digit-inverted',
      line: 8,
      find: "ch >= '0' && ch <= '9'",
      replace: "ch < '0' || ch > '9'",
      category: 'wrong_operator',
      conceptSkill: 'prog.logic',
      title: 'isDigit is inverted',
      explanation:
        "`ch < '0' || ch > '9'` is true for everything that is NOT a digit, so `isDigit` answers the opposite question: digits are rejected and symbols slip through. It should be `ch >= '0' && ch <= '9'`.",
      symptom: "Usernames containing digits, like 'player_1', are rejected",
      repro: 'valid-mixed',
      actual: 'false',
      subtlety: 2,
      probe: "Call `isDigit('1')` and `isDigit('!')` in the console.",
      examine: "What does this expression return for '5'? And for '?'?",
    },
  ],
};
