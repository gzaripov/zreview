import { describe, expect, test } from "bun:test";
import { parseUnifiedDiff, resolveOwnership, type Feature, type FileRef } from "./build.ts";

const DIFF = [
  "diff --git a/src/shared.ts b/src/shared.ts",
  "--- a/src/shared.ts",
  "+++ b/src/shared.ts",
  "@@ -1,6 +1,8 @@",
  " import { a } from './a';",
  "-import { b } from './b';",
  "+import { b, c } from './b';",
  "+import { d } from './d';",
  " ",
  " export const one = 1;",
  "-export const two = 2;",
  "+export const two = 22;",
  "+export const three = 3;",
  " export const four = 4;",
  "@@ -20,3 +22,4 @@ export function f() {",
  "   return 1;",
  " }",
  "-const gone = true;",
  "+",
  "+export const tail = d();",
  "diff --git a/src/solo.ts b/src/solo.ts",
  "--- a/src/solo.ts",
  "+++ b/src/solo.ts",
  "@@ -1,2 +1,3 @@",
  " export const x = 1;",
  "+export const y = 2;",
  " export const z = 3;",
].join("\n");

type Listing = string | { path: string; lines?: (string | number)[]; phrases?: string[] };
const feature = (id: string, ...files: Listing[]): Feature => ({
  id, title: id, scenario: "", description: "",
  files: files.map((x) => (typeof x === "string" ? { path: x, url: "" } : { url: "", ...x })) as FileRef[],
});
const resolve = (...features: Feature[]) => resolveOwnership(features, parseUnifiedDiff(DIFF));
const own = (f: Feature, path: string) => (f.files as FileRef[]).find((x) => x.path === path)!.own;

describe("resolveOwnership", () => {
  test("a file one feature lists is that feature's whole", () => {
    const alpha = feature("alpha", "src/solo.ts");
    const { problems, owners } = resolve(alpha);
    expect(problems).toEqual([]);
    expect([...owners.get("src/solo.ts")!.values()]).toEqual([["alpha"]]);
    expect(own(alpha, "src/solo.ts")).toBeUndefined();
  });

  test("a shared file listed without lines is refused", () => {
    const { problems, rejected } = resolve(feature("alpha", "src/shared.ts"), feature("beta", "src/shared.ts"));
    expect(problems).toEqual([`src/shared.ts: listed by 2 features, and alpha, beta give no "lines"`]);
    expect([...rejected]).toEqual(["src/shared.ts"]);
  });

  test("claims split a shared file, and a removed line goes with the lines added in its place", () => {
    const alpha = feature("alpha", { path: "src/shared.ts", lines: ["2-3", "24-25"] });
    const beta = feature("beta", { path: "src/shared.ts", lines: ["6-7"] });
    expect(resolve(alpha, beta).problems).toEqual([]);
    expect(own(alpha, "src/shared.ts")).toEqual({ new: [2, 3, 24, 25], old: [2, 22] });
    expect(own(beta, "src/shared.ts")).toEqual({ new: [6, 7], old: [5] });
  });

  test("a removed line replaced by two features' lines needs old:N", () => {
    const alpha = (...lines: string[]) => feature("alpha", { path: "src/shared.ts", lines: ["2", "24-25", ...lines] });
    const beta = feature("beta", { path: "src/shared.ts", lines: ["3", "6-7"] });
    expect(resolve(alpha(), beta).problems).toEqual(["src/shared.ts: no feature claims old:2"]);
    expect(resolve(alpha("old:2"), beta).problems).toEqual([]);
  });

  test("a line two features claim belongs to both", () => {
    const alpha = feature("alpha", { path: "src/shared.ts", lines: ["2-3", "24-25", "old:2"] });
    const beta = feature("beta", { path: "src/shared.ts", lines: ["3", "6-7"] });
    const { problems, owners } = resolve(alpha, beta);
    expect(problems).toEqual([]);
    const three = [...owners.get("src/shared.ts")!].find(([l]) => l.new === 3)!;
    expect(three[1]).toEqual(["alpha", "beta"]);
  });

  test("a range that names no changed line is refused, so stale numbers cannot slip through", () => {
    const alpha = feature("alpha", { path: "src/shared.ts", lines: ["1", "2-3", "24-25", "old:9"] });
    const beta = feature("beta", { path: "src/shared.ts", lines: ["6-7"] });
    expect(resolve(alpha, beta).problems).toEqual([
      `feature alpha, src/shared.ts: "1" names no added line`,
      `feature alpha, src/shared.ts: "old:9" names no removed line`,
    ]);
  });

  test("lines must be ranges", () => {
    const alpha = feature("alpha", { path: "src/shared.ts", lines: ["2-3", "24-25", "two"] }, { path: "src/solo.ts", lines: [] });
    const beta = feature("beta", { path: "src/shared.ts", lines: ["6-7"] });
    const { problems } = resolve(alpha, beta);
    expect(problems).toContain(`feature alpha, src/shared.ts: "two" is not a line or a range — write "550", "550-558", or "old:45" for a removed line`);
    expect(problems).toContain(`feature alpha, src/solo.ts: "lines" must list at least one line or range, like ["550-558", "587", "old:45"]`);
  });

  test("a phrase must be in the lines its feature claims", () => {
    const alpha = (phrase: string) => feature("alpha", { path: "src/shared.ts", lines: ["2-3", "24-25"], phrases: [phrase] });
    const beta = feature("beta", { path: "src/shared.ts", lines: ["6-7"] });
    expect(resolve(alpha("export const tail"), beta).problems).toEqual([]);
    expect(resolve(alpha("export const three"), beta).problems).toEqual([
      `feature alpha, src/shared.ts: phrase "export const three" is in none of the changed lines this feature claims`,
    ]);
  });
});
