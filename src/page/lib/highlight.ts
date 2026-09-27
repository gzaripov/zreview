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
