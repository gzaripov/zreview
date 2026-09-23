# zreview

Review a pull request one feature at a time.

A PR is rarely one change. `zreview` takes a `review.json` that splits it into
features — each with the user scenario, what changed, the domain entities and
what you can do with them, architecture diagrams, before/after screenshots
when the UI moved, the diff, and how it was tested — and opens a local page
with a sidebar. You walk the features, approve or request changes on each,
comment on diff lines or on any passage of text, and submit. The decision
comes back on stdout, so an agent or a script can wait on it.

Built for agents to drive, in the shape of [Plannotator](https://github.com/backnotprop/plannotator):
launch, block until the human decides, print the decision, exit with it.

## Install

Requires [Bun](https://bun.sh). `gh` is optional but recommended — it fetches
the diff and the PR metadata.

```bash
curl -fsSL https://raw.githubusercontent.com/gzaripov/zreview/main/install.sh | bash
```

That clones to `~/code/zreview`, puts `zreview` on PATH with `bun link`, and
installs the agent skill where both Claude Code and omp load it. Re-run it to
update. From a checkout, `./install.sh` does the same.

Manually:

```bash
git clone https://github.com/gzaripov/zreview ~/code/zreview
cd ~/code/zreview && bun link
ln -sfn ~/code/zreview/skill ~/.agents/skills/zreview
ln -sfn ~/.agents/skills/zreview ~/.claude/skills/zreview
```

Check: `zreview --help`, and in either agent, ask it to "review PR 45 with
zreview" — the skill should load.

## Use

### From an agent

Ask Claude Code or omp to review a PR. The `zreview` skill tells it how: pin
the head, split the diff into features, write `review.json`, run `zreview
review`, wait, act on what comes back. The agent does the analysis; zreview
renders it and collects your decision.

### By hand

Write `review.json` (schema below), then:

```bash
zreview review review.json                   # opens the page, blocks, prints the summary
zreview review review.json --json            # one JSON record instead
zreview build  review.json -o review.html    # static page, no server, nothing to wait for
```

`review` serves the page on a random localhost port, opens your browser, and
blocks. It fetches the PR's diff through `gh pr diff` and shows each feature's
files inline; pass `--diff <file>` to supply one yourself, or run without `gh`
and the page degrades to file links.

### In the page

- **Sidebar** lists the features. The badge is the decision; a `✎` count is
  how many comments you left; `2/5 👁` is how many of its files you marked
  viewed.
- **Each feature** shows the user scenario, what changed, the entities it
  adds or changes (what each consists of, what you can do with it, why, and a
  serialized examples beside them, in an editor with a tab per case), architecture diagrams (hover one for a
  full-screen button; Esc closes), before/after screenshots, the
  syntax-highlighted diff, and how it was tested.
- **Viewed** — a checkbox on each file in the diff, as on GitHub. Checking
  it folds the file; the Diff heading counts them.
- **Comment on a diff line** — click it. **Comment on text** — select any
  passage in the scenario, description, or tested block and a Comment button
  appears; the quote stays highlighted with your comment as its tooltip.
- **Approve** or **Request changes** per feature, with a note.
- **Theme** — the ☾/☀ button in the sidebar switches light and dark; the
  page starts on your OS setting and remembers the switch.
- **Submit review** returns the decision to the process, and is the only
  thing that ends it. Reloading or closing the tab does not: every change is
  already on disk, so re-run and carry on where you were. **Copy review
  summary** and **Export decisions.json** work with or without a server.

Decisions, notes, comments and viewed files persist across runs in
`~/.local/state/zreview/<repo>#<number>.json` (or `$XDG_STATE_HOME`, or
`$ZREVIEW_STATE_DIR`), keyed on the PR rather than the head, so a re-run after
the author pushes resumes where you were. A decision remembers what each
file's hunks looked like; when the author reworks a feature's files, its badge
turns to **updated**, the reworked files are marked in the diff, and their
Viewed checks clear. Decide again to clear it. `--fresh` ignores the file and starts over. A
static `build` keeps the state in the browser instead.

## The contract

stdout is the whole interface.

| Outcome | When | stdout |
|---|---|---|
| `approved` | every feature approved, then Submit | the Markdown summary |
| `changes` | any feature sent back, then Submit | the Markdown summary |
| `incomplete` | Submit with features still open | the Markdown summary |
| `dismissed` | no Submit before `--timeout` (6 h) | nothing |

With `--json`, one record. Each feature carries its decision, note, and
comments — `line` comments name a file, side and line; `text` comments carry
the quoted passage and its section:

```json
{ "decision": "changes",
  "features": {
    "import": { "decision": "changes", "note": "", "at": 1789412507845,
                "comments": [
                  { "kind": "line", "file": "src/importer.ts", "side": "new", "line": 41,
                    "body": "Confirm unescaped slashes in the digest is deliberate." },
                  { "kind": "text", "section": "scenario", "quote": "same pack twice",
                    "body": "Byte-identical, or same UUID?" } ] } },
  "summary": "## Review of owner/name#45 at `18b8bf5`\n\n1. …",
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
--json                  one JSON record on stdout
--require-approval      exit code carries the outcome
--result-file <path>    also write the record here, atomically; refuses to overwrite
--diff <file>           unified diff to show; default is `gh pr diff <number>`
--no-open               do not launch a browser (prints the URL on stderr)
--port <n>              fixed port instead of random
--timeout <seconds>     wait this long for a Submit, default 21600 (6 h); 0 waits forever
--fresh                 ignore the saved state for this PR
--max-width <px>        screenshot width cap, default 1200
--quality <n>           JPEG quality, default 82
--no-reencode           inline screenshots as captured
```

## review.json

```json
{
  "pr": { "repo": "owner/name", "number": 45, "url": "https://github.com/owner/name/pull/45",
          "title": "…", "base": "main", "head": "18b8bf5",
          "exposure": "Dark. No user path reaches this yet." },
  "features": [
    { "id": "contract",
      "title": "Portable word-pack contract",
      "scenario": "A producer outside the app writes a word pack; a learner imports it.",
      "description": "Markdown. What changed and why.",
      "entities": [ … ],
      "diagrams": [ { "title": "Contract boundary", "mermaid": "flowchart LR\n  A --> B" } ],
      "screenshots": { "before": "before.png", "after": "after.png", "caption": "…" },
      "files": ["packages/word-pack/src/schema.ts"],
      "tested": "Markdown. Command, observed result, what is not covered." }
  ]
}
```

- `pr.head` is the commit the analysis describes. The page shows it and keys
  the decision state on it.
- `scenario` is the user's situation before any mechanism. If none exists, say
  the feature is infrastructure rather than inventing a user.
- `entities` are the domain types a feature adds, changes, renames, or
  removes. Each has `fields` (what it consists of) and `operations` (what you
  can do with it); every part carries a `meaning` and, where it matters, a
  `why`. `renamed` entities carry `from`. `examples` are serialized
  instances, **required** on every entity and shown beside the fields in a
  read-only editor with a tab per case: a default that fills most fields
  first, then edge cases, each with a `title` and an optional `note` (and
  `lang` for a string value that is not JSON). An entity without one is exit
  `2` naming it. A single `example` satisfies the rule too. A grep can list every struct in a
  diff; it cannot tell a domain entity from `CodingKeys`, so this is authored
  judgment:

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
      "examples": [
        { "title": "Lesson with theory", "value": { "momo": 1, "kind": "spinoff", "title": "At the ramen shop", "words": [ { "surface": "食べる" } ], "theory": [ { "title": "Ordering", "body": "Point and say the name." } ] } },
        { "title": "Word list, no theory", "note": "The wire value is still spinoff.", "value": { "momo": 1, "kind": "spinoff", "title": "Verbs", "words": [ { "surface": "食べる" } ] } },
        { "title": "At the byte ceiling", "note": "65,536 bytes exactly; one more is rejected before parsing.", "value": { "momo": 1, "kind": "spinoff", "title": "…", "words": [] } } ] } ]
  ```

- `screenshots` is `null` when the feature has no user-visible surface; the
  page says so rather than leaving a blank. Paths are relative to `review.json`.
- `files` are hashed into `#diff-<sha256>` links into the PR's Files tab and
  matched against the diff for inline hunks. When a diff is available every
  changed file must be claimed by a feature and every listed file must be in
  the diff; otherwise zreview exits `2` naming the files, before any tab opens.

## Screenshots

The page carries its own images as base64, so nothing is uploaded and private
repositories need no attachment step. Each shot is re-encoded through `sips`
(macOS) to JPEG and downscaled only if wider than `--max-width`. The cap is on
width: phones top out near 1290 px, so at 1200 every phone capture keeps its
native width and only tablet and desktop captures shrink. The re-encode is kept
only when it is smaller than the original — flat UI usually compresses better
as PNG. Nothing is ever upscaled. A real phone screen inlines at roughly 100 KB.

## Layout

```
src/cli.ts        the contract: flags, stdout, exit codes
src/serve.ts      localhost server; resolves on Submit or tab close
src/build.ts      review.json → HTML; diff parsing; screenshot inlining
src/page/         index.html, style.css, app.js — inlined into one file at build
skill/SKILL.md    the agent skill; install.sh links it into ~/.claude/skills
```

Bun only, no dependencies. MIT.
