// Turn review.json into one self-contained HTML page.
//
// Screenshots are re-encoded through sips (macOS) to JPEG and downscaled only
// when wider than maxWidth. The cap is on width: phones top out near 1290 px,
// so at 1200 every phone capture keeps its native width and only tablet and
// desktop captures shrink. The re-encode is kept only when it is smaller than
// the original or the image was downscaled, because flat UI usually compresses
// better as PNG. Nothing is upscaled.

import { $ } from "bun";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { diagramError, mermaidVersion } from "./diagrams.ts";

export type Shots = { before?: string; after?: string; caption?: string; before_src?: string; after_src?: string };
export type DiffLine = { t: " " | "+" | "-"; old?: number; new?: number; text: string };
export type Hunk = { header: string; lines: DiffLine[] };
export type FileDiff = { path: string; hunks: Hunk[]; add: number; del: number; status?: string };
export type FileRef = { path: string; url: string; hunks?: Hunk[]; add?: number; del?: number; status?: string };
/** A field is what an entity consists of; an operation is what you can do with it. Both carry the reasoning, not just the type. */
export type Part = { name: string; type?: string; meaning: string; why?: string; change?: "added" | "changed" | "removed" };
export type Entity = {
  name: string; kind?: string; change: "added" | "changed" | "renamed" | "removed";
  from?: string; summary: string; why?: string; file?: string;
  fields?: Part[]; operations?: Part[];
  /** A serialized instance. An object is pretty-printed as JSON; a string is shown verbatim. Kept for old review.json files; prefer `examples`. */
  example?: unknown;
  /** Serialized instances: a default that covers most fields first, then edge cases. Shown as tabs in a read-only editor.
   *  Required — an entity nobody showed an instance of is a declaration, not a domain type. `example` satisfies it too; loadReview enforces this. */
  examples?: { title: string; note?: string; lang?: string; value: unknown }[];
};
export type Feature = {
  id: string; title: string; scenario: string; description: string;
  entities?: Entity[];
  diagrams?: { title?: string; mermaid: string }[];
  screenshots?: Shots | null;
  files?: (string | FileRef)[];
  tested?: string;
};
export type Review = {
  /** Names this review's state across runs. Set it on the plan and keep it, and the decisions made on the
   *  plan follow the PR that implements it. Without one the key is the PR number, or the title while there
   *  is no number — which breaks the moment the title is reworded. */
  id?: string;
  /** A plan review: the features are what will be shipped, and no code exists yet. Features carry no files,
   *  and `pr.number`, `pr.url` and `pr.head` may be missing because the branch is not there either. */
  plan?: boolean;
  pr: { repo: string; number?: number; url?: string; title: string; base?: string; head?: string; exposure?: string };
  features: Feature[];
};
export type BuildOptions = { maxWidth: number; quality: number; served: boolean; diffText?: string; plan?: boolean };

/** Parse a unified diff (git / `gh pr diff`) into per-file hunks with old and new line numbers. */
export function parseUnifiedDiff(text: string): Map<string, FileDiff> {
  const files = new Map<string, FileDiff>();
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0, newNo = 0;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
      file = { path: m ? m[2] : raw.slice(11), hunks: [], add: 0, del: 0 };
      files.set(file.path, file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (/^(new file|deleted file|rename to|Binary files)/.test(raw)) {
      file.status = raw.startsWith("new") ? "added" : raw.startsWith("deleted") ? "deleted" : raw.startsWith("rename") ? "renamed" : "binary";
      continue;
    }
    const at = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (at) { oldNo = +at[1]; newNo = +at[2]; hunk = { header: raw, lines: [] }; file.hunks.push(hunk); continue; }
    if (!hunk || raw.startsWith("\\")) continue;
    const t = raw[0], body = raw.slice(1);
    if (t === "+") { hunk.lines.push({ t, new: newNo++, text: body }); file.add++; }
    else if (t === "-") { hunk.lines.push({ t, old: oldNo++, text: body }); file.del++; }
    else if (t === " " || raw === "") { hunk.lines.push({ t: " ", old: oldNo++, new: newNo++, text: body }); }
  }
  return files;
}

