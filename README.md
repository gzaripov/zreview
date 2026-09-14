# zreview

Review a pull request one feature at a time.

A PR is rarely one change. `zreview` takes a `review.json` that splits it into
features — each with the user scenario, what changed, architecture diagrams,
before/after screenshots when the UI moved, and how it was tested — and opens
a local page with a sidebar. You walk the features, approve or request changes
on each, and submit. The decision comes back on stdout, so an agent or a script
can wait on it.

Built for agents to drive, in the shape of [Plannotator](https://github.com/backnotprop/plannotator):
launch, block until the human decides, print the decision, exit with it.

## Install

Bun only.

```bash
git clone https://github.com/gzaripov/zreview && cd zreview && bun link
```

## Use

```bash
zreview review review.json            # opens the page, blocks, prints the summary
zreview review review.json --json     # one JSON record instead
zreview build  review.json -o review.html   # static page, no server
```

`review` serves the page on a random localhost port, opens your browser, and
blocks. Click **Submit review** and the process returns. Close the tab and it
returns `dismissed`.

## The contract

stdout is the whole interface.

| Outcome | When | stdout |
|---|---|---|
| `approved` | every feature approved, then Submit | the Markdown summary |
| `changes` | any feature sent back, then Submit | the Markdown summary |
| `incomplete` | Submit with features still open | the Markdown summary |
| `dismissed` | tab closed, or `--timeout` elapsed | nothing |

With `--json`, one record:

```json
{ "decision": "changes",
  "features": { "f4": { "decision": "changes", "note": "…", "at": 1789408171398 } },
  "summary": "## Review of gzaripov/momo#45 at `44c0bf9`\n\n1. …",
  "url": "http://127.0.0.1:49763/" }
```

Exit code is `0` unless you ask for it to mean something:

| Flag | Exit |
|---|---|
| default | `0` for any outcome |
| `--require-approval` | `0` approved, `1` anything else |
| always | `2` when zreview could not run: bad `review.json`, missing screenshot, existing `--result-file` |

The `2` fires before any server starts, so a bad invocation never opens a tab.

## Flags

```
--json                  one JSON record on stdout
--require-approval      exit code carries the outcome
--result-file <path>    also write the record here, atomically; refuses to overwrite
--no-open               do not launch a browser (prints the URL on stderr)
--port <n>              fixed port instead of random
--timeout <seconds>     give up as dismissed
--max-width <px>        screenshot cap, default 1200 (see below)
--quality <n>           JPEG quality, default 82
--no-reencode           inline screenshots as captured
```

## review.json

```json
{
  "pr": { "repo": "owner/name", "number": 45, "url": "https://github.com/owner/name/pull/45",
          "title": "…", "base": "main", "head": "44c0bf9",
          "exposure": "Dark. No user path reaches this yet." },
  "features": [
    { "id": "contract",
      "title": "Portable word-pack contract",
      "scenario": "A producer outside the app writes a word pack; a learner imports it.",
      "description": "Markdown. What changed and why.",
      "diagrams": [ { "title": "Contract boundary", "mermaid": "flowchart LR\n  A --> B" } ],
      "screenshots": { "before": "before.png", "after": "after.png", "caption": "…" },
      "files": ["packages/word-pack/src/schema.ts"],
      "tested": "Markdown. Command, observed result, what is not covered." }
  ]
}
```

- `screenshots` is `null` when the feature has no user-visible surface; the page
  says so rather than leaving a blank. Paths are relative to `review.json`.
- `files` are hashed into `#diff-<sha256>` links into the PR's Files tab. A
  path not in the PR is a dead link.
- Decisions persist in the browser, keyed on `repo#number@head`, so a review of
  a stale head is visibly stale.

## Screenshots

The page carries its own images as base64, so nothing is uploaded and private
repositories need no attachment step. Each shot is re-encoded through `sips`
(macOS) to JPEG and downscaled only if wider than `--max-width`. The cap is on
width: phones top out near 1290 px, so at 1200 every phone capture keeps its
native width and only tablet and desktop captures shrink. The re-encode is kept
only when it is smaller than the original — flat UI usually compresses better
as PNG. Nothing is ever upscaled. A real iPhone screen inlines at roughly
100 KB.

## Static pages

`build` writes the same page without a server. Submit is hidden; **Copy review
summary** and **Export decisions.json** remain, so a reviewer without the CLI
can still hand back a verdict.
