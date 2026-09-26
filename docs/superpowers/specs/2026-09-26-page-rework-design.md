# Page rework: React + shadcn, mono-forward type, a sidebar that gets out of the way

Status: approved in brainstorming, 2026-09-26.

## Goal

Rework the review page's UI without changing what it does:

- **Components and styling:** React + [shadcn/ui](https://ui.shadcn.com) (Radix) + Tailwind v4, replacing the
  hand-written `style.css` and the HTML-string rendering in `app.js`.
- **Type:** mono-forward. JetBrains Mono for the chrome (sidebar, titles, section labels, buttons, badges, paths,
  line numbers) and all code; Geist for prose (scenario, descriptions, rendered Markdown, entity text, comments).
- **Sidebar:** thin overlay scrollbars; a collapse button and ⌘B / Ctrl+B; when collapsed, pointing at the left
  edge slides it in over the page; never a horizontal scrollbar.

## Non-goals

- No change to `review.json`, the CLI flags, the server API (`GET /`, `POST /api/state`, `POST /api/decision`), or
  the saved state files. A review in progress resumes across the change.
- No new review features. Mermaid and Monaco stay on the CDN (they are megabytes).

## Constraints

- One self-contained HTML page, served (`zreview review`/`plan`) or written (`zreview build`), as today.
- The CLI runs from source with Bun (`bun link` to a checkout). No build output is committed.
- The page is built with the review's cwd, not the repo's: nothing may depend on `process.cwd()`.
- `ReviewState` keeps its shape: `{ [featureId]: { decision, note, at, head, seen, viewed, comments } }`.

## Rollout: two PRs, each opened only when complete

The owner merges PRs quickly, so neither PR is opened until it is whole and verified.

**PR A — bundle the page; pure logic in tested modules.** No visual change.

- Bun bundles the page script (`Bun.build`, iife, minified) and `build.ts` inlines it where `app.js` went.
- The logic that does not touch the DOM moves out of `app.js` into `src/page/lib/*.ts` with `bun test` coverage,
  written against today's behavior before the move:
  - `diff.ts` — `lcsOps`, `wordDiff`, `blockOps`
  - `revisions.ts` — hashing, file snapshots, `shot`, `freshLines`, `since`, viewed helpers
  - `markdown.ts` — `mdUnits`, `likeness`, `pairUp`, the block model behind the rendered Markdown diff
  - `highlight.ts` — `langOf`, `hlLines`
  - `reading.ts` — `ORDER`, `groupOf`, `reading`
  - `summary.ts` — the Markdown review summary
- marked 12.0.2, DOMPurify 3.2.7 and highlight.js 11.11.1 become bundled npm dependencies at the versions the CDN
  tags pin today; their CDN tags go.
- `SERVED` and `INITIAL_STATE` reach the bundle through a JSON script (`#review-boot`), since the app is no longer
  in the same inline script as the constants. `serve.ts` still fills the state slot.
- The Playwright end-to-end script lands here and passes against the vanilla UI.

**PR B — the rework.** React + shadcn + Tailwind, the fonts, the sidebar. The same end-to-end script passes
against it, plus the sidebar checks.

## Build

- `build.ts` gets `pageBundle()`: `Bun.build({ entrypoints: [entry], target: "browser", format: "iife",
  minify: true, define: { "process.env.NODE_ENV": '"production"' } })`, in memory. The entry is `src/page/app.js`
  in PR A and `src/page/main.tsx` in PR B, which also adds `plugins: [bun-plugin-tailwind]`. It returns the JS and
  the CSS, which `buildHtml` inlines into `index.html` in the existing single-pass placeholder substitution (a
  value put in for one placeholder is never read as another).
- Inlined JS has `</script` → `<\/script` and `<!--` → `<\!--`; inlined CSS has `</style` → `<\/style`.
- Tailwind's source scan is pinned to `src/page` (`@import "tailwindcss" source(".")`), never the cwd.
- The build runs once per process. If a cold build takes over ~300 ms, cache `{js, css}` under
  `$XDG_CACHE_HOME/zreview` keyed by a hash of `src/page/**` and `package.json`.
- A missing dependency fails as a `ReviewError`: `run \`bun install\` in <checkout>`. A failed bundle fails with
  Bun's messages.
- Page dependencies are pinned exactly and live in `dependencies` (the CLI builds the page at run time):
  react, react-dom, tailwindcss, bun-plugin-tailwind, radix-ui, class-variance-authority, clsx, tailwind-merge,
  lucide-react, tw-animate-css, marked, dompurify, highlight.js. Dev only: @types/react, @types/react-dom,
  playwright-core.

## Structure (PR B)

```
src/page/
  index.html        head theme script, CDN mermaid + Monaco loader + fonts, __STYLE__, #review-data,
                    #review-boot, #root, __APP__
  main.tsx          reads the two JSON scripts, renders <App/>
  app.css           Tailwind, tw-animate-css, shadcn tokens, app tokens, fonts, scrollbars, hljs, .rd (Markdown)
  lib/              PR A's modules, plus:
    store.ts        review state + actions + persistence
    prefs.ts        UI preferences (theme, sidebar open, Markdown view): cookie first, localStorage fallback
    render-md.ts    DOM-bound Markdown rendering: renderUnit, markWords, resolveLinks, sanitizing
  hooks/            use-hash-route, use-selection-comment, use-focus-keys
  components/ui/    shadcn components, owned (added with the shadcn CLI, components.json)
  components/       app components (below)
```

App components: `App` (SidebarProvider + AppSidebar + SidebarInset + overlays), `AppSidebar`, `EdgePeek`,
`FeaturePanel`, `SinceBar`, `Prose`, `Entities` + `ExampleEditor` (Monaco), `Diagrams` + zoom `Dialog`,
`Screenshots`, `FileBlock` → `Hunks` | `RichDiff`, `CommentList`, `Composer`, `DecidePanel`, `FocusReview`.

### State and data flow

- `store.ts` holds `ReviewState` and exposes the actions the page has today: `decide`, `setNote`, `toggleViewed`,
  `addComment`, `deleteComment`, `markSeen`. Updates are immutable, so `useSyncExternalStore` sees each change.
  One `persist` side effect: served → `POST /api/state` (keepalive); static → `localStorage` under
  `zreview:<repo>#<number>`, as today.
- React state holds what the page never saved: the current feature (the URL hash, as today), expanded files,
  "show before and after", the focus-review position, the open composer, `submitted`.
- `since(feature, entry)` is memoized per feature on the entry's snapshot.
- Mermaid renders with `mermaid.render(id, source)` into a ref, re-run on theme change. Monaco mounts in an effect
  and gets `remeasureFonts()` after `document.fonts.ready`.
- Rendered Markdown and highlighted code stay HTML strings (sanitized as today), injected per block; React owns the
  rows, comment buttons and composers around them. Quoted-comment highlights are applied in an effect on the
  prose container, which resets its HTML first.

### Errors

- An error boundary around each section and each file block shows "This section failed to render" with the
  message; the rest of the page stands. The rendered Markdown view still falls back to the source diff per file.
- CDN failures degrade as today: a diagram shows its source with a note; examples stay in a `<pre>`.

## Look (PR B)

- **Fonts** from jsdelivr, pinned: `@fontsource-variable/jetbrains-mono` and `@fontsource-variable/geist`.
  `--font-mono: "JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace`;
  `--font-sans: "Geist Variable", ui-sans-serif, system-ui, sans-serif`. The body is mono at 13 px; prose
  containers are sans at 15 px, relaxed leading. Monaco uses JetBrains Mono.
- **Palette:** shadcn zinc, light and dark, plus app tokens: `--success`, `--warning`, `--info`, diff tints
  (`--diff-add-bg`, `--diff-add-gutter`, `--diff-del-bg`, `--diff-del-gutter`), `--hl`, syntax `--tk-*`.
  Dark mode keys off `[data-theme="dark"]`, stamped before paint by the head script as today.
- **Icons:** lucide replaces the emoji and glyphs (☀ ☾ 👁 ✎ ⛶ ✕ ▸).
- **Components:** Button, Badge, Tabs, Checkbox, Textarea, Card, Dialog, ToggleGroup, Tooltip, Kbd, Progress,
  ScrollArea, Separator, Sidebar (+ Sheet on phones).
- Section labels: mono, 11 px, uppercase, wide tracking, muted. Feature title: mono semibold ~22 px.

## Sidebar (PR B)

- shadcn `Sidebar` with `collapsible="offcanvas"`, controlled by `SidebarProvider`. Open or collapsed is kept in
  the `sidebar_state` cookie: each run serves on a new port, and cookies (unlike localStorage) ignore the port.
  `file://` pages fall back to localStorage. The theme choice moves to a cookie the same way.
- **Header:** the PR title (wraps); `repo#number` link · branch (truncated, full text in a tooltip) → base; the
  theme toggle; a collapse button (PanelLeftClose, tooltip "Collapse sidebar ⌘B"). The exposure note under it.
- **List:** one item per feature — number, title, then comments, files viewed, status badge (open / approved /
  changes requested / updated).
- **Footer:** the tally; Submit (served only) or the Submitted notice; Copy review summary; Export decisions.json.
- **Collapsed:** the page takes the full width; a "Show sidebar" button (PanelLeftOpen) sits at its top left; a faint
  3 × 44 px notch marks the left edge.
- **Peek:** only while collapsed, not on phones. A 12 px hot zone on the left edge; 80 ms inside it slides the
  sidebar in over the page (shadow, no layout shift). It hides 250 ms after the pointer leaves it, stays while
  focus is inside, closes on Esc. In peek, the collapse button reads "Dock sidebar" and docks it.
- **Phones (< 768 px):** shadcn's Sheet drawer and trigger; no peek.
- **Scrollbars:** the list and the focus-review file rail use shadcn `ScrollArea` (`type="hover"`, a 6 px rounded
  thumb, vertical only). Everything else gets thin themed native ones:
  `scrollbar-width: thin; scrollbar-color: var(--scrollbar) transparent`.
- **No horizontal scroll:** the ScrollArea viewport's child is forced to `display: block` (Radix sets `table`,
  which lets wide content widen the list) and the viewport hides x-overflow; every flex child has `min-w-0`;
  titles use `overflow-wrap: anywhere`; the branch truncates; badges don't shrink and wrap to the next line.

