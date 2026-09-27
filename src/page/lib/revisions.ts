// Revisions: what the reviewer had in front of them last time. Taken when they decide on a feature and, per
// file, when they mark it viewed. Everything a reviewer reads is in it — the prose, the entities, the diagrams
// and the diff itself — so the next run can show what the author moved rather than only that something moved.
import { filesOf, type Entry, type Feature, type FileRef, type FileShot, type Seen } from "./types.ts";

export const LINE_CAP = 4000;                     // beyond this a file keeps its hash but not its lines
export const hashStr = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
export const fhash = (file: FileRef) => file.hunks ? hashStr(JSON.stringify(file.hunks)) : null;
export const flatLines = (file: FileRef) => file.hunks ? file.hunks.flatMap((h) => h.lines.map((l) => l.t + l.text)) : null;
export const fileShot = (file: FileRef): FileShot => { const lines = flatLines(file); return { h: fhash(file), lines: lines && lines.length <= LINE_CAP ? lines : null }; };
export const textOf = (f: Feature) => ({ scenario: f.scenario || "", description: f.description || "", tested: f.tested || "" });
export const entityShots = (f: Feature) => Object.fromEntries((f.entities || []).map((e) => [e.name, hashStr(JSON.stringify(e))]));

export const snapshot = (f: Feature, head: string, at = Date.now()): Seen => ({
  at, head, text: textOf(f), entities: entityShots(f),
  diagrams: hashStr(JSON.stringify(f.diagrams || [])),
  files: Object.fromEntries(filesOf(f).map((file) => [file.path, fileShot(file)])),
});

/** Viewed while the hunks are the ones the reviewer marked; a reworked file needs another look. */
export const isViewedIn = (entry: Entry | undefined, file: FileRef) => {
  const v = entry?.viewed;
  return !!v && file.path in v && v[file.path] === fhash(file);
};
export const countViewed = (f: Feature, entry: Entry | undefined) => {
  const files = filesOf(f);
  return { seen: files.filter((x) => isViewedIn(entry, x)).length, total: files.length };
};

export type Fresh = boolean[] & { gone?: number };
/** Lines of `now` the reviewer has not seen. Order-insensitive, so code that only moved is not "new". */
export function freshLines(now: string[] | null, before: string[] | null | undefined): Fresh | null {
  if (!now) return null;
  if (!before) return now.map(() => false);
  const left = new Map<string, number>();
  for (const l of before) left.set(l, (left.get(l) || 0) + 1);
  const fresh: Fresh = now.map((l) => { const n = left.get(l) || 0; if (n) { left.set(l, n - 1); return false; } return true; });
  let gone = 0; for (const n of left.values()) gone += n;
  fresh.gone = gone;
  return fresh;
}

export type Since = {
  any: boolean; at?: number; head?: string;
  /** The passages reworded since, with what they said. */
  text: Partial<Record<"scenario" | "description" | "tested", string>>;
  entities: Set<string>; diagrams: boolean;
  /** Missing when the reviewer never looked. */
  newFiles?: string[];
  files: Record<string, { fresh: Fresh | null; added: number | null; gone: number | null | undefined }>;
};
/** Everything that moved since the reviewer's snapshot, keyed the way the panel needs it. */
export function sinceSeen(f: Feature, s: Seen | undefined): Since {
  const out: Since = { any: false, at: s?.at, head: s?.head, text: {}, entities: new Set(), diagrams: false, files: {} };
  if (!s) return out;
  if (s.text) for (const k of ["scenario", "description", "tested"] as const) {
    if ((s.text[k] ?? "") !== (textOf(f)[k] ?? "")) { out.text[k] = s.text[k] ?? ""; out.any = true; }
  }
  if (s.entities) for (const [name, h] of Object.entries(entityShots(f))) {
    if (s.entities[name] !== undefined && s.entities[name] !== h) { out.entities.add(name); out.any = true; }
  }
  if (s.diagrams !== undefined && s.diagrams !== hashStr(JSON.stringify(f.diagrams || []))) { out.diagrams = true; out.any = true; }
  out.newFiles = s.files ? filesOf(f).filter((x) => !(x.path in s.files!)).map((x) => x.path) : [];
  if (out.newFiles.length) out.any = true;
  for (const file of filesOf(f)) {
    const was = s.files?.[file.path];
    if (!was || was.h === fhash(file)) continue;
    const fresh = freshLines(flatLines(file), was.lines);
    out.files[file.path] = { fresh, added: fresh ? fresh.filter(Boolean).length : null, gone: fresh ? fresh.gone : null };
    out.any = true;
  }
  return out;
}
