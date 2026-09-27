# Page bundle (PR A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bun bundles the review page, and the page's pure logic lives in tested TypeScript modules — with no visible change — so PR B can rewrite the rendering on a pinned base.

**Architecture:** `build.ts` runs `Bun.build` on `src/page/app.js` (now an ES module) and embeds the bundle as a base64 `data:` script. marked, DOMPurify and highlight.js become bundled npm dependencies. Functions that do not touch the DOM move verbatim from `app.js` into `src/page/lib/*.ts`, each with characterization tests whose expected values were captured by running the original code. A Playwright script drives a real `zreview review` run before and after every step.

**Tech Stack:** Bun 1.4 (bundler, test runner), marked 12.0.2, DOMPurify 3.2.7, highlight.js 11.11.1, playwright-core 1.63.0 driving the installed Google Chrome.

**Spec:** `docs/superpowers/specs/2026-09-26-page-rework-design.md` (PR A section).

## Global Constraints

- No visible change to the page, no change to `review.json`, the CLI flags, the server API or the saved state files.
- Dependencies pinned to exact versions: `marked` `12.0.2`, `dompurify` `3.2.7`, `highlight.js` `11.11.1` in `dependencies`; `playwright-core` `1.63.0` in `devDependencies`. `bun.lock` is gitignored in this repo, so the pin is the only lock.
- Mermaid and Monaco stay on the CDN, untouched.
- Nothing may depend on `process.cwd()`: the CLI runs from the reviewer's project directory. Resolve paths from `import.meta.dir`.
- Moved code keeps its behavior byte for byte, including side effects the page relies on (e.g. `entry()` creating state entries on read).
- Style: match the file you are in. `app.js` uses single quotes and terse arrow functions; `src/*.ts` uses double quotes. Comments say why, not what.
- Every commit ends with these two trailer lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011LxqEm1h22MmzaNxwFkZy1
  ```
- Work in the worktree `/Users/gzaripov/code/zreview/.claude/worktrees/page-bundle` on branch `feat/page-bundle`. Never `cd` elsewhere; never touch `/Users/gzaripov/code/zreview` itself (the linked `zreview` CLI runs from it).
- The end-to-end test needs network (Mermaid and Monaco from jsdelivr) and Google Chrome at its standard location.

## File Structure

```
package.json                         + deps, devDeps, scripts "test" and "e2e"
src/build.ts                         + pageScript(): bundle src/page/app.js; buildHtml embeds it as a data: URL
src/build.test.ts                    new — the page carries the bundle, review text cannot break the page
src/page/index.html                  - three CDN tags, + #review-boot JSON, data: script
src/page/app.js                      ES module: imports npm libs and lib/*; moved functions deleted
src/page/lib/diff.ts (+ .test.ts)    lcsOps, wordDiff, blockOps
src/page/lib/html.ts (+ .test.ts)    esc
src/page/lib/highlight.ts (+ .test)  langOf, hlLines
src/page/lib/types.ts                Comment, FileShot, Seen, Entry, State; filesOf()
src/page/lib/revisions.ts (+ .test)  hashing, snapshots, freshLines, sinceSeen, viewed helpers
src/page/lib/markdown.ts (+ .test)   MARKDOWN, Unit, Row, mdUnits, likeness, pairUp, markdownRows
src/page/lib/reading.ts (+ .test)    ORDER, groupOf, reading
src/page/lib/summary.ts (+ .test)    summary(review, state)
test/e2e/fixture/review.json         three features, one entity, one diagram, four files
test/e2e/fixture/review.diff         the diff those four files make
test/e2e/review.e2e.test.ts          one reviewer session, first look to Submit
README.md, install.sh                layout and develop notes
```

`bun test src` runs the unit tests (fast, offline). `bun run e2e` runs the browser test.

---

### Task 1: End-to-end test of the page as it is today

A baseline: the same script must pass unchanged after every later task.

**Files:**
- Modify: `package.json`
- Create: `test/e2e/fixture/review.json`, `test/e2e/fixture/review.diff`, `test/e2e/review.e2e.test.ts`

**Interfaces:**
- Produces: `bun run e2e` (exit 0 = the page works end to end). Later tasks run it as their integration check.
- The locators are the page's contract with PR B: headings with feature titles, and the rendered Markdown's own headings; sidebar buttons whose names contain the feature title, the viewed count (`1/2`) and the status (`approved`, `changes requested`); file paths as exact text that opens the file; checkbox `Viewed`; placeholders `Comment` and `Note for the author (optional)`; buttons `Save`, `Comment`, `Full screen`, `Approve`, `Request changes`, `Focus review…`, `Submit review`; the words `Source` (switch a Markdown file to its source); dialogs `Diagram, full screen` and `Focus review`; the text `Submitted`; diagrams as `figure svg`; entity examples in Monaco (`.monaco-editor`).

- [ ] **Step 1: Add playwright-core and the scripts**

Edit `package.json`: add after the `"scripts"` entries and a `devDependencies` block. The whole file becomes:

```json
{
  "name": "zreview",
  "version": "0.2.0",
  "description": "Review a pull request one feature at a time. Opens a local page, blocks until you decide, prints the decision.",
  "type": "module",
  "bin": { "zreview": "src/cli.ts", "zplan": "src/zplan.ts" },
  "files": ["src", "README.md"],
  "scripts": {
    "review": "bun run src/cli.ts review",
    "build": "bun run src/cli.ts build",
    "test": "bun test src",
    "e2e": "bun test test/e2e --timeout 120000"
  },
  "engines": { "bun": ">=1.2" },
  "dependencies": { "mermaid": "11.4.1" },
  "devDependencies": { "playwright-core": "1.63.0" },
  "overrides": { "@mermaid-js/parser": "0.3.0" },
  "license": "MIT",
  "author": "Gleb Zaripov <https://zaripov.dev>",
  "repository": "github:gzaripov/zreview",
  "keywords": ["pull-request", "code-review", "review", "cli", "bun"]
}
```

Run: `bun install`
Expected: `playwright-core` installed, no errors.

- [ ] **Step 2: Write the fixture review**

Create `test/e2e/fixture/review.json`:

```json
{
  "id": "e2e-fixture",
  "pr": {
    "repo": "acme/app", "number": 7, "url": "https://github.com/acme/app/pull/7",
    "title": "Flatten live positions", "base": "main", "head": "abc1234",
    "exposure": "Touches the live trading loop."
  },
  "features": [
    {
      "id": "flatten",
      "title": "Flatten live positions when a run halts",
      "scenario": "A run leaving RUNNING closes its open positions, so a halt never leaves exposure on the book.",
      "description": "Adds `flattenRunPositions`, which takes the position lock before it reads what is open.",
      "entities": [
        {
          "name": "Position", "kind": "type", "change": "changed", "file": "app/src/domain/position.ts",
          "summary": "A holding a run has opened.",
          "fields": [{ "name": "closedReason", "type": "\"halt\" | \"manual\"", "meaning": "Why it was closed.", "change": "added" }],
          "examples": [{ "title": "Closed by a halt", "value": { "id": "p1", "closedReason": "halt" } }]
        }
      ],
      "diagrams": [{ "title": "Halt flow", "mermaid": "flowchart LR\n  A[Run leaves RUNNING] --> B[flattenRunPositions]\n  B --> C[broker.close]" }],
      "files": ["app/src/trading/live-flatten.ts", "app/src/domain/position.ts"],
      "tested": "Unit tests for the flatten loop."
    },
    {
      "id": "api",
      "title": "Expose POST /api/runs/:id/flatten",
      "scenario": "An operator flattens a run by hand.",
      "description": "A route that calls `flattenRunPositions`, and a page on what flattening does.",
      "files": ["app/src/api/routes.ts", "docs/flatten.md"],
      "tested": "A route test."
    },
    {
      "id": "ui",
      "title": "Pack view hides closed positions",
      "scenario": "A learner sees only what is still held.",
      "description": "Filters out positions with a `closedReason`.",
      "files": ["app/src/ui/pack-view.tsx"],
      "tested": "Looked at it."
    }
  ]
}
```

Create `test/e2e/fixture/review.diff` (keep the trailing newline):

```diff
diff --git a/app/src/trading/live-flatten.ts b/app/src/trading/live-flatten.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/app/src/trading/live-flatten.ts
@@ -0,0 +1,8 @@
+import { positions, broker } from "./deps";
+import type { Run } from "../domain/position";
+
+export async function flattenRunPositions(run: Run) {
+  const open = await positions.openFor(run.id, { lock: true });
+  for (const p of open) await broker.close(p, "halt");
+  return open.length;
+}
diff --git a/app/src/domain/position.ts b/app/src/domain/position.ts
index 2222222..3333333 100644
--- a/app/src/domain/position.ts
+++ b/app/src/domain/position.ts
@@ -1,4 +1,5 @@
 export type Run = { id: string; state: "RUNNING" | "HALTED" };
 export type Position = {
   id: string;
+  closedReason?: "halt" | "manual";
 };
diff --git a/app/src/api/routes.ts b/app/src/api/routes.ts
index 4444444..5555555 100644
--- a/app/src/api/routes.ts
+++ b/app/src/api/routes.ts
@@ -10,3 +10,6 @@ export const routes = {
   "GET /api/runs": listRuns,
   "GET /api/runs/:id": getRun,
+  "POST /api/runs/:id/flatten": async (_req: Request, id: string) => {
+    return Response.json({ closed: await flattenRunPositions(await getRun(id)) });
+  },
 };
diff --git a/app/src/ui/pack-view.tsx b/app/src/ui/pack-view.tsx
index 6666666..7777777 100644
--- a/app/src/ui/pack-view.tsx
+++ b/app/src/ui/pack-view.tsx
@@ -1,3 +1,4 @@
 export function PackView({ pack }: { pack: Pack }) {
-  return <ul>{pack.positions.map((p) => <li key={p.id}>{p.id}</li>)}</ul>;
+  const shown = pack.positions.filter((p) => !p.closedReason);
+  return <ul>{shown.map((p) => <li key={p.id}>{p.id}</li>)}</ul>;
 }
diff --git a/docs/flatten.md b/docs/flatten.md
new file mode 100644
index 0000000..8888888
--- /dev/null
+++ b/docs/flatten.md
@@ -0,0 +1,5 @@
+# Flattening a run
+
+A run that leaves RUNNING closes every open position.
+
+- The lock is taken first.
```

`docs/flatten.md` is a new file, so the page renders it from the diff alone (no `gh`): the e2e covers the rendered
Markdown view and its Rendered/Source switch.

Check it builds: `bun run src/cli.ts build test/e2e/fixture/review.json --diff test/e2e/fixture/review.diff -o /tmp/zreview-e2e-check.html`
Expected: `wrote /tmp/zreview-e2e-check.html (<size> KB): 3 features, 0 with screenshots, 1 diagrams`. Delete the file after.

- [ ] **Step 3: Write the test**

Create `test/e2e/review.e2e.test.ts`:

```ts
// End to end: a real `zreview review` run, driven in Chrome the way a reviewer uses it. Locators are roles,
// labels and visible words, so the same script checks any version of the page that keeps its words.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

const root = join(import.meta.dir, "..", "..");
const fixture = join(import.meta.dir, "fixture");

type Run = { proc: Bun.Subprocess<"ignore", "pipe", "pipe">; url: string; stateDir: string; stderr: () => string };

/** `zreview review` on the fixture, on a free port, with state in a temp dir; resolves once it serves. */
async function startReview(): Promise<Run> {
  const stateDir = await mkdtemp(join(tmpdir(), "zreview-e2e-"));
  const proc = Bun.spawn(["bun", "run", join(root, "src/cli.ts"), "review", join(fixture, "review.json"),
    "--diff", join(fixture, "review.diff"), "--no-open", "--port", "0", "--timeout", "0", "--json", "--fresh"], {
    cwd: fixture, env: { ...process.env, ZREVIEW_STATE_DIR: stateDir }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  let log = "";
  const { promise: served, resolve, reject } = Promise.withResolvers<string>();
  (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) {
      log += decoder.decode(chunk);
      const m = /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(log);
      if (m) resolve(m[1]);
    }
    reject(new Error(`zreview stopped before serving:\n${log}`));
  })();
  return { proc, url: await served, stateDir, stderr: () => log };
}

