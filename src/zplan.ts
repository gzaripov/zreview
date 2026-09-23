#!/usr/bin/env bun
// zplan — review the plan before the code exists. Same tool, one command shorter:
// `zplan plan.json` is `zreview plan plan.json`.

process.argv.splice(2, 0, "plan");
await import("./cli.ts");
