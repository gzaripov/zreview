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
