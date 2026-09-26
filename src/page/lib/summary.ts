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
