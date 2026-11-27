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
services. Leave empty when nothing moved — the page says so. zreview parses
every diagram with the Mermaid version the page renders it with. A diagram
that fails is exit `2` naming the feature, the diagram and the parse error,
before any tab opens. Fix the diagram it names. Do not drop the diagram to
get past the check. In a flowchart, quote a label that contains `(`, `;`, `=` or `:`, as in
`A["fetch(id)"]`. A state transition label takes one colon: `a --> b: publish`,
not `a --> b: resolved: publish`.
The page draws each diagram in its own colours, light and dark, so leave out
`%%{init}%%` themes, `classDef` fills and `style` lines. A diagram wider than
the page is scaled down to fit, text included: keep a flowchart to about four
boxes across, or draw it top to bottom.

**`screenshots`** — when a user could see the change. A modification gets
**before and after**. Render the before from the code you replaced, under the
same viewport and seeded state as the after; a wider or shorter harness renders
a different bug. Look at it and confirm the symptom shows. Delete any capture
harness before committing. `null` when there is no user-visible surface; the
page prints the absence. The builder inlines the images, so nothing is uploaded.
With levels, the reviewer sees a feature's pair at Mid.

**`files`** — exactly as `gh pr diff --name-only` spells them, and every one
of them. Focus review walks them grouped by path (domain types first, then
persistence, logic, interfaces, surface, tests, generated), and an entity's
`file` pins that path to the front, so give every entity the file it lives
in: zreview compares the features' files to the diff and exits `2`
naming any changed file no feature claims, or any listed path the PR does not
change. A lockfile or generated file belongs to the feature whose change
produced it. zreview groups the files by kind and path for Focus review:
domain types, persistence, logic, interfaces, surface, tests, docs, config
and generated, and other. When a file lands in the wrong group, set its
`"role"` on the file's object: `domain`, `persistence`, `logic`, `interfaces`,
`surface`, `tests`, `docs`, `config` or `other`.

**`lines`** — a feature shows the reviewer only its own changes, so when a
file serves more than one feature, every feature that lists it says which of
its changed lines are its own: `{ "path": "…", "lines": ["550-558", "587",
"old:45"] }`, numbered as they are at `pr.head`, with `old:N` for a removed
line. Every changed line needs a feature. Claim a line for what it does, not
where it sits: an import goes with the feature that uses it, a test with the
feature it proves, a doc line with the behaviour it describes. A line that
serves two features — an import both use, test setup several tests share, a
paragraph that describes both — is claimed by both; the page shows it lighter,
tags it `also N`, and folds it when it sits away from the feature's own lines.
A Markdown paragraph is one line, so a sentence about one feature inside a
paragraph about another means claiming the paragraph for both, then naming the
words that are this feature's with `"phrases": ["…"]` on the same file, copied
from the line (backticks and emphasis marks may be left out). The page
highlights the phrases and dims the other features' edits in the paragraph; a
phrase that is in none of the feature's claimed lines is exit `2`. A removed
line goes with the lines added in its place when those all belong to the same
features. Claim it with `old:N` when they do not, or when it belongs elsewhere
— a function one feature deletes right where another adds code; an explicit
claim replaces the default. The page shows each feature its lines in full with
a solid stripe, folds the hunks that belong to other features behind a bar
naming them, and dims other features' lines inside a shared hunk.

You do not need the numbers up front. zreview exits `2` before any tab opens
when a feature that shares a file gives no `lines`, a range names no changed
line, or a changed line has no feature. It then prints every file it rejects
with its changed lines numbered the way `lines` takes them, each tagged with
the feature it goes to now. List the files as usual, run zreview, claim from
that listing, and run it again. Once it passes, open the page and check that
each feature's shared files show its own changes and nothing else.

**`tested`** — per feature. The command, the observed result, what is not
covered. If nothing ran, say so and name what a reviewer should run. Never
hoist every result under one feature; the reviewer approves features.

## 3. Write the levels, for a PR read top-down

A big PR is easier to judge compressed than through its diff. When the
reviewer asks to read top-down, or the PR is too big to hold in one head, add
`purpose` to `review.json`. The page then puts three short documents above
the code, and the reviewer signs them clause by clause, in this order:

- **High, why this exists.** `purpose.summary` and `purpose.domain`, a
  sentence or two each, then `goals` and `nonGoals`. The page prints
  `pr.exposure` after the domain as who the change reaches, so write only
  that there and do not repeat the summary. A PR too small to have
  goals, a bug fix, says `"purpose": { "absent": "why" }` and is read on two
  levels.
- **Mid, what the product does**, as a product manager would say it. Each
  feature keeps its `scenario` and gains `rules`: how the product behaves, in
  product words, with no mechanism. `serves` lists the goals a feature or a
  rule serves.
- **Low, how it behaves**, as a tester would check it. Each feature gains
  `behaviours`, each with the rules it `checks` and its `evidence`. The
  diagrams are read here, and so is `libraries`: everything the PR adds,
  upgrades or removes, `[]` when none.
- **Code**, below the levels: every feature's description, entities, files
  and test notes as one document. The reviewer opens it when a clause sends
  them there, so the levels have to stand without it.

**Say where each statement comes from.** `"source": "stated"` with `from`
naming the ticket, the PR description or the doc. `"decided"` for a call the
author made because nothing above settles it. `"inferred"` when it is read
off the change and written down nowhere. The page hands the last two to the
reviewer as theirs to judge, so never mark a guess as stated. List in
`purpose.sources` what you read and what you could not.

