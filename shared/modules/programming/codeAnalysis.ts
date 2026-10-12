/**
 * Line-level code analysis for the debugging module. Contains no scenario data,
 * so it is safe to import from the client (e.g. for the debrief diff view).
 *
 * - normalizes lines so whitespace, comments, trailing semicolons and debug
 *   statements (console.*, debugger) do not count as code changes
 * - LCS line diffs, hunks relative to the original code, line mapping
 * - function ranges and call detection (for experiments / hints)
 */

export interface ScannedLine {
  /** Normalized code text ('' for blank / comment-only / debug-only lines). */
  text: string;
  /** Number of debug statements (console.* calls, debugger) on the line. */
  debug: number;
}

const CONSOLE_CALL = /^console\s*\.\s*[A-Za-z_$][\w$]*\s*\(/;

function skipString(s: string, i: number): number {
  const q = s[i];
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === q) return j + 1;
    j++;
  }
  return s.length;
}

function matchParen(s: string, open: number): number {
  let depth = 0;
  let j = open;
  while (j < s.length) {
    const c = s[j];
    if (c === '"' || c === "'" || c === '`') {
      j = skipString(s, j);
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return -1;
}

const isWordBoundaryBefore = (s: string, i: number) => i === 0 || !/[\w$.]/.test(s[i - 1]);

/** Scans every line of `code` (block comments may span lines). */
export function scanCode(code: string): ScannedLine[] {
  const lines = code.split('\n');
  const out: ScannedLine[] = [];
  let inBlock = false;
  for (const line of lines) {
    let text = '';
    let debug = 0;
    let i = 0;
    const n = line.length;
    while (i < n) {
      if (inBlock) {
        const close = line.indexOf('*/', i);
        if (close < 0) {
          i = n;
          break;
        }
        inBlock = false;
        i = close + 2;
        text += ' ';
        continue;
      }
      const ch = line[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        const end = skipString(line, i);
        text += line.slice(i, end);
        i = end;
        continue;
      }
      if (ch === '/' && line[i + 1] === '/') break;
      if (ch === '/' && line[i + 1] === '*') {
        inBlock = true;
        i += 2;
        continue;
      }
      if (ch === 'c' && isWordBoundaryBefore(line, i)) {
        const m = CONSOLE_CALL.exec(line.slice(i));
        if (m) {
          const close = matchParen(line, i + m[0].length - 1);
          let j = close < 0 ? n : close + 1;
          let k = j;
          while (k < n && (line[k] === ' ' || line[k] === '\t')) k++;
          if (line[k] === ';') j = k + 1;
          debug++;
          i = j;
          text += ' ';
          continue;
        }
      }
      if (ch === 'd' && isWordBoundaryBefore(line, i) && line.startsWith('debugger', i) && !/[\w$]/.test(line[i + 8] ?? '')) {
        let j = i + 8;
        while (j < n && (line[j] === ' ' || line[j] === '\t')) j++;
        if (line[j] === ';') j++;
        debug++;
        i = j;
        text += ' ';
        continue;
      }
      text += ch;
      i++;
    }
    let t = text.replace(/\s+/g, ' ').trim();
    while (t.endsWith(';')) t = t.slice(0, -1).trimEnd();
    out.push({ text: t, debug });
  }
  return out;
}

export interface SigLine {
  /** 1-based line number. */
  n: number;
  t: string;
}

/** Lines that contain real code, with their normalized text. */
export function significantLines(code: string): SigLine[] {
  return scanCode(code)
    .map((s, i) => ({ n: i + 1, t: s.text }))
    .filter((s) => s.t !== '');
}

/** Normalized code: identical for versions that differ only in whitespace, comments or debug logging. */
export function normalizedCode(code: string): string {
  return significantLines(code)
    .map((s) => s.t)
    .join('\n');
}

/** 1-based line numbers that contain debug statements, and the total count. */
export function debugInfo(code: string): { count: number; lines: number[] } {
  const scanned = scanCode(code);
  const lines: number[] = [];
  let count = 0;
  scanned.forEach((s, i) => {
    if (s.debug > 0) {
      lines.push(i + 1);
      count += s.debug;
    }
  });
  return { count, lines };
}

export interface DiffOp {
  k: 'eq' | 'del' | 'ins';
  /** 0-based index into `a` (eq/del), -1 otherwise. */
  a: number;
  /** 0-based index into `b` (eq/ins), -1 otherwise. */
  b: number;
}

/** LCS-based sequence diff with common prefix/suffix trimming. */
export function diffSeq(a: readonly string[], b: readonly string[]): DiffOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: DiffOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ k: 'eq', a: i, b: i });
  const n = endA - start;
  const m = endB - start;
  if (n * m > 400_000) {
    for (let i = start; i < endA; i++) ops.push({ k: 'del', a: i, b: -1 });
    for (let j = start; j < endB; j++) ops.push({ k: 'ins', a: -1, b: j });
  } else if (n > 0 || m > 0) {
    const dp: Int32Array[] = [];
    for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[start + i] === b[start + j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        ops.push({ k: 'eq', a: start + i, b: start + j });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ k: 'del', a: start + i, b: -1 });
        i++;
      } else {
        ops.push({ k: 'ins', a: -1, b: start + j });
        j++;
      }
    }
    for (; i < n; i++) ops.push({ k: 'del', a: start + i, b: -1 });
    for (; j < m; j++) ops.push({ k: 'ins', a: -1, b: start + j });
  }
  for (let i = endA, j = endB; i < a.length; i++, j++) ops.push({ k: 'eq', a: i, b: j });
  return ops;
}