export class ReviewError extends Error {}

async function pixelWidth(path: string): Promise<number | null> {
  const out = await $`sips -g pixelWidth ${path}`.quiet().nothrow();
  const m = /pixelWidth:\s*(\d+)/.exec(out.stdout.toString());
  return m ? Number(m[1]) : null;
}

async function reencode(path: string, maxWidth: number, quality: number): Promise<{ bytes: Uint8Array; downscaled: boolean } | null> {
  if (!(await Bun.which("sips"))) return null;
  const width = await pixelWidth(path);
  const downscaled = !!width && width > maxWidth;
  const resize = downscaled ? ["--resampleWidth", String(maxWidth)] : [];
  const out = join(tmpdir(), `zreview-${randomUUID()}.jpg`);
  const r = await $`sips ${resize} -s format jpeg -s formatOptions ${quality} ${path} --out ${out}`.quiet().nothrow();
  const file = Bun.file(out);
  if (r.exitCode !== 0 || !(await file.exists()) || file.size === 0) return null;
  return { bytes: new Uint8Array(await file.arrayBuffer()), downscaled };
}

async function dataUri(rel: string, base: string, opts: BuildOptions, log: string[]): Promise<string> {
  const path = isAbsolute(rel) ? rel : resolve(base, rel);
  const original = Bun.file(path);
  if (!(await original.exists())) throw new ReviewError(`screenshot not found: ${path}`);
  const raw = new Uint8Array(await original.arrayBuffer());
  const encoded = opts.maxWidth > 0 ? await reencode(path, opts.maxWidth, opts.quality) : null;
  const use = encoded && (encoded.downscaled || encoded.bytes.length < raw.length)
    ? { bytes: encoded.bytes, mime: "image/jpeg" }
    : { bytes: raw, mime: original.type || "image/png" };
  log.push(`${rel}: ${Math.round(raw.length / 1024)} KB -> ${Math.round(use.bytes.length / 1024)} KB (${use.mime.slice(6)})`);
  return `data:${use.mime};base64,${Buffer.from(use.bytes).toString("base64")}`;
}

const fileLink = (pr: Review["pr"], path: string) =>
  ({ path, url: `${pr.url}/files#diff-${createHash("sha256").update(path).digest("hex")}` });