**Nothing floats.** A feature or a rule that serves no goal, and a behaviour
that checks no rule, carries `derived`: why it is here though nothing above
asks for it. The reviewer keeps it, drops it, or adds what is missing above.

**Evidence is how the behaviour is known, not how it could be.** `test` with
the `file` and the test's `name` as the diff spells it, and `"existing":
true` for a test that was already there. `stand` or `reading` with a `note`
of what was seen and where. `none` when nothing covers it. Put in `flag` the
one thing the reviewer should weigh before signing a statement, and leave it
out when there is none: a mark on every line marks nothing.

**Capture the cases words do not show.** A behaviour takes `screenshots`
too: `{ "before", "after", "caption" }` with either image or both. Use it for
a complicated case a reviewer cannot picture from its title, such as an error
message, an empty state or a layout at its limit, and say in the caption what
the capture shows of that case. Capture it the way you capture a feature's
pair, from the real page under a seeded state. Leave it off the main path:
the feature's own pair already shows that at Mid.

**Write a behaviour as a title, and add steps only where they say more.** The
reviewer scans the titles and opens one behaviour at a time, so the title is
a sentence that states the outcome: "A second refund of the same order is
refused". `given`, `when` and `then` are optional lists, and every line has
to earn its place:

- No filler `given`. "Given a customer" sets nothing up. Say the state that
  matters ("a customer whose order was refunded yesterday"), or leave the
  line out.
- No step that repeats the title. When the title already says who does what
  and what follows, the behaviour has no steps.
- Keep steps for what a tester would not guess: the exact input, the status
  code, the message, the second thing that must also hold.
- Only the three words. No outlines, tables or tags: nobody runs these lines.

Each level has a size it may not outgrow, and zreview exits `2` naming every
problem: 5 goals and 5 non-goals of 30 words, 7 rules of 35 words per
feature, 10 behaviours per feature with a 14-word title and at most 7 steps.
Past that, split the feature or keep only the cases a tester would not guess.

What comes back is decided by level, `@high`, `@mid` and `@low`. A level is
`approved` when every clause is signed, including its last one, which says
nothing is missing; it is `changes` as soon as one clause carries a request.
The summary lists each request under its level with the clause's id, and
`features["@mid"].rows` holds the same per clause. After a rework, rewrite
the clause and run again: a clause whose wording or proof moved loses its
signature and is shown with what it said before, and the rest stay signed.
Keep the ids stable, and do not reword a clause nobody asked you to change.

## 4. Review the plan first, when there is one to review

For work worth agreeing on before writing it, the same page reviews the plan.
Write `review.json` with `"plan": true`, an `id` you will keep, `pr.repo` and
`pr.title` only, and features carrying the scenario, what each will change,
the entities it will add, the diagrams and `tested` as the test plan — and no
`files`, because nothing is written. Run `zplan plan.json`. On `changes`,
rework the plan and run it again. On `approved`, build it.

Then review the code: add each feature's files and the real `pr` fields, drop
`"plan": true`, and run `zreview review` with the same `id`. The reviewer
keeps their plan decisions and sees what you reworked in the spec since, so
keep the features and their ids stable — a renamed id reads as a feature they
never agreed to.

## 5. Review the code

Work in a scratch directory outside the repository — the page carries base64
images and does not belong in a working tree.

```bash
mkdir -p /tmp/zreview-<N> && cd /tmp/zreview-<N>
zreview review review.json --json --result-file decision.json
```

If zreview says the install is behind its upstream, run `zreview update`
first, so the reviewer gets the current page.

`zreview review` fetches the PR's diff through `gh pr diff` (or takes
`--diff <file>`), opens the page, and **blocks**. Run it with a long or no
timeout, or in the background, and read stdout when it returns. Only Submit
ends it; a reload or a closed tab does not, so never re-run because the page
went away. The
reviewer's decisions, comments and viewed files persist per PR across runs,
so after you address `changes` and push, re-run the same way and they resume
where they were; pass `--fresh` only if they ask to start over. The page
holds the revision the reviewer last looked at and marks everything you moved
since — each reworded passage beside what it said before, the changed entities and diagrams,
and the lines that are new to them — so rewrite `review.json` to match the
fixes rather than leaving it stale. A scenario or description that no longer
matches the code shows up as a reworked passage they have to read twice.

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

## 6. Act on the decision

`changes` — each sent-back feature's note and comments are the reviewer's ask.
Address them in the same conversation; do not re-litigate a verdict. A `line`
comment names `file`, `side` and `line`; a `text` comment carries the quoted
passage. A `file` comment names a file and nothing else — it is about that
file's change as a whole. `dismissed` — say so briefly and continue.

**Then run `zreview review` again.** A review that came back `changes` or
`incomplete` is not finished: the reviewer is waiting to see the rework, and
re-running is the only way to hand it back. Push the fixes, refresh
`review.json` for anything the fixes moved — new files, a changed diagram, an
entity that gained a field, and the `lines` of every shared file, whose
numbers shift with each push (zreview names the ranges that went stale) — and
re-run the same command. Decisions, comments and viewed marks resume, and the
files you reworked come back marked `updated` with their viewed marks cleared,
so the reviewer sees exactly what changed since they looked. A rework that
touches only one feature's lines of a shared file leaves the other features
alone. Keep going until the decision is `approved`.

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
- Do not list a shared file without `lines`; say which lines are whose.
- Do not pad a behaviour with a `given` that sets nothing up, or with steps
  that repeat its title.
