import { describe, expect, test } from "bun:test";
import { GROUP_KEYS, groupOf, isGroup } from "./groups.ts";

const cases: [string, string][] = [
  ["workers/runtime/activities/training/pipelines/VENDOR.md", "docs"],
  ["workers/runtime/activities/BUILD.bazel", "config"],
  ["workers/runtime/activities/batch/__init__.py", "logic"],
  ["workers/runtime/activities/tests/test_publish.py", "tests"],
  ["workers/runtime/activities/batch/job/batch_job.yaml.tmpl", "config"],
  ["docs/tutorial/first-trained-model.mdx", "docs"],
  ["packages/sdk/docs/cli.md", "docs"],
  ["packages/sdk/skills/build/references/workflow-and-cli.md", "docs"],
  ["packages/sdk/skills/compress/SKILL.md", "docs"],
  ["docs/adr/0012-slices.md", "docs"],
  ["README", "docs"],
  ["LICENSE", "docs"],
  ["CHANGELOG.md", "docs"],
  ["notes/plan.txt", "docs"],
  ["packages/sdk/skills/catalog.json", "config"],
  ["packages/sdk/openapi/openapi.json", "config"],
  ["packages/sdk/openapi/gen/models/orderField.ts", "config"],
  ["api/v1/service_pb2.py", "config"],
  ["package.json", "config"],
  ["tsconfig.base.json", "config"],
  ["bun.lock", "config"],
  ["go.sum", "config"],
  ["go.mod", "config"],
  ["requirements-dev.txt", "config"],
  ["CMakeLists.txt", "config"],
  ["tools/defs.bzl", "config"],
  ["Dockerfile", "config"],
  ["deploy/Dockerfile.worker", "config"],
  ["deploy/nginx.conf.j2", "config"],
  ["Makefile", "config"],
  ["mypy.ini", "config"],
  [".github/workflows/test.yml", "config"],
  [".eslintrc.json", "config"],
  [".env.example", "config"],
  ["app/src/backend/db/migrations/0042-add-status.ts", "persistence"],
  ["app/src/backend/repositories/orders.ts", "persistence"],
  ["db/schema.sql", "persistence"],
  ["app/src/shared/schema/order-filter.ts", "domain"],
  ["app/src/backend/api/orders.ts", "interfaces"],
  ["packages/sdk/src/cli/orders.ts", "interfaces"],
  ["proto/review.proto", "interfaces"],
  ["app/src/backend/entities/order/entity.ts", "logic"],
  ["app/src/backend/jobs/processors/sync-orders.ts", "logic"],
  ["app/src/frontend/components/OrderDialog.tsx", "surface"],
  ["src/page/style.css", "surface"],
  ["templates/email.html.tmpl", "surface"],
  ["assets/logo.png", "surface"],
  ["app/src/backend/api/orders.spec.ts", "tests"],
  ["src/importer.test.ts", "tests"],
  ["pkg/importer_test.go", "tests"],
  ["tests/fixtures/pack.json", "tests"],
  ["conftest.py", "tests"],
  ["scripts/release", "other"],
  ["data/sample.parquet", "other"],
];

describe("groupOf", () => {
  test.each(cases)("%s is %s", (path, group) => {
    expect(groupOf(path)).toBe(group);
  });

  test("a file an entity names is a domain type, whatever its path says", () => {
    expect(groupOf("docs/word-pack.md", new Set(["docs/word-pack.md"]))).toBe("domain");
  });

  test("every group it returns is one the page shows", () => {
    for (const [path] of cases) expect(isGroup(groupOf(path))).toBe(true);
    expect(GROUP_KEYS.at(-1)).toBe("other");
  });
});