## Focus review (PR B)

A full-screen `Dialog`: a file rail (ScrollArea, grouped by reading order, ticks for viewed, comment counts,
"updated" dots), a progress bar, and a bar with position, path, "n new lines", Rendered/Source, Previous,
Forward, Looks good, Comment, close. Keys as today: → PgDn j, ← PgUp k, Enter, C, R, Esc (a composer first).

## Testing

- **Unit (`bun test`):** PR A's modules, characterization-first; PR B's store actions, persistence and prefs.
- **Build:** the page carries one inline bundle; `</script` and `<!--` are escaped; review text containing
  `__APP__`, `__STATE__` or `</script>` cannot break the page.
- **End to end (`bun run e2e`):** playwright-core driving the installed Chrome (`channel: "chrome"`) against
  `zreview review --no-open` on a fixture. Locators are roles and text, so one script checks both UIs:
  feature navigation; approve and request changes with a note; a line comment and a selected-text comment;
  viewed files; focus review keys; the diagram opening full screen; Submit printing the summary on stdout.
  PR B adds: collapse by button and by ⌘B, peek from the edge, the choice surviving a reload, and the sidebar's
  `scrollWidth <= clientWidth` with a 70-character unbreakable title, a 60-character branch and 30 features.
- **Visual:** before/after screenshots in PR B — light and dark, sidebar docked, collapsed and peeking, focus review.