export async function loadReview(path: string, forcePlan = false): Promise<Review> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new ReviewError(`not found: ${path}`);
  let review: Review;
  try { review = await file.json(); } catch (e) { throw new ReviewError(`${path}: not valid JSON (${(e as Error).message})`); }
  if (forcePlan) review.plan = true;               // `zreview plan` / `zplan`, whatever the file says
  // A plan has no branch to name, so it needs only somewhere to put it and something to call it.
  const required = review.plan ? (["repo", "title"] as const) : (["repo", "number", "url", "title", "base", "head"] as const);
  for (const key of required) {
    if (!(key in (review.pr ?? {}))) throw new ReviewError(`${path}: pr.${key} is required${review.plan ? " even in a plan" : ""}`);
  }
  const problems: string[] = [];
  for (const f of review.features ?? []) {
    for (const key of ["id", "title", "scenario", "description"] as const) {
      if (!(key in f)) throw new ReviewError(`${path}: feature ${f.id ?? "?"} lacks ${key}`);
    }
    if (review.plan && (f.files ?? []).length) {
      problems.push(`feature ${f.id}: a plan lists no files — use \`zreview review\` (and drop "plan": true) now that the code exists`);
    }
    for (const e of f.entities ?? []) {
      const where = `feature ${f.id} entity ${e.name ?? "?"}`;
      // An entity with no instance is a declaration, not a domain type: the reviewer cannot picture what it holds.
      if (!e.examples?.length && e.example === undefined) {
        problems.push(`${where}: needs examples — a default filling most fields, then the edge cases worth looking at`);
        continue;
      }
      (e.examples ?? []).forEach((x, i) => {
        if (!x || typeof x !== "object") problems.push(`${where} example ${i + 1}: must be an object with a title and a value`);
        else if (!x.title) problems.push(`${where} example ${i + 1}: needs a title naming the case it shows`);
        else if (!("value" in x)) problems.push(`${where} example ${x.title}: needs a value, the serialized instance`);
      });
    }
    for (const [i, d] of (f.diagrams ?? []).entries()) {
      const where = `feature ${f.id} diagram ${d?.title || i + 1}`;
      if (typeof d?.mermaid !== "string" || !d.mermaid.trim()) {
        problems.push(`${where}: needs mermaid, the diagram source`);
        continue;
      }
      const error = await diagramError(d.mermaid).catch((e: Error) => {
        throw new ReviewError(`${path}: cannot check the diagrams — ${e.message}`);
      });
      if (error) problems.push(`${where}: Mermaid ${mermaidVersion} cannot parse it — ${error.replaceAll("\n", "\n    ")}`);
    }
  }
  if (problems.length) throw new ReviewError(`${path}: ${problems.length} problem${problems.length === 1 ? "" : "s"} in the features:\n  ${problems.join("\n  ")}`);
  return review;
}
export async function buildHtml(reviewPath: string, opts: BuildOptions): Promise<{ html: string; review: Review; log: string[] }> {
  const review = await loadReview(reviewPath, opts.plan);
  const base = dirname(resolve(reviewPath));
  const log: string[] = [];
  const diffs = opts.diffText ? parseUnifiedDiff(opts.diffText) : null;
  const claimed = new Set<string>();
  for (const f of review.features ?? []) {
    f.files = (f.files ?? []).map((p) => (typeof p === "string" ? fileLink(review.pr, p) : p));
    for (const ref of f.files as FileRef[]) {
      claimed.add(ref.path);
      const d = diffs?.get(ref.path);
      if (d) Object.assign(ref, { hunks: d.hunks, add: d.add, del: d.del, status: d.status });
    }
    const shots = f.screenshots;
    if (shots?.before) shots.before_src = await dataUri(shots.before, base, opts, log);
    if (shots?.after) shots.after_src = await dataUri(shots.after, base, opts, log);
  }
  if (diffs) {
    const unclaimed = [...diffs.keys()].filter((p) => !claimed.has(p)).sort();
    const missing = [...claimed].filter((p) => !diffs.has(p)).sort();
    const problems = [
      ...unclaimed.map((p) => `${p}: changed in the PR but no feature lists it`),
      ...missing.map((p) => `${p}: listed by a feature but not changed in the PR`),
    ];
    if (problems.length) throw new ReviewError(`${reviewPath}: ${problems.length} file${problems.length === 1 ? "" : "s"} out of step with the PR:\n  ${problems.join("\n  ")}`);
  }
  const payload = JSON.stringify(review).replaceAll("</", "<\\/").replaceAll("__", "_\\u005f");
  const page = join(import.meta.dir, "page");
  const [index, style, app] = await Promise.all(
    ["index.html", "style.css", "app.js"].map((name) => Bun.file(join(page, name)).text()),
  );
  const html = index
    .replace("__TITLE__", `Review: ${review.pr.repo}#${review.pr.number}`)
    .replace("__MERMAID__", mermaidVersion)
    .replace("__STYLE__", () => style)
    .replace("__SERVED__", String(opts.served))
    // A served page keeps the token: serve() fills in the state it holds on every request, so a reload
    // shows what the reviewer has done rather than what existed when the process started.
    .replace("__STATE__", () => (opts.served ? "__STATE__" : "null"))
    .replace("__REVIEW_JSON__", () => payload)
    .replace("__APP__", () => app);
  return { html, review, log };
}