/** Select `needle` in the page's main column and let go of the mouse, as a reviewer quoting prose does. */
async function selectText(page: Page, needle: string) {
  await page.evaluate((needle) => {
    const root = document.querySelector("main") ?? document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const at = n.data.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(n, at);
      range.setEnd(n, at + needle.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      n.parentElement!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return;
    }
    throw new Error(`not on the page: ${needle}`);
  }, needle);
}

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ channel: "chrome" }); });
afterAll(async () => { await browser?.close(); });

test("a review from the first look to Submit", async () => {
  const run = await startReview();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const feature = (title: RegExp) => page.getByRole("button", { name: title });   // its entry in the sidebar
  try {
    await page.goto(run.url);
    await page.getByRole("heading", { name: "Flatten live positions when a run halts" }).waitFor();

    // A comment on a diff line: open the file, click the line, write, save.
    await page.getByText("app/src/trading/live-flatten.ts", { exact: true }).click();
    await page.getByText("positions.openFor(run.id").click();
    await page.getByPlaceholder("Comment").fill("Take the lock outside the loop");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText("Take the lock outside the loop").first().waitFor();

    // A comment on a passage of the scenario.
    await selectText(page, "open positions");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await page.getByPlaceholder("Comment").fill("Say which positions");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText("Say which positions").first().waitFor();

    // A file marked viewed counts in the sidebar.
    await page.getByRole("checkbox", { name: "Viewed" }).first().check();
    await feature(/Flatten live positions/).filter({ hasText: "1/2" }).waitFor();

    // The entity's example loads into Monaco (from the CDN, through its AMD loader).
    await page.locator(".monaco-editor").first().waitFor();

    // The diagram, full screen and back.
    await page.locator("figure svg").first().waitFor();
    await page.getByRole("button", { name: "Full screen" }).click();
    await page.getByRole("dialog", { name: "Diagram, full screen" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Diagram, full screen" }).waitFor({ state: "hidden" });

    // Approve, with a note.
    await page.getByPlaceholder("Note for the author (optional)").fill("Ship it");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await feature(/Flatten live positions/).filter({ hasText: "approved" }).waitFor();

    // The next feature: its Markdown page renders, and shows its source on request. Then it goes back.
    await feature(/Expose POST/).click();
    await page.getByRole("heading", { name: "Expose POST /api/runs/:id/flatten" }).waitFor();
    await page.getByText("docs/flatten.md", { exact: true }).click();
    await page.getByRole("heading", { name: "Flattening a run" }).waitFor();
    await page.getByText("Source", { exact: true }).click();
    await page.getByText("# Flattening a run").waitFor();
    await page.getByPlaceholder("Note for the author (optional)").fill("Validate the id");
    await page.getByRole("button", { name: "Request changes" }).click();
    await feature(/Expose POST/).filter({ hasText: "changes requested" }).waitFor();

    // Focus review: Enter marks the only file viewed and, past the last one, closes.
    await feature(/Pack view/).click();
    await page.getByRole("button", { name: /Focus review/ }).click();
    const focus = page.getByRole("dialog", { name: "Focus review" });
    await focus.waitFor();
    await page.keyboard.press("Enter");
    await focus.waitFor({ state: "hidden" });
    await feature(/Pack view/).filter({ hasText: "1/1" }).waitFor();

    // Submit: the run prints the decision and exits.
    await page.getByRole("button", { name: "Submit review" }).click();
    await page.getByText("Submitted").waitFor();
    const out = await new Response(run.proc.stdout).text();
    expect(await run.proc.exited).toBe(0);
    const outcome = JSON.parse(out);
    expect(outcome.decision).toBe("changes");
    expect(outcome.features.flatten).toMatchObject({ decision: "approved", note: "Ship it" });
    expect(outcome.features.api).toMatchObject({ decision: "changes", note: "Validate the id" });
    expect(outcome.features.flatten.comments.map((c: { body: string }) => c.body).sort())
      .toEqual(["Say which positions", "Take the lock outside the loop"]);
    expect(outcome.summary).toContain("`app/src/trading/live-flatten.ts:5` — Take the lock outside the loop");
    expect(outcome.summary).toContain('"open positions" — Say which positions');
    expect(errors).toEqual([]);
  } catch (e) {
    console.error(`zreview stderr:\n${run.stderr()}`);
    throw e;
  } finally {
    run.proc.kill();
    await page.close();
    await rm(run.stateDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run it against today's page**

Run: `bun run e2e`
Expected: `1 pass`, `0 fail`. This is a baseline, not a red test: the page already works. If a locator fails, the fixture or the locator is wrong — fix the test, never the page, in this task. If Chrome is not found, stop and report.

- [ ] **Step 5: Commit**

```bash
git add package.json test/e2e
git commit -m "test: drive a real review end to end in Chrome

One reviewer session on a fixture — line and prose comments, viewed files,
the diagram full screen, approve, request changes, focus review, Submit —
checked against what zreview prints. Locators are roles and words, so the
same script checks the page after it is rewritten.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011LxqEm1h22MmzaNxwFkZy1"
```

---

### Task 2: Bun bundles the page

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src/build.ts` (add `pageScript`, embed it; fix `buildHtml`'s return type)
- Modify: `src/page/index.html`
- Modify: `src/page/app.js` (imports, boot JSON, library globals)
- Create: `src/build.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function pageScript(): Promise<string>` in `src/build.ts` — the minified IIFE bundle of `src/page/app.js`, memoized per process. `buildHtml(...)` now resolves to `{ html, review, log, stateSlot }`. The page reads `{ served, state }` from `<script id="review-boot" type="application/json">`.

- [ ] **Step 1: Write the failing test**

Create `src/build.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHtml, pageScript } from "./build.ts";

const review = (title: string) => ({
  pr: { repo: "acme/app", number: 1, url: "https://github.com/acme/app/pull/1", title, base: "main", head: "abc" },
  features: [{ id: "f", title: "F", scenario: "S", description: "D" }],
});
async function build(title: string, served: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "zreview-build-"));
  await writeFile(join(dir, "review.json"), JSON.stringify(review(title)));
  return buildHtml(join(dir, "review.json"), { maxWidth: 0, quality: 82, served });
}
const scriptOf = (html: string, id: string) => new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`).exec(html)![1];

test("the page carries one script: the bundle, byte for byte", async () => {
  const { html } = await build("T", false);
  const scripts = [...html.matchAll(/<script src="data:text\/javascript;base64,([A-Za-z0-9+/=]+)"><\/script>/g)];
  expect(scripts).toHaveLength(1);
  expect(Buffer.from(scripts[0][1], "base64").toString()).toBe(await pageScript());
});

test("marked, DOMPurify and highlight.js come in the bundle, not from the CDN", async () => {
  const { html } = await build("T", false);
  expect(html).not.toContain("npm/marked@");
  expect(html).not.toContain("npm/dompurify@");
  expect(html).not.toContain("@highlightjs/cdn-assets");
  const script = await pageScript();
  expect(script).toContain("highlightElement");     // highlight.js
  expect(script).toContain("sanitize");             // DOMPurify
});

test("review text cannot end a script or stand in for a placeholder", async () => {
  const title = "</script><script>alert(1)</script> __APP__ __STATE__ __SERVED__ __STYLE__";
  const { html } = await build(title, false);
  expect(JSON.parse(scriptOf(html, "review-data")).pr.title).toBe(title);
  expect(JSON.parse(scriptOf(html, "review-boot"))).toEqual({ served: false, state: null });
});

test("a served page has one state slot, and it sits in the boot JSON", async () => {
  const { html, stateSlot } = await build("T", true);
  expect(html.split(stateSlot)).toHaveLength(2);
  const filled = html.replace(stateSlot, JSON.stringify({ f: { decision: "approved" } }));
  expect(JSON.parse(scriptOf(filled, "review-boot"))).toEqual({ served: true, state: { f: { decision: "approved" } } });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test src/build.test.ts`
Expected: FAIL — `pageScript` is not exported (`SyntaxError: Export named 'pageScript' not found`).

- [ ] **Step 3: Add the dependencies**

In `package.json`, replace `"dependencies": { "mermaid": "11.4.1" },` with:

```json
  "dependencies": { "dompurify": "3.2.7", "highlight.js": "11.11.1", "marked": "12.0.2", "mermaid": "11.4.1" },
```

Run: `bun install`
Expected: installs without errors.

- [ ] **Step 4: Bundle and embed the script in `src/build.ts`**

Add below the `escapeHtml` line (after `const escapeHtml = …;`):

```ts
let script: Promise<string> | undefined;
/** The page's script: src/page/app.js and all it imports, bundled for the browser as one IIFE. Built once per
 *  process — a cold build takes milliseconds, so nothing is cached between runs. */
export function pageScript(): Promise<string> {
  return (script ??= bundlePage());
}
async function bundlePage(): Promise<string> {
  const fail = (messages: string[]) => {
    const text = messages.join("; ");
    const hint = /could not resolve/i.test(text) ? `; run \`bun install\` in ${dirname(import.meta.dir)}` : "";
    return new ReviewError(`cannot build the page: ${text}${hint}`);
  };
  let result: Bun.BuildOutput;
  try {
    result = await Bun.build({ entrypoints: [join(import.meta.dir, "page", "app.js")], target: "browser", format: "iife", minify: true });
  } catch (e) {
    throw fail(e instanceof AggregateError ? e.errors.map(String) : [String(e)]);
  }
  if (!result.success) throw fail(result.logs.map(String));
  return result.outputs[0].text();
}
```

In `buildHtml`, change the signature line from

```ts
export async function buildHtml(reviewPath: string, opts: BuildOptions): Promise<{ html: string; review: Review; log: string[] }> {
```

to

```ts
export async function buildHtml(reviewPath: string, opts: BuildOptions): Promise<{ html: string; review: Review; log: string[]; stateSlot: string }> {
```

Replace

```ts
  const [index, style, app] = await Promise.all(
    ["index.html", "style.css", "app.js"].map((name) => Bun.file(join(page, name)).text()),
  );
```

with

```ts
  const [index, style, app] = await Promise.all([
    Bun.file(join(page, "index.html")).text(), Bun.file(join(page, "style.css")).text(), pageScript(),
  ]);
```

Replace the `values` object's `APP: app,` with a base64 value (the comment goes above `const values`):

```ts
  // The script goes in as a base64 data: URL. Nothing in base64 can end the element or hide its end from the
  // HTML parser; escaping in place could not be done safely (the bundle contains `<!--`, some inside /u regexes).
  const values: Record<string, string> = {
    TITLE: escapeHtml(title), MERMAID: mermaidVersion, STYLE: style, SERVED: String(opts.served),
    STATE: stateSlot, REVIEW_JSON: payload, APP: Buffer.from(app).toString("base64"),
  };
```

- [ ] **Step 5: Change `src/page/index.html`**

Delete these three lines:

```html
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3.2.7/dist/purify.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/highlight.min.js"></script>
```

Replace

```html
<script id="review-data" type="application/json">__REVIEW_JSON__</script>
```

with

```html
<script id="review-data" type="application/json">__REVIEW_JSON__</script>
<script id="review-boot" type="application/json">{"served":__SERVED__,"state":__STATE__}</script>
```

Replace the last script block

```html
<script>
const SERVED = __SERVED__;
const INITIAL_STATE = __STATE__;
__APP__
</script>
```

with

```html
<script src="data:text/javascript;base64,__APP__"></script>
```

- [ ] **Step 6: Make `src/page/app.js` a module that brings its libraries**

Replace the first two lines

```js
(() => {
  const data = JSON.parse(document.getElementById('review-data').textContent);
```

with

```js
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

// Whether a server is listening, and the state it saved; `null` state on a static page. See index.html.
const { served: SERVED, state: INITIAL_STATE } = JSON.parse(document.getElementById('review-boot').textContent);

(() => {
  const data = JSON.parse(document.getElementById('review-data').textContent);
```

The libraries are always there now, so the checks for a failed CDN load go:

- In `langOf`: `return window.hljs?.getLanguage(l) ? l : null;` → `return hljs.getLanguage(l) ? l : null;`
- In `renderUnit`: `if (window.hljs?.getLanguage(lang)) hljs.highlightElement(el);` → `if (hljs.getLanguage(lang)) hljs.highlightElement(el);`
- In `lineDiffHtml`: `const known = window.hljs?.getLanguage(lang) ? lang : null;` → `const known = hljs.getLanguage(lang) ? lang : null;`
- `canRender`: `MARKDOWN.test(file.path) && !!file.text && !!window.DOMPurify && !rdFailed.has(file) && !!richModel(file)` → `MARKDOWN.test(file.path) && !!file.text && !rdFailed.has(file) && !!richModel(file)`
- In `mdToggle`, replace

```js
    const why = can ? '' : !window.DOMPurify ? 'The sanitizer did not load, so Markdown shows as source'
      : !file.text ? 'No rendered view: it needs the whole file, which zreview fetches with gh at the head commit'
```

with

```js
    const why = can ? '' : !file.text ? 'No rendered view: it needs the whole file, which zreview fetches with gh at the head commit'
```

Check nothing else reads a library off `window`: `grep -n "window\.\(hljs\|DOMPurify\|marked\)" src/page/app.js` prints nothing.

Monaco's AMD loader is a global the bundler must not mistake for CommonJS: a bare `require(...)` in a bundled
module can be rewritten to the bundler's own `__require` shim. Name the global explicitly. Replace

```js
    require.config({ paths: { vs: `${MONACO}/vs` } });
    require(['vs/editor/editor.main'], () => {
```

with

```js
    window.require.config({ paths: { vs: `${MONACO}/vs` } });
    window.require(['vs/editor/editor.main'], () => {
```

- [ ] **Step 7: Run the tests**

Run: `bun test src`
Expected: 4 pass, 0 fail.

Run: `bun run e2e`
Expected: 1 pass. (It proves the bundled page, the boot JSON and the state slot work in a browser.)

- [ ] **Step 8: Commit**

```bash
git add package.json src/build.ts src/build.test.ts src/page/index.html src/page/app.js
git commit -m "build: bundle the page with Bun; marked, DOMPurify and highlight.js from npm

app.js is an ES module now. build.ts bundles it once per process (a few
ms) and embeds it as a base64 data: script: the bundle contains <!--, and
no in-place escape of it is safe inside a /u regular expression. The
libraries were CDN globals the page probed for; they are always there now.
SERVED and the saved state reach the bundle through #review-boot.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011LxqEm1h22MmzaNxwFkZy1"
```

---

### Task 3: Diffs in a module

**Files:**
- Create: `src/page/lib/diff.ts`, `src/page/lib/diff.test.ts`
- Modify: `src/page/app.js` (delete `lcsOps`, `wordDiff`, `blockOps`; import them)

**Interfaces:**
- Produces (in `src/page/lib/diff.ts`):
  - `export type OpKind = "same" | "del" | "ins"`
  - `export type Op = [OpKind, number, number]` — `[kind, index in a or -1, index in b or -1]`
  - `export function lcsOps<T>(a: readonly T[], b: readonly T[]): Op[]`
  - `export type WordPart = { kind: OpKind; text: string }`
  - `export function wordDiff(before: string, after: string): WordPart[] | null`
  - `export function blockOps(a: readonly string[], b: readonly string[]): Op[] | null`

- [ ] **Step 1: Write the failing test**

Create `src/page/lib/diff.test.ts` (expected values were captured from the original functions):

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test src/page/lib/diff.test.ts`
Expected: FAIL — `Cannot find module './diff.ts'`.

- [ ] **Step 3: Create `src/page/lib/diff.ts`, moving the code verbatim**

```ts
// Alignments the page shows: a sequence of lines, words or blocks against its earlier version.

export type OpKind = "same" | "del" | "ins";
/** One step of an alignment: its kind, the index in `a` (-1 for an insertion), the index in `b` (-1 for a deletion). */
export type Op = [OpKind, number, number];

/** Longest-common-subsequence alignment. Quadratic, so callers bound the input. */
export function lcsOps<T>(a: readonly T[], b: readonly T[]): Op[] {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: Op[] = []; let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) ops.push(["same", i++, j++]);
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(["del", i++, -1]);
    else ops.push(["ins", -1, j++]);
  }
  while (i < m) ops.push(["del", i++, -1]);
  while (j < n) ops.push(["ins", -1, j++]);
  return ops;
}

export type WordPart = { kind: OpKind; text: string };

/** Word-level diff for the prose blocks, so "what changed" shows what changed. Whitespace runs are tokens too,
 *  so either side reassembles exactly. Null past 2400 tokens: too long to diff cheaply, show the text plain. */
export function wordDiff(before: string, after: string): WordPart[] | null {
  const tok = (s: string) => s.split(/(\s+)/).filter((x) => x !== "");
  const a = tok(before), b = tok(after);
  if (a.length + b.length > 2400) return null;
  const out: WordPart[] = [];
  const push = (kind: OpKind, text: string) => { const last = out[out.length - 1]; last && last.kind === kind ? last.text += text : out.push({ kind, text }); };
  for (const [kind, i, j] of lcsOps(a, b)) push(kind, kind === "del" ? a[i] : b[j]);
  return out;
}

/** Blocks of a document against its earlier version. The common head and tail are matched first, so a long
 *  document costs only its changed middle; null when even that is too large to align. */
export function blockOps(a: readonly string[], b: readonly string[]): Op[] | null {
  let s = 0, e = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const midA = a.slice(s, a.length - e), midB = b.slice(s, b.length - e);
  if (midA.length * midB.length > 4e6) return null;
  const ops: Op[] = [];
  for (let k = 0; k < s; k++) ops.push(["same", k, k]);
  for (const [kind, i, j] of lcsOps(midA, midB)) ops.push([kind, i < 0 ? -1 : i + s, j < 0 ? -1 : j + s]);
  for (let k = 0; k < e; k++) ops.push(["same", a.length - e + k, b.length - e + k]);
  return ops;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `bun test src/page/lib/diff.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Use the module in `app.js`**

Add to the imports at the top of `src/page/app.js`, after the `hljs` import:

```js
import { blockOps, lcsOps, wordDiff } from './lib/diff.ts';
```

Delete from `app.js`:
- the whole block starting at the line `  // ---- word-level diff for the prose blocks, so "what changed" shows what changed` through the closing `  }` of `function wordDiff` (the functions `lcsOps` and `wordDiff`);
- the whole `function blockOps(a, b) { … }` (it sits right before `const byLine = …`).

Check: `grep -n "function lcsOps\|function wordDiff\|function blockOps" src/page/app.js` prints nothing.

- [ ] **Step 6: Run everything**

Run: `bun test src && bun run e2e`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/page/lib/diff.ts src/page/lib/diff.test.ts src/page/app.js
git commit -m "refactor: the page's diffs in a tested module

lcsOps, wordDiff and blockOps move verbatim to src/page/lib/diff.ts, with
tests whose expected values come from the functions as they were.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011LxqEm1h22MmzaNxwFkZy1"
```

---

### Task 4: HTML escaping and syntax highlighting in modules

**Files:**
- Create: `src/page/lib/html.ts`, `src/page/lib/html.test.ts`, `src/page/lib/highlight.ts`, `src/page/lib/highlight.test.ts`
- Modify: `src/page/app.js` (delete `esc`, `LANG`, `langOf`, `hlLines`; import them)

**Interfaces:**
- Produces:
  - `src/page/lib/html.ts`: `export const esc: (s: unknown) => string`
  - `src/page/lib/highlight.ts`: `export function langOf(path: string): string | null`, `export function hlLines(text: string, lang: string | null): string[]`

- [ ] **Step 1: Write the failing tests**

Create `src/page/lib/html.test.ts`:

```ts
import { expect, test } from "bun:test";
import { esc } from "./html.ts";

test("esc makes text safe inside an element or a double-quoted attribute", () => {
  expect(esc('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  expect(esc(null)).toBe("");
  expect(esc(undefined)).toBe("");
  expect(esc(0)).toBe("0");
});
```

Create `src/page/lib/highlight.test.ts`:

```ts
import { expect, test } from "bun:test";
import { hlLines, langOf } from "./highlight.ts";

test("langOf maps a path to a language highlight.js knows, or null", () => {
  expect(["src/a.ts", "Makefile", "Dockerfile", "a/b/c.PY", "x.unknownext", "a.yml", "README.md", "x.tsx"].map(langOf))
    .toEqual(["typescript", "makefile", null, "python", null, "yaml", "markdown", "typescript"]);
});

test("hlLines closes and reopens a token that spans lines, so every line stands alone", () => {
  expect(hlLines("/* a\nb */\nconst x = 1", "typescript")).toEqual([
    '<span class="hljs-comment">/* a</span>',
    '<span class="hljs-comment">b */</span>',
    '<span class="hljs-keyword">const</span> x = <span class="hljs-number">1</span>',
  ]);
});

test("hlLines without a language escapes and splits", () => {
  expect(hlLines("<x>\ny", null)).toEqual(["&lt;x&gt;", "y"]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test src/page/lib/html.test.ts src/page/lib/highlight.test.ts`
Expected: FAIL — `Cannot find module './html.ts'` and `'./highlight.ts'`.

- [ ] **Step 3: Create the modules, moving the code verbatim**

Create `src/page/lib/html.ts`:

```ts
/** Text to put in HTML: the characters that could open a tag, start an entity or end a double-quoted attribute. */
export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
```

Create `src/page/lib/highlight.ts`:

```ts
// Syntax highlighting: each side of a hunk is highlighted as one block so multi-line tokens survive, then split
// back into lines.
import hljs from "highlight.js/lib/common";
import { esc } from "./html.ts";

const LANG: Record<string, string> = { ts: "typescript", tsx: "typescript", mts: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", rb: "ruby", rs: "rust", kt: "kotlin", kts: "kotlin", h: "c", cc: "cpp", hpp: "cpp", cs: "csharp", sh: "bash", zsh: "bash",
  yml: "yaml", toml: "ini", md: "markdown", html: "xml", vue: "xml", svelte: "xml", gql: "graphql", dockerfile: "dockerfile", makefile: "makefile" };

export function langOf(path: string): string | null {
  const name = path.split("/").pop()!.toLowerCase(), ext = name.includes(".") ? name.split(".").pop()! : name;
  const l = LANG[ext] ?? ext;
  return hljs.getLanguage(l) ? l : null;
}

export function hlLines(text: string, lang: string | null): string[] {
  let html: string;
  try { html = lang ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value : esc(text); } catch { html = esc(text); }
  const out: string[] = [], open: string[] = []; let cur = "", last = 0, m: RegExpExecArray | null;
  const re = /(<span[^>]*>)|(<\/span>)|\n/g;
  while ((m = re.exec(html))) {
    cur += html.slice(last, m.index); last = re.lastIndex;
    if (m[1]) { open.push(m[1]); cur += m[1]; }
    else if (m[2]) { open.pop(); cur += m[2]; }
    else { out.push(cur + "</span>".repeat(open.length)); cur = open.join(""); }
  }
  out.push(cur + html.slice(last) + "</span>".repeat(open.length));
  return out;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `bun test src/page/lib/html.test.ts src/page/lib/highlight.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Use the modules in `app.js`**

Add to the imports at the top:

```js
import { esc } from './lib/html.ts';
import { hlLines, langOf } from './lib/highlight.ts';
```

Delete from `app.js`:
- the line `  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));`
- the block from `  // Syntax highlighting: each side of a hunk is highlighted as one block so` through the closing `  }` of `function hlLines` (the comment, `const LANG`, `function langOf`, `function hlLines`).

`hljs` stays imported in `app.js`: `renderUnit` and `lineDiffHtml` still call it.

Check: `grep -n "const esc\|const LANG\|function langOf\|function hlLines" src/page/app.js` prints nothing.

- [ ] **Step 6: Run everything**

Run: `bun test src && bun run e2e`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/page/lib/html.ts src/page/lib/html.test.ts src/page/lib/highlight.ts src/page/lib/highlight.test.ts src/page/app.js
git commit -m "refactor: escaping and syntax highlighting in tested modules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011LxqEm1h22MmzaNxwFkZy1"
```

---

### Task 5: Revisions in a module

What the reviewer saw last time, and what moved since. The page's wrappers keep their names and their side
effects (reading a feature's entry creates it, as `entry()` always did); only the pure core moves.

**Files:**
- Create: `src/page/lib/types.ts`, `src/page/lib/revisions.ts`, `src/page/lib/revisions.test.ts`
- Modify: `src/page/app.js`

**Interfaces:**
- Produces (in `src/page/lib/types.ts`):
  - `export type { Entity, Feature, FileRef, Hunk, Review }` (re-exported from `src/build.ts`)
  - `export type Comment` (line | file | text), `export type FileShot = { h: string | null; lines: string[] | null }`
  - `export type Seen = { at: number; head: string; text?: { scenario: string; description: string; tested: string }; entities?: Record<string, string>; diagrams?: string; files?: Record<string, FileShot> }`
  - `export type Entry = { decision?: "approved" | "changes"; note?: string; at?: number; head?: string; seen?: Seen; viewed?: Record<string, string | null>; comments?: Comment[] }`
  - `export type State = Record<string, Entry>`
  - `export const filesOf: (f: Feature) => FileRef[]`
- Produces (in `src/page/lib/revisions.ts`):
  - `LINE_CAP = 4000`, `hashStr(s: string): string`, `fhash(file: FileRef): string | null`, `flatLines(file: FileRef): string[] | null`, `fileShot(file: FileRef): FileShot`, `textOf(f: Feature)`, `entityShots(f: Feature): Record<string, string>`
  - `snapshot(f: Feature, head: string, at?: number): Seen`
  - `isViewedIn(entry: Entry | undefined, file: FileRef): boolean`
  - `countViewed(f: Feature, entry: Entry | undefined): { seen: number; total: number }`
  - `type Fresh = boolean[] & { gone?: number }`, `freshLines(now: string[] | null, before: string[] | null | undefined): Fresh | null`
  - `type Since`, `sinceSeen(f: Feature, s: Seen | undefined): Since`

- [ ] **Step 1: Write the failing test**

Create `src/page/lib/revisions.test.ts`. The hashes and shapes were captured from the original functions; the
fixtures must keep their key order (`header` before `lines`, `t` before `text`; `name`, `change`, `summary`),
because the hashes are over `JSON.stringify`.

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test src/page/lib/revisions.test.ts`
Expected: FAIL — `Cannot find module './revisions.ts'`.

- [ ] **Step 3: Create `src/page/lib/types.ts`**

```ts
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
```

- [ ] **Step 4: Create `src/page/lib/revisions.ts`, moving the code verbatim**

```ts
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
```

- [ ] **Step 5: Run it to see it pass**

Run: `bun test src/page/lib/revisions.test.ts`
Expected: 9 pass.

- [ ] **Step 6: Use the module in `app.js`**

Add to the imports at the top (outside the moved code, `app.js` uses only `fhash` and `fileShot`, in `toggleViewed`):

```js
import { fhash, fileShot, isViewedIn, sinceSeen, snapshot } from './lib/revisions.ts';
```

Delete the seven lines from `  const LINE_CAP = 4000;` through `  const entityShots = (f) => …;`, and replace the
five-line `  const shot = (f) => ({ … });` with:

```js
  const shot = (f) => snapshot(f, data.pr.head || 'plan');
```

Replace the `isViewed` line

```js
  const isViewed = (f, file) => { const v = entry(f.id).viewed ||= {}; return file.path in v && v[file.path] === fhash(file); };
```

with

```js
  // Reading a feature's entry creates it, and the viewed map in it, as it always has: both reach the saved state.
  const isViewed = (f, file) => { entry(f.id).viewed ||= {}; return isViewedIn(state[f.id], file); };
```

Keep `seenOf`, `viewedCount` and `toggleViewed` as they are, and the four comment lines above (`// ---- revisions: …`).

Delete `function freshLines(now, before) { … }` with its `/** Lines of `now` … */` comment line, and replace
`function since(f) { … }` with its `/** Everything that moved … */` comment line by:

```js
  const since = (f) => sinceSeen(f, seenOf(f));
```

Check: `grep -n "hashStr\|flatLines\|textOf\|entityShots\|freshLines\|LINE_CAP" src/page/app.js` prints nothing.

- [ ] **Step 7: Run everything**

Run: `bun test src && bun run e2e`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/page/lib/types.ts src/page/lib/revisions.ts src/page/lib/revisions.test.ts src/page/app.js
git commit -m "refactor: revisions in a tested module

The snapshot, the fresh-line count and what moved since the reviewer's
last look move to src/page/lib/revisions.ts as pure functions. The page's
wrappers keep their names and still create a feature's entry on read, so
the saved state is what it was.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011LxqEm1h22MmzaNxwFkZy1"
```

---

### Task 6: The Markdown block model in a module

**Files:**
- Create: `src/page/lib/markdown.ts`, `src/page/lib/markdown.test.ts`
- Modify: `src/page/app.js`

**Interfaces:**
- Consumes: `blockOps`, `Op` from `./diff.ts`; `FileRef` from `./types.ts`.
- Produces (in `src/page/lib/markdown.ts`):
  - `export const MARKDOWN: RegExp` (`/\.(md|markdown|mdx)$/i`)
  - `export type Unit = { type: string; raw: string; key: string; ref: string; dir: string; from: number; to: number; token?: Token; list?: Tokens.List; item?: Tokens.ListItem; html?: string; text?: string }`
  - `export type Row = { kind: "same" | "del" | "add" | "mod"; old?: Unit; new?: Unit; html?: string }`
  - `export function mdUnits(source: string, ref: string, dir: string): Unit[]`
  - `export const byLine: (u: Unit) => boolean`, `export const linesOf: (u: Unit) => string[]`
  - `export function likeness(o: Unit, n: Unit, unitText: (u: Unit) => string): number`
  - `export function pairUp(ops: Op[], a: Unit[], b: Unit[], unitText: (u: Unit) => string): Row[]`
  - `export function markdownRows(file: FileRef, base: string, head: string, unitText: (u: Unit) => string): Row[] | null` — `file.text` must be set.

`unitText` is passed in because rendering a block to text needs the DOM (DOMPurify); the page passes its own.

- [ ] **Step 1: Write the failing test**

Create `src/page/lib/markdown.test.ts` (expected values captured from the original functions, with `unitText = u => u.raw`):

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test src/page/lib/markdown.test.ts`
Expected: FAIL — `Cannot find module './markdown.ts'`.

- [ ] **Step 3: Create `src/page/lib/markdown.ts`, moving the code verbatim**

```ts
// The block model behind the rendered view of a changed Markdown file: both versions cut into blocks (a list
// item is a block), aligned, and each removed block paired with the added one it most resembles.
import { marked, type Token, type Tokens } from "marked";
import { blockOps, type Op } from "./diff.ts";
import type { FileRef } from "./types.ts";

export const MARKDOWN = /\.(md|markdown|mdx)$/i;

export type Unit = {
  type: string; raw: string; key: string;
  /** The commit and directory the block's relative links resolve against. */
  ref: string; dir: string;
  from: number; to: number;
  token?: Token; list?: Tokens.List; item?: Tokens.ListItem;
  /** Filled in by the page the first time the block is rendered. */
  html?: string; text?: string;
};
export type Row = { kind: "same" | "del" | "add" | "mod"; old?: Unit; new?: Unit; html?: string };

export function mdUnits(source: string, ref: string, dir: string): Unit[] {
  const text = source.replace(/\r\n?/g, "\n").replace(/^( *)(\t+)/gm, (_, s: string, t: string) => s + "    ".repeat(t.length));
  const units: Unit[] = [];
  let cursor = 0, pos = 0, line = 1;
  const lineAt = (at: number) => { for (; pos < at; pos++) if (text.charCodeAt(pos) === 10) line++; return line; };
  const span = (raw: string) => {
    const at = Math.max(text.indexOf(raw, cursor), cursor);
    cursor = at + raw.length;
    return { from: lineAt(at), to: lineAt(at + Math.max(raw.trimEnd().length - 1, 0)) };
  };
  const unit = (type: string, raw: string, key: string, extra?: Partial<Unit>) => units.push({ type, raw, key, ref, dir, ...extra, ...span(raw) });
  const front = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(text);
  if (front) unit("front", front[0], "front\n" + front[0].trim());
  for (const t of marked.lexer(text.slice(cursor))) {
    if (t.type === "space") { span(t.raw); continue; }
    if (t.type !== "list") { unit(t.type, t.raw, `${t.type}${(t as Tokens.Heading).depth ?? ""}\n${t.raw.trim()}`, { token: t }); continue; }
    const list = t as Tokens.List;
    const at = Math.max(text.indexOf(list.raw, cursor), cursor);
    cursor = at;
    for (const item of list.items) unit("item", item.raw, `item${list.ordered ? 1 : ""}\n${item.raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim()}`, { list, item });
    cursor = Math.max(cursor, at + list.raw.length);
  }
  // marked keeps some source out of every token: a link reference definition (`[docs]: https://…`) sets
  // the target of every `[docs]` without a block of its own. A change there would not show in the rendered
  // view at all, so each run of non-blank lines that no block covers becomes a block of its own.
  const lines = text.split("\n"), covered = new Uint8Array(lines.length + 2), loose: Unit[] = [];
  for (const u of units) for (let n = u.from; n <= u.to; n++) covered[n] = 1;
  for (let n = 1; n <= lines.length; n++) {
    if (covered[n] || !lines[n - 1].trim()) continue;
    let m = n;
    while (m < lines.length && !covered[m + 1] && lines[m].trim()) m++;
    const raw = lines.slice(n - 1, m).join("\n");
    loose.push({ type: "raw", raw, key: `raw\n${raw.trim()}`, ref, dir, from: n, to: m });
    n = m;
  }
  return loose.length ? [...units, ...loose].sort((x, y) => x.from - y.from) : units;
}

export const byLine = (u: Unit) => u.type === "front" || u.type === "raw" || u.type === "code";
export const linesOf = (u: Unit) => (u.type === "code" ? (u.token as Tokens.Code).text : u.raw.trim()).split("\n");

// How much two blocks share: the pieces both contain, weighted by length, over the larger block. Pairing
// asks this of every removed and added block in a changed stretch, so it counts instead of aligning:
// linear in the blocks' size, where a word-level LCS per pair could freeze the tab on a long rewrite.
function overlap(a: string[], b: string[]) {
  const left = new Map<string, number>(); let sizeA = 0, sizeB = 0, same = 0;
  for (const t of a) { left.set(t, (left.get(t) || 0) + 1); sizeA += t.length; }
  for (const t of b) { sizeB += t.length; const k = left.get(t); if (k) { left.set(t, k - 1); same += t.length; } }
  return same / Math.max(sizeA, sizeB, 1);
}

export function likeness(o: Unit, n: Unit, unitText: (u: Unit) => string): number {
  const depth = (u: Unit) => (u.token as Tokens.Heading | undefined)?.depth;
  if (o.type !== n.type || depth(o) !== depth(n) || (o.type === "item" && o.list!.ordered !== n.list!.ordered)) return 0;
  if (o.type === "table") {
    const a = o.token as Tokens.Table, b = n.token as Tokens.Table;
    if (a.header.length !== b.header.length || a.rows.length !== b.rows.length) return 0;
  }
  if (byLine(o)) {
    const a = linesOf(o), b = linesOf(n);
    return a.join("\n") === b.join("\n") ? 0 : overlap(a, b);
  }
  // Adjacent word pairs, not words: two unrelated paragraphs share most of their small words, but few
  // of their word pairs, so a rewrite still reads as removed then added.
  const a = unitText(o), b = unitText(n);
  const pairs = (t: string) => { const w = t.split(/\s+/).filter(Boolean); return w.length < 2 ? w : w.slice(1).map((x, i) => `${w[i]} ${x}`); };
  return a === b ? 0 : overlap(pairs(a), pairs(b));
}

export function pairUp(ops: Op[], a: Unit[], b: Unit[], unitText: (u: Unit) => string): Row[] {
  const out: Row[] = [];
  for (let k = 0; k < ops.length;) {
    if (ops[k][0] === "same") { out.push({ kind: "same", old: a[ops[k][1]], new: b[ops[k][2]] }); k++; continue; }
    const gone: Unit[] = [], come: Unit[] = [];
    for (; k < ops.length && ops[k][0] !== "same"; k++) ops[k][0] === "del" ? gone.push(a[ops[k][1]]) : come.push(b[ops[k][2]]);
    let next = 0;
    for (const o of gone) {
      let best = -1, score = 0.5;
      if (gone.length * come.length <= 400) for (let y = next; y < come.length; y++) { const s = likeness(o, come[y], unitText); if (s > score) { best = y; score = s; } }
      if (best < 0) { out.push({ kind: "del", old: o }); continue; }
      for (; next < best; next++) out.push({ kind: "add", new: come[next] });
      out.push({ kind: "mod", old: o, new: come[next++] });
    }
    for (; next < come.length; next++) out.push({ kind: "add", new: come[next] });
  }
  return out;
}

/** The rows of a changed Markdown file's rendered view, or null when the two versions are too large to align. */
export function markdownRows(file: FileRef, base: string, head: string, unitText: (u: Unit) => string): Row[] | null {
  const dir = file.path.slice(0, file.path.lastIndexOf("/") + 1);
  const a = mdUnits(file.text!.before, base, dir), b = mdUnits(file.text!.after, head, dir);
  const ops = blockOps(a.map((u) => u.key), b.map((u) => u.key));
  return ops ? pairUp(ops, a, b, unitText) : null;
}
```

Note the one intended difference from the original `likeness`: `o.token?.depth !== n.token?.depth` compared two
`undefined`s for every non-heading token; `depth(o) !== depth(n)` does the same.

- [ ] **Step 4: Run it to see it pass**

Run: `bun test src/page/lib/markdown.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Use the module in `app.js`**

Add to the imports at the top:

```js
import { byLine, linesOf, markdownRows, MARKDOWN } from './lib/markdown.ts';
```

Delete from `app.js`:
- the line `  const MARKDOWN = /\.(md|markdown|mdx)$/i;`
- the whole `function mdUnits(source, ref, dir) { … }` (including its trailing `// marked keeps some source…` comment inside it);
- `const byLine = …`, `const linesOf = …`, the three comment lines above `function overlap`, `function overlap`, `function likeness`, `function pairUp`.

Replace the body of `richModel`:

```js
  function richModel(file) {
    if (richCache.has(file)) return richCache.get(file);
    let model = null;
    try {
      const dir = file.path.slice(0, file.path.lastIndexOf('/') + 1);
      const a = mdUnits(file.text.before, data.pr.base, dir), b = mdUnits(file.text.after, data.pr.head, dir);
      const ops = blockOps(a.map(u => u.key), b.map(u => u.key));
      if (ops) model = pairUp(ops, a, b);
    } catch (e) { console.error(`zreview: could not render ${file.path}`, e); }
    richCache.set(file, model);
    return model;
  }
```

with

```js
  function richModel(file) {
    if (richCache.has(file)) return richCache.get(file);
    let model = null;
    try { model = markdownRows(file, data.pr.base, data.pr.head, unitText); }
    catch (e) { console.error(`zreview: could not render ${file.path}`, e); }
    richCache.set(file, model);
    return model;
  }
```

`richModel` was the page's only caller of `blockOps`, so change the diff import to
`import { lcsOps, wordDiff } from './lib/diff.ts';` (`lineDiffHtml` uses `lcsOps`, `markWords` uses `wordDiff`).
Check: `grep -n "blockOps\|function mdUnits\|function pairUp\|function likeness\|const MARKDOWN" src/page/app.js` prints nothing.

- [ ] **Step 6: Run everything**

Run: `bun test src && bun run e2e`
Expected: all pass. The e2e opens `docs/flatten.md` in its rendered view, which runs `markdownRows` in the browser.

- [ ] **Step 7: Commit**

```bash
git add src/page/lib/markdown.ts src/page/lib/markdown.test.ts src/page/app.js
git commit -m "refactor: the Markdown block model in a tested module

mdUnits, the pairing and markdownRows move to src/page/lib/markdown.ts.
Rendering a block stays in the page, which hands its unitText in.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011LxqEm1h22MmzaNxwFkZy1"
```

---

### Task 7: Reading order and the summary in modules

**Files:**
- Create: `src/page/lib/reading.ts`, `src/page/lib/reading.test.ts`, `src/page/lib/summary.ts`, `src/page/lib/summary.test.ts`
- Modify: `src/page/app.js`

**Interfaces:**
- Produces:
  - `src/page/lib/reading.ts`: `export const ORDER: readonly (readonly [string, string])[]`, `export function groupOf(f: Feature, path: string): string`, `export function reading(f: Feature): { groups: { key: string; label: string; files: FileRef[] }[]; flat: FileRef[] }`
  - `src/page/lib/summary.ts`: `export function summary(review: Review, state: State): string`

- [ ] **Step 1: Write the failing tests**

Create `src/page/lib/reading.test.ts`:

```ts
import { expect, test } from "bun:test";
import { groupOf, reading } from "./reading.ts";
import type { Feature } from "./types.ts";

const paths = ["src/ui/button.tsx", "src/core/engine.ts", "src/foo.test.ts", "src/x/thing.ts", "bun.lock",
  "src/db/repo.ts", "src/api/routes.ts", "src/user.model.ts", "src/models/user.ts"];
const f: Feature = {
  id: "f", title: "F", scenario: "", description: "",
  entities: [{ name: "Thing", change: "added", summary: "", file: "src/x/thing.ts" }],
  files: paths.map((path) => ({ path, url: "" })),
};

test("groupOf sorts a path into what a reviewer should meet first", () => {
  expect(paths.map((p) => groupOf(f, p))).toEqual(["ui", "logic", "test", "domain", "config", "data", "edge", "domain", "logic"]);
});

test("reading groups in that order and flattens for the arrows", () => {
  const { groups, flat } = reading(f);
  expect(groups.map((g) => [g.key, g.label, g.files.map((x) => x.path)])).toEqual([
    ["domain", "Domain types", ["src/x/thing.ts", "src/user.model.ts"]],
    ["data", "Persistence", ["src/db/repo.ts"]],
    ["logic", "Logic", ["src/core/engine.ts", "src/models/user.ts"]],
    ["edge", "Interfaces", ["src/api/routes.ts"]],
    ["ui", "Surface", ["src/ui/button.tsx"]],
    ["test", "Tests", ["src/foo.test.ts"]],
    ["config", "Config and generated", ["bun.lock"]],
  ]);
  expect(flat.map((x) => x.path)).toEqual(groups.flatMap((g) => g.files.map((x) => x.path)));
});
```

Create `src/page/lib/summary.test.ts` (expected text captured from the original function):

```ts
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test src/page/lib/reading.test.ts src/page/lib/summary.test.ts`
Expected: FAIL — `Cannot find module './reading.ts'` and `'./summary.ts'`.

- [ ] **Step 3: Create the modules, moving the code verbatim**

Create `src/page/lib/reading.ts`:

```ts
// Reading order: what a reviewer should meet first. The domain types a feature declares come first (they name
// everything downstream), then what stores them, then the logic, the edges it is reached through, the surface,
// and last the tests and generated files that only confirm the rest.
import { filesOf, type Feature, type FileRef } from "./types.ts";

export const ORDER = [
  ["domain", "Domain types"], ["data", "Persistence"], ["logic", "Logic"],
  ["edge", "Interfaces"], ["ui", "Surface"], ["test", "Tests"], ["config", "Config and generated"],
] as const;

const entityFiles = (f: Feature) => new Set((f.entities || []).map((e) => e.file).filter(Boolean));

export function groupOf(f: Feature, path: string): string {
  if (/(^|[\/._-])(tests?|specs?|__tests__|__mocks__|fixtures?|snapshots?)([\/._-]|$)/i.test(path)) return "test";
  if (/(^|\/)(package-lock|bun\.lock|yarn\.lock|pnpm-lock|go\.sum|cargo\.lock)|\.(lock|ya?ml|toml|ini|cfg|env)$|(^|\/)(dockerfile|makefile)/i.test(path)) return "config";
  if (entityFiles(f).has(path)) return "domain";
  if (/(^|[\/._-])(entit|model|schema|domain|dto|types?)([\/._-]|$)/i.test(path)) return "domain";
  if (/(^|[\/._-])(repositor|store|dao|database|db|migrations?|quer|sql|prisma|persist)/i.test(path)) return "data";
  if (/(^|[\/._-])(route|router|api|endpoint|controller|cli|command|serve|server|middleware)/i.test(path)) return "edge";
  if (/\.(css|scss|sass|less|html|svg|vue|svelte)$|(^|[\/._-])(component|view|page|screen|style|ui)/i.test(path)) return "ui";
  return "logic";
}

/** The feature's files, grouped and flattened into the order the rail and the arrows follow. */
export function reading(f: Feature): { groups: { key: string; label: string; files: FileRef[] }[]; flat: FileRef[] } {
  const files = filesOf(f);
  const groups = ORDER.map(([key, label]) => ({ key, label, files: files.filter((x) => groupOf(f, x.path) === key) as FileRef[] })).filter((g) => g.files.length);
  return { groups, flat: groups.flatMap((g) => g.files) };
}
```

Create `src/page/lib/summary.ts`:

```ts
// The review as Markdown: what Copy puts on the clipboard and what Submit hands back on stdout.
import type { Review, State } from "./types.ts";

export function summary(review: Review, state: State): string {
  const pr = review.pr;
  const lines = [review.plan ? `## Plan review of ${pr.repo} — ${pr.title}` : `## Review of ${pr.repo}#${pr.number} at \`${pr.head}\``, ""];
  review.features.forEach((f, i) => {
    const s = state[f.id] || {};
    const mark = s.decision === "approved" ? "✅ Approved" : s.decision === "changes" ? "❌ Changes requested" : "⬜ Not reviewed";
    lines.push(`${i + 1}. **${f.title}** — ${mark}`);
    if (s.note) lines.push(`   > ${s.note.replace(/\n/g, "\n   > ")}`);
    for (const c of s.comments || []) {
      lines.push(c.kind === "line" ? `   - \`${c.file}:${c.line}\` — ${c.body}`
        : c.kind === "file" ? `   - \`${c.file}\` — ${c.body}`
        : `   - "${c.quote.length > 80 ? c.quote.slice(0, 77) + "…" : c.quote}" — ${c.body}`);
    }
  });
  return lines.join("\n");
}
```

`review.plan` stands where `PLAN` did: the page sets `PLAN = !!data.plan`, the same flag.

- [ ] **Step 4: Run them to see them pass**

Run: `bun test src/page/lib/reading.test.ts src/page/lib/summary.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Use the modules in `app.js`**

Add to the imports at the top:

```js
import { reading } from './lib/reading.ts';
import { summary as summaryOf } from './lib/summary.ts';
```

Delete from `app.js` the block from `  // ---- reading order: what a reviewer should meet first.` through the closing `  }` of
`function reading(f)` (the comment, `ORDER`, `entityFiles`, `groupOf`, `reading`).

Replace the whole `function summary() { … }` (keep the `// ---- output` line above it) with:

```js
  const summary = () => summaryOf(data, state);
```

Check: `grep -n "const ORDER\|function groupOf\|function reading\|function summary" src/page/app.js` prints nothing.

- [ ] **Step 6: Run everything**

Run: `bun test src && bun run e2e`
Expected: all pass. (The e2e checks the summary text on stdout.)

- [ ] **Step 7: Commit**

```bash
git add src/page/lib/reading.ts src/page/lib/reading.test.ts src/page/lib/summary.ts src/page/lib/summary.test.ts src/page/app.js
git commit -m "refactor: reading order and the review summary in tested modules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011LxqEm1h22MmzaNxwFkZy1"
```

---

### Task 8: Docs, a last look, and PR A

**Files:**
- Modify: `README.md` (Layout section), `install.sh` (the install message)

- [ ] **Step 1: README layout and a Develop section**

In `README.md`, replace the Layout block and the line after it:

````markdown
```
src/cli.ts        the contract: flags, stdout, exit codes
src/serve.ts      localhost server; resolves on Submit or tab close
src/build.ts      review.json → HTML; diff parsing; screenshot inlining
src/diagrams.ts   parses each diagram with the Mermaid the page renders it with
src/page/         index.html, style.css, app.js — inlined into one file at build
skill/SKILL.md    the agent skill; install.sh links it into ~/.claude/skills
```

Bun, plus one dependency: Mermaid, to check the diagrams. MIT.
````

with

````markdown
```
src/cli.ts        the contract: flags, stdout, exit codes
src/serve.ts      localhost server; resolves on Submit or tab close
src/build.ts      review.json → HTML; diff parsing; screenshot inlining; bundles the page
src/diagrams.ts   parses each diagram with the Mermaid the page renders it with
src/page/         index.html and style.css; app.js, bundled by Bun into the one page
src/page/lib/     what the page computes without a DOM: diffs, revisions, the Markdown
                  block model, reading order, the summary — each with its tests
test/e2e/         one reviewer session driven in Chrome against a real run
skill/SKILL.md    the agent skill; install.sh links it into ~/.claude/skills
```

Bun, plus Mermaid (to check the diagrams) and the page's libraries: marked,
DOMPurify, highlight.js. MIT.

## Develop

```bash
bun install
bun test src      # unit tests, offline, a second
bun run e2e       # a real review in Chrome: needs Google Chrome and the network (Mermaid, Monaco from the CDN)
```

The page is bundled on every run — a few milliseconds — so an edit under
`src/page/` shows on the next `zreview review` or `zreview build`.
````

- [ ] **Step 2: install.sh message**

In `install.sh`, replace

```bash
(cd "$SRC" && bun install >/dev/null) && echo "installed: mermaid, to check the diagrams"
```

with

```bash
(cd "$SRC" && bun install >/dev/null) && echo "installed: mermaid (checks the diagrams) and the page's libraries"
```

- [ ] **Step 3: A last look at app.js**

Run: `grep -n "window\.\(hljs\|DOMPurify\|marked\)\|function \(lcsOps\|wordDiff\|blockOps\|mdUnits\|pairUp\|likeness\|freshLines\|groupOf\|reading\|summary\|langOf\|hlLines\)" src/page/app.js`
Expected: no output.

Run: `head -20 src/page/app.js` and check every imported name is used: for each name in the import lines,
`grep -c "\bNAME\b" src/page/app.js` is at least 2 (the import and a use). Remove any that is 1.

- [ ] **Step 4: Full verification**

Run: `bun test src`
Expected: all pass (build 4, diff 5, html 1, highlight 3, revisions 9, markdown 5, reading 2, summary 2 = 31).

Run: `bun run e2e`
Expected: 1 pass.

Then compare the page before and after, as a reviewer would see it. Build the fixture with this branch and with
`main` (the main checkout at `/Users/gzaripov/code/zreview` is on `main`; running its CLI only reads it):

```bash
bun run src/cli.ts build test/e2e/fixture/review.json --diff test/e2e/fixture/review.diff -o /tmp/zreview-after.html
bun run /Users/gzaripov/code/zreview/src/cli.ts build test/e2e/fixture/review.json --diff test/e2e/fixture/review.diff -o /tmp/zreview-before.html
```

Screenshot both with this script, saved as `/tmp/zreview-shots.ts` (not committed):

```ts
import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "chrome" });
for (const name of ["before", "after"]) {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme as "light" | "dark" });
    await page.goto(`file:///tmp/zreview-${name}.html`);
    await page.locator("figure svg").first().waitFor();
    await page.locator(".monaco-editor").first().waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `/tmp/zreview-${name}-${theme}.png` });
    await page.close();
  }
}
await browser.close();
```

Run: `bun run /tmp/zreview-shots.ts` (from the worktree, so `playwright-core` resolves — copy the script into the
worktree as `shots.tmp.ts` if Bun cannot resolve the import from `/tmp`, and delete it after).
Expected: four PNGs. Report their paths; the controller compares before and after — they must look the same.

- [ ] **Step 5: Commit**

```bash
git add README.md install.sh
git commit -m "docs: the page is bundled; how to run the tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011LxqEm1h22MmzaNxwFkZy1"
```

- [ ] **Step 6: Open PR A**

Check first (the owner merges quickly, and parallel sessions open overlapping PRs):
`gh pr list --repo gzaripov/zreview --state open` and `git fetch origin && git log --oneline HEAD..origin/main`.
If `origin/main` moved, rebase onto it and re-run Step 4. If an open PR touches `src/page/` or `src/build.ts`, stop and report.

Then push and open the PR with the writing-pull-requests skill. No screenshots needed beyond one "unchanged" shot:
the PR states the page does not change visibly.
