// Review state (decisions, notes, comments, viewed files) outlives one run.
// The page cannot keep it: every `zreview review` serves on a fresh port and
// browser storage is per origin. So the server owns a file per PR, keyed by
// repo and number rather than head, hands it to the page at start, and takes
// every change back through POST /api/state.

import { mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Review } from "./build.ts";

export type FeatureState = { decision?: "approved" | "changes"; note?: string; at?: number; head?: string; files?: Record<string, string | null>; viewed?: Record<string, string | null>; comments?: unknown[] };
export type ReviewState = Record<string, FeatureState>;
type Stored = { repo: string; number?: number; head?: string; savedAt: number; features: ReviewState };

const stateDir = () => process.env.ZREVIEW_STATE_DIR || join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "zreview");

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
/** The review's own `id` when it has one, else the PR number, else the title — a plan is reviewed before
 *  the branch exists and must still find its state once there is a number to key on. */
export const stateName = (r: Review) => `${r.pr.repo.replace(/[\/\\:]/g, "__")}#${r.id ? slug(r.id) : r.pr.number || slug(r.pr.title)}`;
export const statePath = (r: Review) => join(stateDir(), `${stateName(r)}.json`);
/** Where an earlier run may have left it: a plan keyed by title, before the PR had a number. */
const olderPaths = (r: Review) =>
  r.id || !r.pr.number ? [] : [join(stateDir(), `${r.pr.repo.replace(/[\/\\:]/g, "__")}#${slug(r.pr.title)}.json`)];

export async function loadState(r: Review): Promise<ReviewState | null> {
  for (const path of [statePath(r), ...olderPaths(r)]) {
    const file = Bun.file(path);
    if (!(await file.exists())) continue;
    try { return ((await file.json()) as Stored).features ?? null; } catch { return null; }
  }
  return null;
}

/** Write the whole state atomically: a temp file next to the target, then rename. */
export async function saveState(r: Review, features: ReviewState): Promise<void> {
  const path = statePath(r);
  await mkdir(stateDir(), { recursive: true });
  const stored: Stored = { repo: r.pr.repo, number: r.pr.number, head: r.pr.head, savedAt: Date.now(), features };
  const tmp = `${path}.${process.pid}.tmp`;
  await Bun.write(tmp, JSON.stringify(stored, null, 2));
  await rename(tmp, path);
}
