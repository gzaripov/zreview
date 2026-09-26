// The block model behind the rendered view of a changed Markdown file: both versions cut into blocks (a list
// item is a block), aligned, and each removed block paired with the added one it most resembles.
import { marked, type Token, type Tokens } from "marked";
import { blockOps, type Op } from "./diff.ts";
import type { FileRef } from "./types.ts";

export const MARKDOWN = /\.(md|markdown|mdx)$/i;

export type Unit = {
  type: string; raw: string; key: string;
  /** The commit and directory the block's relative links resolve against. */
  ref: string; dir: string;
  from: number; to: number;
  token?: Token; list?: Tokens.List; item?: Tokens.ListItem;
  /** Filled in by the page the first time the block is rendered. */
  html?: string; text?: string;
};
export type Row = { kind: "same" | "del" | "add" | "mod"; old?: Unit; new?: Unit; html?: string };

export function mdUnits(source: string, ref: string, dir: string): Unit[] {
  const text = source.replace(/\r\n?/g, "\n").replace(/^( *)(\t+)/gm, (_, s: string, t: string) => s + "    ".repeat(t.length));
  const units: Unit[] = [];
  let cursor = 0, pos = 0, line = 1;
  const lineAt = (at: number) => { for (; pos < at; pos++) if (text.charCodeAt(pos) === 10) line++; return line; };
  const span = (raw: string) => {
    const at = Math.max(text.indexOf(raw, cursor), cursor);
    cursor = at + raw.length;
    return { from: lineAt(at), to: lineAt(at + Math.max(raw.trimEnd().length - 1, 0)) };
  };
  const unit = (type: string, raw: string, key: string, extra?: Partial<Unit>) => units.push({ type, raw, key, ref, dir, ...extra, ...span(raw) });
  const front = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(text);
  if (front) unit("front", front[0], "front\n" + front[0].trim());
  for (const t of marked.lexer(text.slice(cursor))) {
    if (t.type === "space") { span(t.raw); continue; }
    if (t.type !== "list") { unit(t.type, t.raw, `${t.type}${(t as Tokens.Heading).depth ?? ""}\n${t.raw.trim()}`, { token: t }); continue; }
    const list = t as Tokens.List;
    const at = Math.max(text.indexOf(list.raw, cursor), cursor);
    cursor = at;
    for (const item of list.items) unit("item", item.raw, `item${list.ordered ? 1 : ""}\n${item.raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim()}`, { list, item });
    cursor = Math.max(cursor, at + list.raw.length);
  }
  // marked keeps some source out of every token: a link reference definition (`[docs]: https://…`) sets
  // the target of every `[docs]` without a block of its own. A change there would not show in the rendered
  // view at all, so each run of non-blank lines that no block covers becomes a block of its own.
  const lines = text.split("\n"), covered = new Uint8Array(lines.length + 2), loose: Unit[] = [];
  for (const u of units) for (let n = u.from; n <= u.to; n++) covered[n] = 1;
  for (let n = 1; n <= lines.length; n++) {
    if (covered[n] || !lines[n - 1].trim()) continue;
    let m = n;
    while (m < lines.length && !covered[m + 1] && lines[m].trim()) m++;
    const raw = lines.slice(n - 1, m).join("\n");
    loose.push({ type: "raw", raw, key: `raw\n${raw.trim()}`, ref, dir, from: n, to: m });
    n = m;
  }
  return loose.length ? [...units, ...loose].sort((x, y) => x.from - y.from) : units;
}

export const byLine = (u: Unit) => u.type === "front" || u.type === "raw" || u.type === "code";
export const linesOf = (u: Unit) => (u.type === "code" ? (u.token as Tokens.Code).text : u.raw.trim()).split("\n");

// How much two blocks share: the pieces both contain, weighted by length, over the larger block. Pairing
// asks this of every removed and added block in a changed stretch, so it counts instead of aligning:
// linear in the blocks' size, where a word-level LCS per pair could freeze the tab on a long rewrite.
function overlap(a: string[], b: string[]) {
  const left = new Map<string, number>(); let sizeA = 0, sizeB = 0, same = 0;
  for (const t of a) { left.set(t, (left.get(t) || 0) + 1); sizeA += t.length; }
  for (const t of b) { sizeB += t.length; const k = left.get(t); if (k) { left.set(t, k - 1); same += t.length; } }
  return same / Math.max(sizeA, sizeB, 1);
}

export function likeness(o: Unit, n: Unit, unitText: (u: Unit) => string): number {
  const depth = (u: Unit) => (u.token as Tokens.Heading | undefined)?.depth;
  if (o.type !== n.type || depth(o) !== depth(n) || (o.type === "item" && o.list!.ordered !== n.list!.ordered)) return 0;
  if (o.type === "table") {
    const a = o.token as Tokens.Table, b = n.token as Tokens.Table;
    if (a.header.length !== b.header.length || a.rows.length !== b.rows.length) return 0;
  }
  if (byLine(o)) {
    const a = linesOf(o), b = linesOf(n);
    return a.join("\n") === b.join("\n") ? 0 : overlap(a, b);
  }
  // Adjacent word pairs, not words: two unrelated paragraphs share most of their small words, but few
  // of their word pairs, so a rewrite still reads as removed then added.
  const a = unitText(o), b = unitText(n);
  const pairs = (t: string) => { const w = t.split(/\s+/).filter(Boolean); return w.length < 2 ? w : w.slice(1).map((x, i) => `${w[i]} ${x}`); };
  return a === b ? 0 : overlap(pairs(a), pairs(b));
}

export function pairUp(ops: Op[], a: Unit[], b: Unit[], unitText: (u: Unit) => string): Row[] {
  const out: Row[] = [];
  for (let k = 0; k < ops.length;) {
    if (ops[k][0] === "same") { out.push({ kind: "same", old: a[ops[k][1]], new: b[ops[k][2]] }); k++; continue; }
    const gone: Unit[] = [], come: Unit[] = [];
    for (; k < ops.length && ops[k][0] !== "same"; k++) ops[k][0] === "del" ? gone.push(a[ops[k][1]]) : come.push(b[ops[k][2]]);
    let next = 0;
    for (const o of gone) {
      let best = -1, score = 0.5;
      if (gone.length * come.length <= 400) for (let y = next; y < come.length; y++) { const s = likeness(o, come[y], unitText); if (s > score) { best = y; score = s; } }
      if (best < 0) { out.push({ kind: "del", old: o }); continue; }
      for (; next < best; next++) out.push({ kind: "add", new: come[next] });
      out.push({ kind: "mod", old: o, new: come[next++] });
    }
    for (; next < come.length; next++) out.push({ kind: "add", new: come[next] });
  }
  return out;
}

/** The rows of a changed Markdown file's rendered view, or null when the two versions are too large to align. */
export function markdownRows(file: FileRef, base: string, head: string, unitText: (u: Unit) => string): Row[] | null {
  const dir = file.path.slice(0, file.path.lastIndexOf("/") + 1);
  const a = mdUnits(file.text!.before, base, dir), b = mdUnits(file.text!.after, head, dir);
  const ops = blockOps(a.map((u) => u.key), b.map((u) => u.key));
  return ops ? pairUp(ops, a, b, unitText) : null;
}
