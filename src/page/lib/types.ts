// What the page reads and writes. Review, Feature and FileRef come from the build (by the time the page has a
// feature, every file in it is a FileRef); the rest is the per-feature state the page keeps and the server stores
// as it is.
import type { Entity, Feature, FileRef, Hunk, Review } from "../../build.ts";
export type { Entity, Feature, FileRef, Hunk, Review };

export type Comment =
  | { id: string; kind: "line"; file: string; side: "old" | "new"; line: number; body: string; at: number }
  | { id: string; kind: "file"; file: string; body: string; at: number }
  | { id: string; kind: "text"; section: string; quote: string; body: string; at: number };

/** A file as the reviewer last saw it: the hash of its hunks, and its lines while there are few enough to keep. */
export type FileShot = { h: string | null; lines: string[] | null };
/** What the reviewer had in front of them on a feature: taken when they decide, and per file when they mark it viewed. */
export type Seen = {
  at: number; head: string;
  text?: { scenario: string; description: string; tested: string };
  entities?: Record<string, string>;
  diagrams?: string;
  files?: Record<string, FileShot>;
};
export type Entry = {
  decision?: "approved" | "changes"; note?: string; at?: number; head?: string;
  seen?: Seen; viewed?: Record<string, string | null>; comments?: Comment[];
};
export type State = Record<string, Entry>;

export const filesOf = (f: Feature) => (f.files ?? []) as FileRef[];
