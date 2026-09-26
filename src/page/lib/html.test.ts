import { expect, test } from "bun:test";
import { esc } from "./html.ts";

test("esc makes text safe inside an element or a double-quoted attribute", () => {
  expect(esc('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  expect(esc(null)).toBe("");
  expect(esc(undefined)).toBe("");
  expect(esc(0)).toBe("0");
});
