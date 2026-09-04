# Design

This documents the visual and interaction design system the app has converged
on — the vocabulary and decision rules a new screen should reuse, distilled
from a round of sidebar/settings/footer redesign work. It is not a feature doc
(those live under `docs/features/`) and it doesn't own the color-token
mechanics (`themes.md` does, in depth) — it's the layer above both: what the
tokens *mean*, and which UI pattern to reach for given a piece of content.

## Visual identity, in one paragraph

Dark, monospace, near-square. Every surface is `ui-monospace` — there is no
second display face, because the terminal *is* the product; chrome that tried
to look like a "normal app" next to a monospace terminal would read as a
mismatch. Corners are close to sharp (see [Shape](#shape) below), elevation is
almost always a 1px border rather than a shadow, and color is spent on
**meaning** (a status dot, a folder's identity, a selected/pinned state) far
more often than on decoration. The one place the design allows itself
ambient decoration and motion is the [Home screen](features/home-screen.md)'s
night skyline — everywhere else, chrome stays quiet on purpose so the
terminal content stays the loudest thing on screen.

## Color

`themes.ts` owns the mechanics (13 editable core colors, everything else
derived — see [themes.md](features/themes.md)). What matters for building a
new screen is what each token is *for*:

| Token | Meaning | Reused for decoration? |
|---|---|---|
| `background` / `card` | App vs. slightly-raised surface (sidebar, panels) | — |
| `border` / `border-hover` | The only elevation cue in most of the UI (1px, not shadow) | — |
| `primary` | "You selected this" — active tab, active nav row, **and** a pinned session | No |
| `muted-foreground` | Secondary text: descriptions, meta, folder chips | — |
| `success` / `warning` / `attention` / `destructive` | Session status only (idle / working / needs-you / error) | **Never** — see [Status vocabulary](#status-vocabulary) |
| `usage` | The usage-meter bar's color below the warning threshold. App chrome only, no ansi counterpart — kept separate from `primary` so a theme's accent and its "how much I've used" bar can differ | — |
| project hue (`projectHue(index)`, `PROJECT_COLORS` in `types.ts`) | Cross-folder disambiguation — a small dot next to a folder-name chip in the Pinned/Attention strips, where several folders' sessions sit in one list and the color is doing real work. **Not** shown in the folder's own header (a neutral `Folder` glyph instead) — the name right there already identifies it; a second color badge on the same row would be decoration | Never a full tinted background (see [Shape](#shape)) |

`primary` doing double duty (active state *and* pinned state) is deliberate,
not sloppy overlap: both mean "this is here because you put it here," as
opposed to `attention` (orange), which means "the app noticed this
automatically." That blue/orange split is the whole visual grammar behind the
[Pinned/Waiting-on-you pairing](#the-strip-pattern) below.

**Known inconsistency.** The "reading" accent — the cyan used for the
Preview/Split controls, the transcript reader's icon, an assistant turn's
label — is a literal `#6fd4c9` hardcoded in nine places (`TabBar.tsx`,
`SessionControls.tsx`, `SessionReader.tsx`, `SessionHistoryPanel.tsx`,
`Sidebar.tsx`, `MarkdownPane.tsx`, `TranscriptDocument.tsx`), not a CSS custom
property. `ThemeColors.cyan` exists and feeds the *terminal's* ansi cyan, but
`cssVars()` never exposes it as `--cyan` for the app shell, so switching to
the Amber/Violet/Seafoam preset does **not** recolor this accent — it stays
teal-cyan regardless of theme. Fixing it means adding a `--reading-accent` (or
reusing `--cyan`) CSS var to `themes.ts`'s `cssVars()` and swapping all nine
literals for it; left as a follow-up rather than bundled into an unrelated
change.

## Type & scale

One face everywhere: `ui-monospace, 'Cascadia Code', 'JetBrains Mono',
Consolas, monospace` (`globals.css`, `body`). There's no formal type-scale
token, but the sizes actually in use form a consistent ladder (counted across
`src/components/*.tsx`):

| Size | Used for |
|---|---|
| 9–9.5px | Fine print: kbd hints, "Built-in" badges, stale-cache notes |
| 10–10.5px | Meta text: folder chips, section eyebrows, reset countdowns |
| **11–11.5px** | **The default** — row labels, buttons, most body text |
| 12–12.5px | Panel headers, the wordmark, setting titles |
| 13–15px | Rare emphasis (dialog headings) |
| 16px+ | Rarer still — large numbers, empty-state icons |

Icon sizes follow the same rhythm: 11–12px for anything sitting inside a row
next to 11px text, 13–15px for header-level icons, 18–20px only for
empty-state or oversized decorative icons. Never mix a 15px icon into an
11px row — the row height (see below) was chosen around the smaller icon.

Row/bar heights cluster at **32px** (`h-8` — the dominant chrome height:
`SidebarFooter`'s trigger, `TabBar`) and **40px** (`h-10` —
panel headers: Settings, History, the session bar, the sidebar header itself).
Uppercase eyebrow labels
(`SETTINGS`, `PINNED`, folder-group hints) get `tracking-[0.08em]` to
`tracking-[0.16em]` and `text-muted-foreground` — never full-strength
foreground, so they read as structure rather than content.

## Shape

Radii come from one `--radius: 0.25rem` (4px) base with Tailwind's
`radius-{sm,md,lg,xl}` derived as `-4px / -2px / +0px / +4px`. In practice
that means `rounded-sm` is **visually square** (0px) — and it's the most
common radius in the codebase (32 uses vs. 21 `rounded-md`, 24 `rounded-full`,
2 `rounded-lg`). The pattern:

- **`rounded-sm` (0px)** — interactive rows and most buttons (tab rows,
  session rows, settings rows). Square by design; this is where "near-square"
  in the identity paragraph above comes from.
- **`rounded-md` (2px)** — floating surfaces: `DropdownMenuContent`,
  `ContextMenuContent`, theme cards. The only things allowed a `shadow`
  (`shadow-md`/`shadow-lg`) instead of just a border — everything anchored to
  the page stays flat; only things that float above it get depth.
- **`rounded-full`** — dots (status, folder hue, pin count), badges, switches.
- **`rounded-lg` (4px)** — rare, a couple of larger containers.

A session row is **never** wrapped in its own tinted, bordered card — that was
the pre-redesign look (a colored box per folder) and read as busy once more than
three or four were open. A row stays borderless and flat, differing from its
neighbours only by a hover/active background tint (`hover:bg-white/4`,
`bg-white/6`–`bg-white/8` for active/selected).

Two passes were spent learning where a status *may* spend shape. The first gave
a folder holding a live session a soft status-colored border and tint, on the
grounds that a card which only exists while it's true is a status signal wearing
the same shape. The reasoning held; the shape didn't scale — a dozen folders
meant a dozen boxes appearing and vanishing, and the tint said only *that*
something was live, never how much. The second replaced it with a per-folder
ribbon of segments. That went too when the folder groups themselves did (see
[terminals.md](features/terminals.md#the-session-list)). What survived is the
thinnest mark of the three:

- **A row's [spine](features/terminals.md#row-spine)** — a 2px bar on the left
  edge, drawn only for `requires_response` and `working`, so live sessions form
  one column of color down an otherwise flat list. Quiet rows have no spine,
  which is what makes the ones that do have one worth looking at.

It follows the same rule the tint did — gated on state that changes on its own —
without introducing a shape that competes with the rows it sits among. The
lesson worth keeping: when a status wants to be visible, spend **one thin mark
inside the existing row**, not a container around it.

**Identity gets color, not shape.** A folder's hue (`projectHue(index)`) marks
it as a dot on a row's second line and as the border-and-tint of its
[selected pill](features/terminals.md#folders-are-a-filter-not-a-heading). The
pill is the one place identity is allowed a filled shape, and only while
selected — a neutral white tint there was invisible against unselected pills
that all carry the same bright dot, and the hue was already doing this exact job
two pixels away.

## Iconography

`lucide-react` exclusively — no custom SVGs, no icon font. Stroke icons only
(no filled variants) with two deliberate exceptions that carry real meaning
rather than decoration:

- `Loader2` **spins** (`animate-spin`) — a session mid-turn.
- The "needs you" icons (`MessageCircle`, the attention dot) **pulse**
  (`animate-pulse`) — reserved for things that are actually waiting on a
  human, never used decoratively elsewhere.

Both respect `prefers-reduced-motion` where they appear inside larger
animated surfaces (see [home-screen.md](features/home-screen.md)); the two
bare `animate-spin`/`animate-pulse` utility classes on status icons are cheap
enough that no explicit override was added, but a future audit should confirm
that's still true if more motion gets added elsewhere.

## Status vocabulary

One place defines what a session's live state looks like —
`TabIndicator` in `Sidebar.tsx`, reused everywhere a status needs to render
(sidebar rows, the collapsed rail, the command palette, the session bar):

| State | Icon | Color | Meaning |
|---|---|---|---|
| `dormant` (overrides status) | `Moon` | muted | Restored or auto-slept — no live process behind it |
| `working` | `Loader2`, spinning | `warning` | Claude is mid-turn |
| `idle` | `CheckCircle2` | `success` | Finished, nothing pending |
| `requires_response` | `MessageCircle`, pulsing | `attention` | Blocked on you — the only state allowed to chase you (see the strip below) |
| `new` | `Circle` | muted | Just spawned, no status yet |

These four colors are **reserved** for this vocabulary. Nothing else in the
UI reuses `success`/`warning`/`attention`/`destructive` for decoration —
if a color looks like a status color, it must mean a status.

The worked example is the folder row's `.env` key glyph
([env-loading.md](features/env-loading.md)): "this folder hands credentials to
its sessions" is a tempting thing to paint orange, but it's *metadata about a
folder*, not a live state of a session, so it's drawn in `muted-foreground`
like the session count beside it. When a new signal wants a status color, the
question to ask first is whether it changes on its own — the four above all do.

## Interaction patterns: which shape for which content

The redesign work this round kept running into the same question — *tabs,
a rail, a menu, or a context menu?* — for four different screens. The answer
came down to what kind of content is involved, not taste:

- **A handful of real, distinct categories the user picks one of at a time**
  → a **left rail**, each category its own screen. Settings' Interface /
  Notifications / Sessions / Customize (see [settings.md](features/settings.md))
  — these are genuinely different topics, not variations on one thing, and a
  flat scrolling list mixing all four is what "everything in a pile" meant
  before the redesign.
- **Peers the user actively switches between while working** → a **tab
  strip**, not a rail. Open terminal/file tabs are equals you bounce between
  mid-task; a rail would frame them as categories, which they aren't.
- **One thing that's always glanceable plus a couple of rarely-used
  actions** → collapse the actions behind a **single trigger + menu**, keep
  the glanceable part always visible. `SidebarFooter` is the model: both
  usage percentages sit in the open, Search/History/Settings live behind one
  "⋯" (see [usage-meter.md](features/usage-meter.md)) — two separately
  hoverable icons would cost the same information for more permanent chrome.
  Home, Files and the collapse toggle sit beside it as always-visible squares:
  those are destinations you bounce between while working, not detours. The
  footer is where all of it ended up once both rows at the top of the sidebar
  were spent on the list itself — app chrome at the bottom, the list at the
  top, one question per row.
- **An action that applies to one specific item, only sometimes** → the
  item's own **right-click context menu**, not a new always-visible hover
  icon. Pin/unpin went through several drafts (a hover pin icon, a corner
  badge) before landing here, next to Rename/Open directory/Close — one menu
  to check instead of a growing row of hover-only icon buttons.
- **A cross-cutting collection that isn't a folder** → a **count that filters
  the one list**, not a second copy of it above the first. See below.
- **A grouping the user thinks in but doesn't read top-to-bottom** → a **row
  of filter pills**, not nested groups. Folders went from collapsible
  headings to pills for exactly this: a heading costs a row (plus its own
  "New session" row) whether or not you are looking inside it, while a pill
  costs a fifth of one and answers "which folders are open" at a glance. Use
  a heading only when the group's contents are read as a set.

## The ledger pattern

Pinned, "Waiting on you" and "Just finished" were each a **strip**: a one-line
header with an icon, a label and a live count badge; a list capped at a max
height; `shrink-0` so it never scrolled away; and `return null` when empty, so
the empty state *was* the strip's absence. The rule for a fourth strip was to
keep asking who filled it — a person (→ `primary`) or the app (→ whichever
reserved status color matched what it was reporting).

That rule was right and the shape was wrong, and it took three strips to see
why: **every session in a strip also rendered in its folder below.** n sessions
cost up to 2n rows, the folder list got whatever three capped strips left over,
and the fix each time a strip felt cramped was to raise its `max-h`, which took
the space from the list it was already duplicating. The pattern got worse with
exactly the thing it was meant to help with.

The replacement keeps the diagnosis and drops the duplication. A cross-cutting
collection becomes **one chip in a lens row** — icon, live count, the color its
status already owns — and clicking it *filters* the single list instead of
prepending a copy of part of it (`SidebarLens` in `Sidebar.tsx`, see
[attention-inbox.md](features/attention-inbox.md)). What survives from the strip
pattern:

- **A live count, always visible, never scrolling.** Above the scroll
  container, `shrink-0` — same as the strip headers were.
- **The empty state is absence.** A chip renders only while its count is
  non-zero, exactly as a strip returned `null`.
- **The color question is unchanged.** Did a person ask for this
  (→ `primary`, as `pinned` is), or did the app notice it (→ the reserved
  status color that matches — `attention`, `warning`, `success`)?

What's new is that adding a fifth collection now costs one chip and no vertical
space at all, and that the filtered view gets the *whole* sidebar rather than a
38vh box. The one thing genuinely lost is seeing two collections at once; in
practice the ledger's counts already answer "is there anything in the other
one", which is what glancing at two strips was for.

A filtered view is a **momentary lens**, so none of the three filters persist —
chip, query, or selected folder. Anything a person arranges deliberately —
pinning, which folders are open and in what order — does. That split is the same
`primary`-vs-status question asked about state instead of color.

The lens does have to **say what it is**, though. Three filters that compose can
leave a list quietly shorter for a reason that has scrolled out of view, so
whatever is active reads out in one line above the list, and clearing is one
button that clears all three.

## Discoverability

If a feature only exists behind a keyboard shortcut, it needs a visible
entry point somewhere a mouse can find it — a shortcut alone is not
discoverable. The command palette existed for a while as Ctrl+Shift+P only;
the search icon button in the sidebar header
(see [command-palette.md](features/command-palette.md)) is the fix, and the
same question is worth asking of any future shortcut-only feature.

## Shipped: the session bar → tab strip redesign

The terminal's own top chrome (`TabBar.tsx`, formerly `SessionBar.tsx`) went
through a critique-and-mockup round and has since been rebuilt — worth
recording the reasoning so a future pass doesn't re-litigate it from scratch:

- **One identity, shown once.** The tab strip and the old session bar both
  rendered the active session's name/folder/status — the same information
  twice, stacked in two rows. The session bar is gone; the tab strip is enough.
- **Terminal/Split/Markdown was one three-way switch; it's now two
  independent controls.** `SessionControls` docks a **Preview** toggle
  (terminal ⇄ markdown, on/off) to the tab strip's trailing edge, plus a
  separate **Split** menu (**Split right** / **Split down**) that's its own
  layout choice rather than a third state of Preview — Split runs alongside
  whichever mode Preview is in, and disables Preview only because the pane
  split already answers "what's showing." This is one step further than the
  originally-mocked 3-icon toggle: that mockup still treated Split as a mode
  of the same switch, which is what made "put the split anywhere" awkward to
  express. Splitting it into two controls is what let a second axis (right vs.
  down) get added without a fourth/fifth toggle state.
- **Markdown's own controls (turn count, Rendered/Raw, copy, refresh) moved
  into `MarkdownPane`'s own header**, next to the label it already shows in
  Split mode, instead of the global session bar — they only ever act on that
  pane, so they belong on it.

See [session-reader.md](features/session-reader.md#session-controls) for the
shipped shape.

## Files

- `src/globals.css`, `src/lib/themes.ts` — token mechanics (see
  [themes.md](features/themes.md))
- `src/components/Sidebar.tsx` — `TabIndicator` (status vocabulary),
  `bucketsOf`/`SidebarLens` (the ledger pattern), `FolderBar`/`FolderPill`
  (grouping as a filter), `spineClass` and `RowMeta` (shape rules)
- `src/components/SidebarFooter.tsx` — the menu-over-persistent-chrome pattern
- `src/components/SettingsView.tsx` — the left-rail pattern
- `src/types.ts` — `PROJECT_COLORS`, `projectHue`
