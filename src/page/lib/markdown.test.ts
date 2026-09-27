import { expect, test } from "bun:test";
import { markdownRows, mdUnits, type Unit } from "./markdown.ts";

const raw = (u: Unit) => u.raw;
const pick = (us: Unit[]) => us.map((u) => ({ type: u.type, from: u.from, to: u.to, key: u.key }));

test("mdUnits: one unit per block, list items apart, with their source lines", () => {
  expect(pick(mdUnits("# Title\n\nPara one.\n\n- a\n- b\n", "ref", "docs/"))).toEqual([
    { type: "heading", from: 1, to: 1, key: "heading1\n# Title" },
    { type: "paragraph", from: 3, to: 3, key: "paragraph\nPara one." },
    { type: "item", from: 5, to: 5, key: "item\na" },
    { type: "item", from: 6, to: 6, key: "item\nb" },
  ]);
  expect(pick(mdUnits("1. one\n2. two\n", "ref", ""))).toEqual([
    { type: "item", from: 1, to: 1, key: "item1\none" },
    { type: "item", from: 2, to: 2, key: "item1\ntwo" },
  ]);
  expect(pick(mdUnits("```ts\nconst a = 1;\n```\n", "ref", ""))).toEqual([
    { type: "code", from: 1, to: 3, key: "code\n```ts\nconst a = 1;\n```" },
  ]);
});

test("mdUnits: front matter is a block, and so is source no token covers", () => {
  expect(pick(mdUnits("---\ntitle: x\n---\n# H\n", "ref", ""))).toEqual([
    { type: "front", from: 1, to: 3, key: "front\n---\ntitle: x\n---" },
    { type: "heading", from: 4, to: 4, key: "heading1\n# H" },
  ]);
  expect(pick(mdUnits("See [docs].\n\n[docs]: https://x.y\n", "ref", ""))).toEqual([
    { type: "paragraph", from: 1, to: 1, key: "paragraph\nSee [docs]." },
    { type: "raw", from: 3, to: 3, key: "raw\n[docs]: https://x.y" },
  ]);
});

test("mdUnits keeps the ref and dir links resolve against", () => {
  const [u] = mdUnits("Hi.\n", "abc", "docs/");
  expect([u.ref, u.dir]).toEqual(["abc", "docs/"]);
});

const rows = (before: string, after: string) =>
  markdownRows({ path: "docs/a.md", url: "", text: { before, after } }, "b", "h", raw)!
    .map((r) => [r.kind, r.old?.key ?? null, r.new?.key ?? null]);

test("markdownRows pairs an edited block, and splits a rewrite into removed and added", () => {
  expect(rows("# A\n\nText.\n", "# A\n\nText.\n")).toEqual([
    ["same", "heading1\n# A", "heading1\n# A"], ["same", "paragraph\nText.", "paragraph\nText."]]);
  expect(rows("# A\n\nThe quick brown fox jumps.\n", "# A\n\nThe quick brown fox leaps.\n")).toEqual([
    ["same", "heading1\n# A", "heading1\n# A"],
    ["mod", "paragraph\nThe quick brown fox jumps.", "paragraph\nThe quick brown fox leaps."]]);
  expect(rows("# A\n\nThe quick brown fox jumps.\n", "# A\n\nAn entirely different sentence here.\n")).toEqual([
    ["same", "heading1\n# A", "heading1\n# A"],
    ["del", "paragraph\nThe quick brown fox jumps.", null],
    ["add", null, "paragraph\nAn entirely different sentence here."]]);
  expect(rows("# A\n", "# A\n\nNew para.\n")).toEqual([
    ["same", "heading1\n# A", "heading1\n# A"], ["add", null, "paragraph\nNew para."]]);
});

test("markdownRows compares code by lines: half the lines kept is not enough to pair", () => {
  expect(rows("```ts\nconst a = 1;\nconst b = 2;\n```\n", "```ts\nconst a = 1;\nconst b = 3;\n```\n")).toEqual([
    ["del", "code\n```ts\nconst a = 1;\nconst b = 2;\n```", null],
    ["add", null, "code\n```ts\nconst a = 1;\nconst b = 3;\n```"]]);
});
