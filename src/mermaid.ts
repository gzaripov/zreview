// Validate every diagram with mermaid's own parser before a page is built, so
// an agent that wrote a bad diagram gets an exit 2 naming it instead of the
// reviewer meeting the bomb icon. Mermaid needs a window even to parse (it
// runs DOMPurify over labels), so a happy-dom window is registered for the
// duration of the check and removed after. The version is pinned to the one
// the page loads from the CDN, so what parses here renders there.

import { ReviewError, type Review } from "./build.ts";

export async function validateDiagrams(review: Review, path: string): Promise<void> {
  const all = (review.features ?? []).flatMap((f) => (f.diagrams ?? []).map((d, i) => ({ f, d, i })));
  if (!all.length) return;
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  GlobalRegistrator.register();
  try {
    const mermaid = (await import("mermaid")).default;
    const errors: string[] = [];
    for (const { f, d, i } of all) {
      if (typeof d?.mermaid !== "string" || !d.mermaid.trim()) { errors.push(`feature ${f.id} diagram ${i + 1}: mermaid text is missing`); continue; }
      try { await mermaid.parse(d.mermaid); }
      catch (e) {
        const msg = String((e as Error).message ?? e).split("\n").filter(Boolean).slice(0, 3).join(" ");
        errors.push(`feature ${f.id} diagram ${i + 1}${d.title ? ` (${d.title})` : ""}: ${msg}`);
      }
    }
    if (errors.length) throw new ReviewError(`${path}: ${errors.length} diagram${errors.length === 1 ? "" : "s"} would not render:\n  ${errors.join("\n  ")}`);
  } finally {
    await GlobalRegistrator.unregister();
  }
}
