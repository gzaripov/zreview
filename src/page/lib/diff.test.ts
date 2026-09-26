import { expect, test } from "bun:test";
import { blockOps, lcsOps, wordDiff } from "./diff.ts";

test("lcsOps aligns two sequences, preferring a deletion when both ways tie", () => {
  expect(lcsOps(["a", "b"], ["a", "b"])).toEqual([["same", 0, 0], ["same", 1, 1]]);
  expect(lcsOps(["a", "b", "c"], ["a", "c"])).toEqual([["same", 0, 0], ["del", 1, -1], ["same", 2, 1]]);
  expect(lcsOps([], ["x"])).toEqual([["ins", -1, 0]]);
  expect(lcsOps(["x"], [])).toEqual([["del", 0, -1]]);
});

test("wordDiff merges runs and keeps whitespace, so each side reassembles exactly", () => {
  expect(wordDiff("the quick fox", "the slow fox")).toEqual([
    { kind: "same", text: "the " }, { kind: "del", text: "quick" }, { kind: "ins", text: "slow" }, { kind: "same", text: " fox" },
  ]);
  const parts = wordDiff("a b  c\nd", "a x  c d e")!;
  expect(parts.filter((p) => p.kind !== "ins").map((p) => p.text).join("")).toBe("a b  c\nd");
  expect(parts.filter((p) => p.kind !== "del").map((p) => p.text).join("")).toBe("a x  c d e");
});

test("wordDiff gives up past 2400 tokens", () => {
  expect(wordDiff("w ".repeat(1201), "")).toBeNull();
});

test("blockOps trims the common ends and diffs only the middle", () => {
  expect(blockOps(["h", "a", "b", "t"], ["h", "x", "t"])).toEqual(
    [["same", 0, 0], ["del", 1, -1], ["del", 2, -1], ["ins", -1, 1], ["same", 3, 2]]);
});

test("blockOps refuses a middle too large to align", () => {
  const a = Array.from({ length: 2001 }, (_, i) => `a${i}`), b = Array.from({ length: 2001 }, (_, i) => `b${i}`);
  expect(blockOps(a, b)).toBeNull();
});
