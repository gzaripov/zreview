---
name: zreview
description: >
  Review a pull request one feature at a time with zreview. Use when asked to
  review a PR, to explain what a branch does feature by feature, or when a
  reviewer wants to approve a change piece by piece with the user scenario,
  domain entities, diagrams, before/after screenshots and the diff in front of
  them. The decision comes back on stdout.
compatibility: Requires the zreview CLI on PATH (Bun), Git, and an authenticated GitHub CLI. Screenshot re-encoding uses macOS sips.
---

# Review a PR one feature at a time

A PR is rarely one change. Split it into the features it actually contains,
write each one up for a reviewer, and hand the result to `zreview review`. It
serves a page with a sidebar, blocks until the reviewer submits, and returns
one JSON record: a decision per feature, a note, and any comments they left on
the prose or on diff lines.

You produce `review.json`. `zreview` renders and waits. Every judgment — where
one feature ends and the next begins, what the scenario is, which diagram
earns its place, which types are domain entities — is yours, and it is the
whole job.

## 1. Establish the real scope

Refresh the base and pin the head before reading any diff. A three-dot diff
resolves its merge base against wherever the *local* base branch points; a
stale local `main` sweeps in other PRs' work, which then reads as part of this
change. Fetch, diff the remote refs, and confirm the file list is the PR's:

```bash
gh pr view <N> --json baseRefName,headRefName,headRefOid,title,url
git fetch origin <base> <head>
diff <(git diff origin/<base>...origin/<head> --name-only | sort) \
     <(gh pr diff <N> --name-only | sort)          # empty = the diff is the PR's
```

If the lists differ, stop. Never describe a file absent from the platform's
list. Read the pinned `headRefOid`, not the working tree.

Then read the changed entrypoints, their callers, the tests, and any linked
issue or design. Note how a user reaches the change — API only, internal,
behind a flag, public, or not at all. That is `pr.exposure`.

## 2. Label the features

Group the diff by **user-visible outcome**, never by layer. "Models",
"Repositories", "Tests" are not features. A feature is a unit a reviewer could
approve while questioning its neighbour: a migration and the code that needs
it are one; a rename sweeping thirty files is one; a schema and its validator
are usually two, because they can be wrong independently. A single-concern PR
is one feature — do not manufacture a second.

Order them the way a reviewer should read: what defines constraints before
what enforces or consumes them.

For each feature, the fields below. Full schema in the zreview README.

**`scenario`** — the user's situation before any mechanism, one to three
sentences. *"A learner imports the same pack twice. Their progress on the first
must survive."* If none exists, the feature is infrastructure — say so rather
than inventing a user.

**`description`** — Markdown. What changed and why. Name files and symbols
where they help; never narrate the diff. One thought per sentence, active
voice, name the actor.

**`entities`** — the domain types the feature adds, changes, renames, or
removes. Each has `fields` (what it consists of) and `operations` (what you can
do with it); every part carries a `meaning` and, where it matters, a `why`. The
reasoning is the point — `kind: Kind` tells a reviewer nothing, *"a word list,
or a lesson that adds theory on top; the wire value stays `spinoff` so shipped
packs keep decoding"* tells them everything. Every entity needs `examples`:
serialized instances, each with a `title`, an optional one-line `note`, and
the `value`. Omitting them is exit `2` naming the entity — an entity nobody
showed an instance of is a declaration, not a domain type.
The first is the default: an instance that fills most of the fields, the one
a reviewer pictures when they read the type. Then two or three cases that
exercise the edges — the minimal valid instance, a boundary (a maximum
length, an empty list, a zero), a legacy or wire-compatibility shape, an
instance that looks wrong but is valid or the reverse. Say in the `note` why
each edge is worth looking at. A grep lists every struct in a diff; it cannot
tell a domain entity from `CodingKeys`. That judgment is yours.

**`diagrams`** — Mermaid, when the feature changes control flow, state,
persistence, or a component boundary. Names from the code; no fictional
services. Leave empty when nothing moved — the page says so.

**`screenshots`** — when a user could see the change. A modification gets
**before and after**. Render the before from the code you replaced, under the
same viewport and seeded state as the after; a wider or shorter harness renders
a different bug. Look at it and confirm the symptom shows. Delete any capture
harness before committing. `null` when there is no user-visible surface; the
page prints the absence. The builder inlines the images, so nothing is uploaded.

**`files`** — exactly as `gh pr diff --name-only` spells them, and every one
of them: zreview compares the features' files to the diff and exits `2`
naming any changed file no feature claims, or any listed path the PR does not
change. A lockfile or generated file belongs to the feature whose change
produced it.

**`tested`** — per feature. The command, the observed result, what is not
covered. If nothing ran, say so and name what a reviewer should run. Never
hoist every result under one feature; the reviewer approves features.

## 3. Review

Work in a scratch directory outside the repository — the page carries base64
images and does not belong in a working tree.

```bash
mkdir -p /tmp/zreview-<N> && cd /tmp/zreview-<N>
zreview review review.json --json --result-file decision.json
```

`zreview review` fetches the PR's diff through `gh pr diff` (or takes
`--diff <file>`), opens the page, and **blocks**. Run it with a long or no
timeout, or in the background, and read stdout when it returns. Only Submit
ends it; a reload or a closed tab does not, so never re-run because the page
went away. The
reviewer's decisions, comments and viewed files persist per PR across runs,
so after you address `changes` and push, re-run the same way and they resume
where they were; pass `--fresh` only if they ask to start over.

| `decision` | Meaning |
|---|---|
| `approved` | every feature approved |
| `changes` | at least one sent back; `features[id].note` and `comments` say why |
| `incomplete` | submitted with features still open |
| `dismissed` | no Submit within `--timeout`, 6 h by default; whatever was decided comes back, so check `features` before treating it as nothing |

`--require-approval` makes the exit code carry it: `0` approved, `1`
otherwise. Exit `2` means zreview could not run — it names the bad field or
missing file, and fires before any tab opens.

Open the page yourself once before handing it over and walk every feature:
diagrams rendered, screenshots load, file links resolve, entities read as
prose rather than declarations.

## 4. Act on the decision

`changes` — each sent-back feature's note and comments are the reviewer's ask.
Address them in the same conversation; do not re-litigate a verdict. A `line`
comment names `file`, `side` and `line`; a `text` comment carries the quoted
passage. `dismissed` — say so briefly and continue.

The record's `summary` is the verdicts as Markdown. Neither zreview nor you
post it anywhere unless asked. When asked, whose PR it is decides the command:
your own → `gh pr comment <N> --body-file summary.md`, since GitHub refuses
`--approve` and `--request-changes` from the author with a 422; someone
else's → `gh pr review <N> --approve|--request-changes --body-file summary.md`.

## What not to do

- Do not group by layer.
- Do not write a scenario the user cannot have.
- Do not list a struct as an entity because it exists; list it because a
  reviewer needs to know what it is and what it does.
- Do not draw a diagram for a feature that moved nothing.
- Do not ship a "before" you have not looked at.
- Do not describe files the platform file list does not contain.
