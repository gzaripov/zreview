// Review state (decisions, notes, comments, viewed files) outlives one run.
// The page cannot keep it: every `zreview review` serves on a fresh port and
// browser storage is per origin. So the server owns a file per PR, keyed by
// repo and number rather than head, hands it to the page at start, and takes
// every change back through POST /api/state.

import { mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Review } from "./build.ts";

export type FeatureState = { decision?: "approved" | "changes"; note?: string; at?: number; head?: string; comments?: unknown[]; viewed?: string[] };
export type ReviewState = Record<string, FeatureState>;
type Stored = { repo: string; number: number; head: string; savedAt: number; features: ReviewState };

const stateDir = () => process.env.ZREVIEW_STATE_DIR || join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "zreview");

export const statePath = (pr: Review["pr"]) => join(stateDir(), `${pr.repo.replace(/[\/\\:]/g, "__")}#${pr.number}.json`);

export async function loadState(pr: Review["pr"]): Promise<ReviewState | null> {
  const file = Bun.file(statePath(pr));
  if (!(await file.exists())) return null;
  try { return ((await file.json()) as Stored).features ?? null; } catch { return null; }
}

/** Write the whole state atomically: a temp file next to the target, then rename. */
export async function saveState(pr: Review["pr"], features: ReviewState): Promise<void> {
  const path = statePath(pr);
  await mkdir(stateDir(), { recursive: true });
  const stored: Stored = { repo: pr.repo, number: pr.number, head: pr.head, savedAt: Date.now(), features };
  const tmp = `${path}.${process.pid}.tmp`;
  await Bun.write(tmp, JSON.stringify(stored, null, 2));
  await rename(tmp, path);
}
