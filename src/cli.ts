#!/usr/bin/env bun
// zreview — review a pull request one feature at a time.
//
//   zreview review <review.json> [--json] [--require-approval] [--result-file <path>]
//                                [--no-open] [--port <n>] [--timeout <seconds>]
//                                [--max-width <px>] [--quality <n>] [--no-reencode]
//   zreview build  <review.json> [-o <review.html>] [--max-width <px>] [--quality <n>] [--no-reencode]
//
// `review` serves the page on localhost, opens it, and blocks until the reviewer
// submits or closes the tab. The decision goes to stdout: the Markdown summary
// by default, one JSON record with --json. Exit 0 unless --require-approval,
// which makes the exit code carry the outcome: 0 approved, 1 anything else.
// Exit 2 means zreview itself could not run: bad input, missing file,
// unwritable result file.

import { parseArgs } from "node:util";
import { link, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { buildHtml, ReviewError } from "./build.ts";
import { serve, type Outcome } from "./serve.ts";

const USAGE = `zreview — review a pull request one feature at a time

  zreview review <review.json> [--json] [--require-approval] [--result-file <path>]
                               [--no-open] [--port <n>] [--timeout <seconds>]
  zreview build  <review.json> [-o <review.html>]

  both: [--max-width <px>] [--quality <n>] [--no-reencode]

review  serves the page, opens it, blocks until you decide, prints the decision
build   writes a self-contained review.html and exits

stdout  the Markdown summary; one JSON record with --json; nothing when dismissed
exit    0 always, unless --require-approval: 0 approved, 1 otherwise. 2 = could not run`;

function die(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}

/** Refuse before a browser opens: an existing result file or a missing directory is a usage error, not a review outcome. */
async function checkResultPath(path: string) {
  if (await Bun.file(path).exists()) die(`--result-file ${path} already exists; refusing to overwrite`);
  const dir = dirname(path);
  if (!(await stat(dir).catch(() => null))?.isDirectory()) die(`--result-file: directory does not exist: ${dir}`);
}

/** Atomic and no-clobber. The record is written fully to a temp file, then hard-linked into place; link() refuses an existing path. */
async function writeResult(path: string, outcome: Outcome): Promise<boolean> {
  const tmp = `${path}.${process.pid}.tmp`;
  await Bun.write(tmp, JSON.stringify(outcome, null, 2));
  try {
    await link(tmp, path);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    console.error(`--result-file ${path} appeared during the review; not overwriting. The record is on stdout.`);
    return false;
  }
  await unlink(tmp);
  return true;
}

const argv = Bun.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") { console.log(USAGE); process.exit(0); }

const command = argv[0] === "review" || argv[0] === "build" ? argv.shift()! : "review";
const { values: opt, positionals } = parseArgs({
  args: argv,
  options: {
    out: { type: "string", short: "o", default: "review.html" },
    json: { type: "boolean", default: false },
    "require-approval": { type: "boolean", default: false },
    "result-file": { type: "string" },
    "no-open": { type: "boolean", default: false },
    port: { type: "string", default: "0" },
    timeout: { type: "string" },
    "max-width": { type: "string", default: "1200" },
    quality: { type: "string", default: "82" },
    "no-reencode": { type: "boolean", default: false },
  },
  allowPositionals: true,
});
const src = positionals[0] ?? die(USAGE);
if (opt["result-file"]) await checkResultPath(opt["result-file"]);

try {
  const built = await buildHtml(src, {
    maxWidth: opt["no-reencode"] ? 0 : Number(opt["max-width"]),
    quality: Number(opt.quality),
    served: command === "review",
  });

  if (command === "build") {
    await Bun.write(opt.out, built.html);
    const feats = built.review.features;
    console.error(`wrote ${opt.out} (${Math.round(Bun.file(opt.out).size / 1024)} KB): ${feats.length} features, ` +
      `${feats.filter((f) => f.screenshots).length} with screenshots, ${feats.reduce((n, f) => n + (f.diagrams?.length ?? 0), 0)} diagrams`);
    for (const line of built.log) console.error(`  ${line}`);
    process.exit(0);
  }

  const outcome = await serve(built.html, built.review, {
    port: Number(opt.port),
    open: !opt["no-open"],
    timeoutSeconds: opt.timeout ? Number(opt.timeout) : undefined,
  });

  if (opt.json) console.log(JSON.stringify(outcome));
  else if (outcome.decision === "dismissed") console.error("zreview: dismissed without a decision");
  else console.log(outcome.summary);

  const written = opt["result-file"] ? await writeResult(opt["result-file"], outcome) : true;
  if (!written) process.exit(2);
  process.exit(opt["require-approval"] && outcome.decision !== "approved" ? 1 : 0);
} catch (e) {
  if (e instanceof ReviewError) die(e.message);
  throw e;
}
