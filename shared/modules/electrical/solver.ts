/**
 * DC circuit solver using nodal analysis (conductance matrix).
 *
 * Every resistive element is stamped as a conductance between two nodes; batteries are
 * stamped as Norton equivalents (current source V/r in parallel with 1/r), so no extra
 * unknowns are required. Opens are modelled as 1 GOhm and every node has a tiny leak to
 * ground so floating sections still produce a well-defined (near-zero) solution.
 * Solved with Gaussian elimination + partial pivoting. Circuits here have < 20 nodes.
 */

export const OPEN_R = 1e9;
export const METER_IMPEDANCE = 1e7; // 10 MOhm digital multimeter input
const LEAK_G = 1e-12;

export interface Conductance {
  a: number; // node index, -1 = ground
  b: number;
  g: number;
}

export interface CurrentSource {
  /** Current flows out of node `a` and into node `b` (A). */
  a: number;
  b: number;
  i: number;
}

export function solveNodal(n: number, elements: Conductance[], sources: CurrentSource[]): Float64Array {
  const G: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
  const I = new Float64Array(n);

  for (const { a, b, g } of elements) {
    if (a >= 0) G[a][a] += g;
    if (b >= 0) G[b][b] += g;
    if (a >= 0 && b >= 0) {
      G[a][b] -= g;
      G[b][a] -= g;
    }
  }
  for (const { a, b, i } of sources) {
    if (b >= 0) I[b] += i;
    if (a >= 0) I[a] -= i;
  }
  for (let k = 0; k < n; k++) G[k][k] += LEAK_G;

  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(G[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(G[r][col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best === 0) continue;
    if (pivot !== col) {
      [G[pivot], G[col]] = [G[col], G[pivot]];
      [I[pivot], I[col]] = [I[col], I[pivot]];
    }
    const diag = G[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = G[r][col] / diag;
      if (f === 0) continue;
      const row = G[r];
      const src = G[col];
      for (let c = col; c < n; c++) row[c] -= f * src[c];
      I[r] -= f * I[col];
    }
  }
  const v = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let acc = I[r];
    const row = G[r];
    for (let c = r + 1; c < n; c++) acc -= row[c] * v[c];
    v[r] = row[r] === 0 ? 0 : acc / row[r];
  }
  return v;
}
