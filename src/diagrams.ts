import { dirname } from "node:path";
import pkg from "../package.json";

export const mermaidVersion: string = pkg.dependencies.mermaid;

type Parse = (source: string) => Promise<unknown>;
let parser: Promise<Parse> | undefined;

function loadParser(): Promise<Parse> {
  parser ??= (async () => {
    const fix = `run \`bun install\` in ${dirname(import.meta.dir)}`;
    // The pin is both the version checked here and the one the page loads from the CDN, so it has to be
    // one version: "^11.4.1" would never equal what is installed, and the CDN would pick its own 11.x.
    if (!/^\d+\.\d+\.\d+$/.test(mermaidVersion)) throw new Error(`package.json must pin mermaid to one exact version, not "${mermaidVersion}"`);
    const found = await import("mermaid/package.json").then(
      (m) => m.default.version as string,
      (e: Error) => { throw new Error(`Mermaid is not installed (${e.message}); ${fix}`); },
    );
    if (found !== mermaidVersion) throw new Error(`found Mermaid ${found}, but the page renders with ${mermaidVersion}; ${fix}`);
    Bun.plugin({
      name: "dompurify-without-a-dom",
      setup(build) {
        build.module("dompurify", () => ({
          loader: "object",
          exports: { default: { sanitize: (text: string) => text, addHook() {} } },
        }));
      },
    });
    const { default: mermaid } = await import("mermaid");
    return (source) => mermaid.parse(source);
  })();
  return parser;
}

const consoleMethods = ["log", "info", "warn", "error", "debug", "trace"] as const;

async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const saved = consoleMethods.map((name) => console[name]);
  for (const name of consoleMethods) console[name] = () => {};
  try {
    return await run();
  } finally {
    consoleMethods.forEach((name, i) => (console[name] = saved[i]));
  }
}

// The CLI loads the review, then buildHtml loads it again; each diagram is still parsed once.
const checked = new Map<string, Promise<string | null>>();

export function diagramError(source: string): Promise<string | null> {
  let result = checked.get(source);
  if (!result) checked.set(source, (result = parseError(source)));
  return result;
}

function parseError(source: string): Promise<string | null> {
  return quietly(async () => {
    const parse = await loadParser();
    return parse(source).then(
      () => null,
      (e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        return e instanceof Error && e.name === "UnknownDiagramError" ? message.split("\n")[0] : message;
      },
    );
  });
}
