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
