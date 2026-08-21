export interface FuzzyMatch {
  score: number;
  /** Indices into `text` (not `query`) that matched, in order. */
  indices: number[];
}

/** Subsequence fuzzy match: every character of `query`, in order, must
 * appear somewhere in `text` (not necessarily contiguous) — so "прг" matches
 * "Программирование". Consecutive runs and word-start matches score higher,
 * so tighter/more meaningful matches sort first when scores are compared. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  if (!query) return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices: number[] = [];
  let qi = 0;
  let score = 0;
  let prevIndex = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    indices.push(ti);
    if (prevIndex === ti - 1) score += 5;
    if (ti === 0 || /[\s\-_/.]/.test(t[ti - 1])) score += 8;
    score += 1;
    prevIndex = ti;
    qi++;
  }

  if (qi < q.length) return null;
  score -= indices[0] * 0.1;
  score -= (t.length - q.length) * 0.01;
  return { score, indices };
}
