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
zreview review review.json            # opens the page, blocks, prints the summary
zreview review review.json --json     # one JSON record instead
zreview build  review.json -o review.html   # static page, no server
```

`review` serves the page on a random localhost port, opens your browser, and
blocks. Click **Submit review** and the process returns. Close the tab and it
returns `dismissed`.

It fetches the PR's diff through `gh pr diff` and shows each feature's files
inline; pass `--diff <file>` to supply it yourself, or run without `gh` and the
page degrades to file links. Click any diff line to comment on it. Select text
in the scenario, description, or tested blocks and a **Comment** button
appears, the way Plannotator does it. Comments ride along in the record and in
the summary.

## The contract

stdout is the whole interface.

| Outcome | When | stdout |
|---|---|---|
| `approved` | every feature approved, then Submit | the Markdown summary |
| `changes` | any feature sent back, then Submit | the Markdown summary |
| `incomplete` | Submit with features still open | the Markdown summary |
| `dismissed` | tab closed, or `--timeout` elapsed | nothing |

With `--json`, one record. Each feature carries its decision, note, and
comments — `line` comments name a file, side and line; `text` comments carry the
quoted passage and its section:

```json
{ "decision": "changes",
  "features": {
    "f3": { "decision": "changes", "note": "", "at": 1789412507845,
            "comments": [
              { "kind": "line", "file": "apps/mobile-ios/Momo/Models/WordPackImport.swift", "side": "new", "line": 1,
                "body": "Confirm unescaped slashes in the digest is deliberate." },
              { "kind": "text", "section": "scenario", "quote": "same pack twice",
                "body": "Byte-identical, or same UUID?" } ] } },
  "summary": "## Review of gzaripov/momo#45 at `18b8bf5`\n\n1. …",
  "url": "http://127.0.0.1:65392/" }
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
--diff <file>           unified diff to show; default is `gh pr diff <number>`
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
- `entities` lists the domain types a feature adds, changes, renames, or
  removes. Each has `fields` (what it consists of) and `operations` (what you
  can do with it); every part carries a `meaning` and, where it matters, a
  `why` — the reasoning is the point, the type alone is not. `renamed` entities
  carry `from`. An `example` is a serialized instance, pretty-printed under a
  collapsed *Example*. A grep can list every struct in a diff; it cannot tell
  `WordPack` from `CodingKeys`, so this is authored judgment, not extraction:

  ```json
  "entities": [
    { "name": "WordPack", "kind": "value type", "change": "added", "from": "ContentDocument",
      "summary": "The portable envelope a producer writes and a learner imports.",
      "why": "Read and an import must produce the same object, so the engine never learns where a lesson came from.",
      "fields": [
        { "name": "kind", "type": "Kind", "meaning": "A word list, or a custom lesson that adds theory on top.",
          "why": "Wire value for a custom lesson is still \"spinoff\", so packs already shipped keep decoding." } ],
      "operations": [
        { "name": "decodeWordPack", "type": "(bytes: Uint8Array) → WordPack",
          "meaning": "Enforces the 65,536-byte ceiling first, then parses." } ],
      "example": { "momo": 1, "kind": "spinoff", "id": "…", "title": "At the ramen shop", "words": [ { "surface": "食べる" } ] } } ]
  ```

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
