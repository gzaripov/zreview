import { expect, test } from "bun:test";
import { summary } from "./summary.ts";
import type { Review, State } from "./types.ts";

const features = [{ id: "one", title: "First" }, { id: "two", title: "Second" }, { id: "three", title: "Third" }]
  .map((f) => ({ ...f, scenario: "", description: "" }));

test("the summary lists each feature's decision, note and comments", () => {
  const review: Review = { pr: { repo: "acme/app", number: 7, title: "T", head: "abc1234", base: "main", url: "" }, features };
  const state: State = {
    one: { decision: "approved", note: "Ship it\nafter lunch", comments: [
      { id: "1", kind: "line", file: "a.ts", line: 3, side: "new", body: "Rename this", at: 0 },
      { id: "2", kind: "file", file: "b.ts", body: "Split the file", at: 0 },
      { id: "3", kind: "text", section: "scenario", quote: "x".repeat(90), body: "Too long", at: 0 },
      { id: "4", kind: "text", section: "scenario", quote: "short quote", body: "Fine", at: 0 },
    ] },
    two: { decision: "changes", comments: [] },
  };
  expect(summary(review, state)).toBe([
    "## Review of acme/app#7 at `abc1234`",
    "",
    "1. **First** — ✅ Approved",
    "   > Ship it",
    "   > after lunch",
    "   - `a.ts:3` — Rename this",
    "   - `b.ts` — Split the file",
    `   - "${"x".repeat(77)}…" — Too long`,
    '   - "short quote" — Fine',
    "2. **Second** — ❌ Changes requested",
    "3. **Third** — ⬜ Not reviewed",
  ].join("\n"));
});

test("a plan's summary is headed by the repo and title", () => {
  const plan: Review = { plan: true, pr: { repo: "acme/app", title: "Flatten" }, features };
  expect(summary(plan, {}).split("\n")[0]).toBe("## Plan review of acme/app — Flatten");
});
