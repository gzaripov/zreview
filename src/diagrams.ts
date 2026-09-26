import { dirname } from "node:path";
import pkg from "../package.json";

export const mermaidVersion: string = pkg.dependencies.mermaid;

type Parse = (source: string) => Promise<unknown>;
let parser: Promise<Parse> | undefined;

function loadParser(): Promise<Parse> {
  parser ??= (async () => {
    const fix = `run \`bun install\` in ${dirname(import.meta.dir)}`;
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

export function diagramError(source: string): Promise<string | null> {
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
