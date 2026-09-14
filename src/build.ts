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

export type Shots = { before?: string; after?: string; caption?: string; before_src?: string; after_src?: string };
export type Feature = {
  id: string; title: string; scenario: string; description: string;
  diagrams?: { title?: string; mermaid: string }[];
  screenshots?: Shots | null;
  files?: (string | { path: string; url: string })[];
  tested?: string;
};
export type Review = {
  pr: { repo: string; number: number; url: string; title: string; base: string; head: string; exposure?: string };
  features: Feature[];
};
export type BuildOptions = { maxWidth: number; quality: number; served: boolean };

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

export async function loadReview(path: string): Promise<Review> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new ReviewError(`not found: ${path}`);
  let review: Review;
  try { review = await file.json(); } catch (e) { throw new ReviewError(`${path}: not valid JSON (${(e as Error).message})`); }
  for (const key of ["repo", "number", "url", "title", "base", "head"] as const) {
    if (!(key in (review.pr ?? {}))) throw new ReviewError(`${path}: pr.${key} is required`);
  }
  for (const f of review.features ?? []) {
    for (const key of ["id", "title", "scenario", "description"] as const) {
      if (!(key in f)) throw new ReviewError(`${path}: feature ${f.id ?? "?"} lacks ${key}`);
    }
  }
  return review;
}

export async function buildHtml(reviewPath: string, opts: BuildOptions): Promise<{ html: string; review: Review; log: string[] }> {
  const review = await loadReview(reviewPath);
  const base = dirname(resolve(reviewPath));
  const log: string[] = [];
  for (const f of review.features ?? []) {
    f.files = (f.files ?? []).map((p) => (typeof p === "string" ? fileLink(review.pr, p) : p));
    const shots = f.screenshots;
    if (shots?.before) shots.before_src = await dataUri(shots.before, base, opts, log);
    if (shots?.after) shots.after_src = await dataUri(shots.after, base, opts, log);
  }
  const payload = JSON.stringify(review).replaceAll("</", "<\\/");
  const template = await Bun.file(join(import.meta.dir, "template.html")).text();
  const html = template
    .replace("__TITLE__", `Review: ${review.pr.repo}#${review.pr.number}`)
    .replace("__SERVED__", String(opts.served))
    .replace("__REVIEW_JSON__", () => payload);
  return { html, review, log };
}
