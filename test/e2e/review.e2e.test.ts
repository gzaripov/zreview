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

/** Select `needle` in the page's main column and let go of the mouse, as a reviewer quoting prose does.
 *  Scrolls the text into view first: a reviewer can only drag-select what is already on screen, and the
 *  page positions the floating "Comment" button from the selection's viewport rect plus the scroll offset
 *  read back when that button is clicked — selecting off-screen text would leave those two reads of the
 *  scroll position apart and place the composer off-page. */
async function selectText(page: Page, needle: string) {
  await page.evaluate((needle) => {
    const root = document.querySelector("main") ?? document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const at = n.data.indexOf(needle);
      if (at < 0) continue;
      n.parentElement!.scrollIntoView({ block: "center" });
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

// Opt-in: needs Chrome and the network and takes ~10 s, so a bare `bun test` must not pick it up.
test.skipIf(!process.env.ZREVIEW_E2E)("a review from the first look to Submit", async () => {
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
