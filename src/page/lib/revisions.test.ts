import { expect, test } from "bun:test";
import { countViewed, fhash, fileShot, freshLines, hashStr, isViewedIn, LINE_CAP, sinceSeen, snapshot } from "./revisions.ts";
import type { Feature, FileRef } from "./types.ts";

const file = (path: string, lines: [" " | "+" | "-", string][]): FileRef =>
  ({ path, url: "", add: 0, del: 0, hunks: [{ header: "@@ -1 +1 @@", lines: lines.map(([t, text]) => ({ t, text })) }] });
const feature = (over: Partial<Feature> = {}): Feature => ({
  id: "f", title: "F", scenario: "S", description: "D", tested: "T",
  entities: [{ name: "E", change: "added", summary: "e" }], diagrams: [{ mermaid: "flowchart LR\nA-->B" }],
  files: [file("a.ts", [["+", "one"], ["+", "two"]])], ...over,
});

test("hashStr is 32-bit FNV-1a in hex", () => {
  expect(["", "a", "foobar"].map(hashStr)).toEqual(["811c9dc5", "e40c292c", "bf9cf968"]);
});

test("snapshot takes everything a reviewer reads on a feature", () => {
  expect(snapshot(feature(), "h", 5)).toEqual({
    at: 5, head: "h", text: { scenario: "S", description: "D", tested: "T" }, entities: { E: "1d02686" },
    diagrams: "ea22c5b7", files: { "a.ts": { h: "cfcb20ed", lines: ["+one", "+two"] } },
  });
});

test("fileShot keeps the hash but drops the lines past LINE_CAP, and has neither without hunks", () => {
  const big = file("big.ts", Array.from({ length: LINE_CAP + 1 }, (_, i) => ["+", `l${i}`] as ["+", string]));
  expect(fileShot(big).h).not.toBeNull();
  expect(fileShot(big).lines).toBeNull();
  expect(fileShot({ path: "x", url: "" })).toEqual({ h: null, lines: null });
});

test("freshLines marks the lines not seen before, order-insensitively, and counts the ones gone", () => {
  expect(freshLines(null, ["a"])).toBeNull();
  expect(freshLines(["a", "b"], undefined)).toEqual([false, false]);
  const moved = freshLines(["a", "b", "c"], ["b", "a", "x"])!;
  expect([...moved]).toEqual([false, false, true]);
  expect(moved.gone).toBe(1);
  const twice = freshLines(["a", "a"], ["a"])!;
  expect([...twice]).toEqual([false, true]);
  expect(twice.gone).toBe(0);
});

const seen = snapshot(feature(), "h", 5);
const nothing = { any: false, at: 5, head: "h", text: {}, entities: new Set(), diagrams: false, files: {}, newFiles: [] };

test("sinceSeen: nothing moved, or never seen", () => {
  expect(sinceSeen(feature(), seen)).toEqual(nothing);
  expect(sinceSeen(feature(), undefined)).toEqual({ any: false, at: undefined, head: undefined, text: {}, entities: new Set(), diagrams: false, files: {} });
});

test("sinceSeen: a reworded passage comes back with what it said", () => {
  expect(sinceSeen(feature({ scenario: "S2" }), seen)).toEqual({ ...nothing, any: true, text: { scenario: "S" } });
});

test("sinceSeen: a changed entity is named; a new one is not a change", () => {
  expect(sinceSeen(feature({ entities: [{ name: "E", change: "added", summary: "changed" }] }), seen))
    .toEqual({ ...nothing, any: true, entities: new Set(["E"]) });
  expect(sinceSeen(feature({ entities: [{ name: "N", change: "added", summary: "e" }] }), seen)).toEqual(nothing);
});

test("sinceSeen: diagrams, new files and reworked files", () => {
  expect(sinceSeen(feature({ diagrams: [] }), seen)).toEqual({ ...nothing, any: true, diagrams: true });
  expect(sinceSeen(feature({ files: [file("a.ts", [["+", "one"], ["+", "two"]]), file("b.ts", [["+", "x"]])] }), seen))
    .toEqual({ ...nothing, any: true, newFiles: ["b.ts"] });
  const rework = sinceSeen(feature({ files: [file("a.ts", [["+", "one"], ["+", "three"]])] }), seen);
  expect(rework.any).toBe(true);
  expect(rework.files["a.ts"]).toMatchObject({ added: 1, gone: 1 });
  expect([...rework.files["a.ts"].fresh!]).toEqual([false, true]);
});

test("a file is viewed while its hunks are the ones marked", () => {
  const a = file("a.ts", [["+", "one"]]);
  const entry = { viewed: { "a.ts": fhash(a) } };
  expect(isViewedIn(entry, a)).toBe(true);
  expect(isViewedIn(entry, file("a.ts", [["+", "two"]]))).toBe(false);
  expect(isViewedIn(undefined, a)).toBe(false);
  expect(countViewed(feature({ files: [a, file("b.ts", [])] }), entry)).toEqual({ seen: 1, total: 2 });
});
