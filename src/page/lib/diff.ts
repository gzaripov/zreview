// Alignments the page shows: a sequence of lines, words or blocks against its earlier version.

export type OpKind = "same" | "del" | "ins";
/** One step of an alignment: its kind, the index in `a` (-1 for an insertion), the index in `b` (-1 for a deletion). */
export type Op = [OpKind, number, number];

/** Longest-common-subsequence alignment. Quadratic, so callers bound the input. */
export function lcsOps<T>(a: readonly T[], b: readonly T[]): Op[] {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: Op[] = []; let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) ops.push(["same", i++, j++]);
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(["del", i++, -1]);
    else ops.push(["ins", -1, j++]);
  }
  while (i < m) ops.push(["del", i++, -1]);
  while (j < n) ops.push(["ins", -1, j++]);
  return ops;
}

export type WordPart = { kind: OpKind; text: string };

/** Word-level diff for the prose blocks, so "what changed" shows what changed. Whitespace runs are tokens too,
 *  so either side reassembles exactly. Null past 2400 tokens: too long to diff cheaply, show the text plain. */
export function wordDiff(before: string, after: string): WordPart[] | null {
  const tok = (s: string) => s.split(/(\s+)/).filter((x) => x !== "");
  const a = tok(before), b = tok(after);
  if (a.length + b.length > 2400) return null;
  const out: WordPart[] = [];
  const push = (kind: OpKind, text: string) => { const last = out[out.length - 1]; last && last.kind === kind ? last.text += text : out.push({ kind, text }); };
  for (const [kind, i, j] of lcsOps(a, b)) push(kind, kind === "del" ? a[i] : b[j]);
  return out;
}

/** Blocks of a document against its earlier version. The common head and tail are matched first, so a long
 *  document costs only its changed middle; null when even that is too large to align. */
export function blockOps(a: readonly string[], b: readonly string[]): Op[] | null {
  let s = 0, e = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const midA = a.slice(s, a.length - e), midB = b.slice(s, b.length - e);
  if (midA.length * midB.length > 4e6) return null;
  const ops: Op[] = [];
  for (let k = 0; k < s; k++) ops.push(["same", k, k]);
  for (const [kind, i, j] of lcsOps(midA, midB)) ops.push([kind, i < 0 ? -1 : i + s, j < 0 ? -1 : j + s]);
  for (let k = 0; k < e; k++) ops.push(["same", a.length - e + k, b.length - e + k]);
  return ops;
}
