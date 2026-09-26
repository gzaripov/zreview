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