/** A contiguous change of significant lines relative to the original code. */
export interface Hunk {
  /** Original (1-based) line numbers removed or replaced. */
  del: number[];
  /** New-code (1-based) line numbers inserted. */
  ins: number[];
  insText: string[];
  /** Original line number of the unchanged significant line before / after the hunk. */
  prev: number;
  next: number;
}

export function codeHunks(original: string, code: string): Hunk[] {
  const A = significantLines(original);
  const B = significantLines(code);
  const ops = diffSeq(
    A.map((x) => x.t),
    B.map((x) => x.t),
  );
  const origCount = original.split('\n').length;
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let lastEq = 0;
  for (const op of ops) {
    if (op.k === 'eq') {
      if (cur) {
        cur.next = A[op.a].n;
        hunks.push(cur);
        cur = null;
      }
      lastEq = A[op.a].n;
      continue;
    }
    if (!cur) cur = { del: [], ins: [], insText: [], prev: lastEq, next: origCount + 1 };
    if (op.k === 'del') cur.del.push(A[op.a].n);
    else {
      cur.ins.push(B[op.b].n);
      cur.insText.push(B[op.b].t);
    }
  }
  if (cur) hunks.push(cur);
  return hunks;
}

export const hunkKey = (h: Hunk): string => `${h.del.join(',')}|${h.prev}|${h.next}|${h.insText.join('\u0001')}`;

export const hunkSize = (h: Hunk): number => Math.max(h.del.length, h.ins.length);

/** Distance (in original lines) between a hunk and an original line number. */
export function hunkDistance(h: Hunk, line: number): number {
  if (h.del.length) return Math.min(...h.del.map((d) => Math.abs(d - line)));
  return Math.min(Math.abs(line - h.prev), Math.abs(h.next - line));
}

/** Total changed lines between original and code (sum of hunk sizes). */
export function linesChanged(original: string, code: string): number {
  return codeHunks(original, code).reduce((s, h) => s + hunkSize(h), 0);
}

/**
 * Maps 1-based line numbers of `oldCode` to `newCode` (raw lines, trimmed compare).
 * Lines inside a replaced block map positionally, like an editor keeps markers on edited lines.
 */
export function lineMapper(oldCode: string, newCode: string): (line: number) => number | null {
  const a = oldCode.split('\n').map((s) => s.trim());
  const b = newCode.split('\n').map((s) => s.trim());
  const map = new Map<number, number>();
  let dels: number[] = [];
  let inss: number[] = [];
  const flush = () => {
    dels.forEach((d, i) => {
      if (i < inss.length) map.set(d, inss[i]);
    });
    dels = [];
    inss = [];
  };
  for (const op of diffSeq(a, b)) {
    if (op.k === 'eq') {
      flush();
      map.set(op.a + 1, op.b + 1);
    } else if (op.k === 'del') dels.push(op.a + 1);
    else inss.push(op.b + 1);
  }
  flush();
  return (line) => map.get(line) ?? null;
}

/** Raw line changes from oldCode to newCode: inserted/edited lines (new numbering) and net deleted count. */
export function changedLineNumbers(oldCode: string, newCode: string): { changed: number[]; deleted: number } {
  const a = oldCode.split('\n').map((s) => s.trimEnd());
  const b = newCode.split('\n').map((s) => s.trimEnd());
  const changed: number[] = [];
  let deleted = 0;
  let dels = 0;
  let ins = 0;
  const flush = () => {
    deleted += Math.max(0, dels - ins);
    dels = 0;
    ins = 0;
  };
  for (const op of diffSeq(a, b)) {
    if (op.k === 'eq') flush();
    else if (op.k === 'del') dels++;
    else {
      ins++;
      changed.push(op.b + 1);
    }
  }
  flush();
  return { changed, deleted };
}

export interface FunctionRange {
  name: string;
  params: string[];
  /** 1-based inclusive line range. */
  start: number;
  end: number;
}

/** Top-level `function name(...) {` ... `}` blocks (the format used by all templates). */
export function functionRanges(code: string): FunctionRange[] {
  const lines = code.split('\n');
  const out: FunctionRange[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(lines[i]);
    if (!m) continue;
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trimEnd() === '}') {
        end = j;
        break;
      }
      end = j;
    }
    const params = m[2]
      .split(',')
      .map((p) => p.trim().replace(/=.*$/, '').trim())
      .filter(Boolean);
    out.push({ name: m[1], params, start: i + 1, end: end + 1 });
    i = end;
  }
  return out;
}

export function functionAt(ranges: readonly FunctionRange[], line: number): FunctionRange | null {
  return ranges.find((r) => line >= r.start && line <= r.end) ?? null;
}

/** Names from `names` that are called (`name(`) in an expression or code snippet. */
export function calledFunctions(source: string, names: readonly string[]): string[] {
  return names.filter((n) => new RegExp(`(^|[^\\w$.])${n.replace(/\$/g, '\\$')}\\s*\\(`).test(source));
}
