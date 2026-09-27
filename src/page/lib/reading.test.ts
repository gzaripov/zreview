import { expect, test } from "bun:test";
import { groupOf, reading } from "./reading.ts";
import type { Feature } from "./types.ts";

const paths = ["src/ui/button.tsx", "src/core/engine.ts", "src/foo.test.ts", "src/x/thing.ts", "bun.lock",
  "src/db/repo.ts", "src/api/routes.ts", "src/user.model.ts", "src/models/user.ts"];
const f: Feature = {
  id: "f", title: "F", scenario: "", description: "",
  entities: [{ name: "Thing", change: "added", summary: "", file: "src/x/thing.ts" }],
  files: paths.map((path) => ({ path, url: "" })),
};

test("groupOf sorts a path into what a reviewer should meet first", () => {
  expect(paths.map((p) => groupOf(f, p))).toEqual(["ui", "logic", "test", "domain", "config", "data", "edge", "domain", "logic"]);
});

test("reading groups in that order and flattens for the arrows", () => {
  const { groups, flat } = reading(f);
  expect(groups.map((g) => [g.key, g.label, g.files.map((x) => x.path)])).toEqual([
    ["domain", "Domain types", ["src/x/thing.ts", "src/user.model.ts"]],
    ["data", "Persistence", ["src/db/repo.ts"]],
    ["logic", "Logic", ["src/core/engine.ts", "src/models/user.ts"]],
    ["edge", "Interfaces", ["src/api/routes.ts"]],
    ["ui", "Surface", ["src/ui/button.tsx"]],
    ["test", "Tests", ["src/foo.test.ts"]],
    ["config", "Config and generated", ["bun.lock"]],
  ]);
  expect(flat.map((x) => x.path)).toEqual(groups.flatMap((g) => g.files.map((x) => x.path)));
});
