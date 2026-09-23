# Design

This documents the visual and interaction design system the app has converged
on — the vocabulary and decision rules a new screen should reuse, distilled
from a round of sidebar/settings/footer redesign work. It is not a feature doc
(those live under `docs/features/`) and it doesn't own the color-token
mechanics (`themes.md` does, in depth) — it's the layer above both: what the
tokens *mean*, and which UI pattern to reach for given a piece of content.

## Visual identity, in one paragraph

Dark, near-square, two faces. The chrome is the system sans
(`ui-sans-serif`/SF Pro Text/Segoe UI); the terminal, and anything that has to
line up in a column — timestamps, counts, paths, key hints — stays
`ui-monospace`. This reverses an earlier decision that the whole app should be
monospace because "the terminal *is* the product". It held while the app was a
terminal with a tab strip; it stopped holding once the chrome grew a task list,
a session ledger and inspectors, where monospace costs horizontal room and
flattens the difference between a name and its metadata. Making the terminal
the *only* monospaced surface is what now marks it as the content. Corners are close to sharp (see [Shape](#shape) below), elevation is
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
| `dim` | The tier between `foreground` and `muted-foreground`: a row's own name when the row isn't selected. Derived, not editable — `mix(background, foreground, 0.72)` | — |
| `muted-foreground` | Metadata: timestamps, counts, section labels, folder chips | — |
| `faint` | The punctuation *between* metadata — the `·` separators, an empty-slot placeholder. Never a word you have to read; `mix(background, mutedForeground, 0.55)` | — |
| `hover` / `raised` / `selected` / `selected-hover` | The four row states, as white overlays at 4% / 5.5% / 7.5% / 9.5%. Every hoverable row, ghost button and tab uses these and nothing else | — |
| `success` / `warning` / `attention` / `destructive` | Session status only (idle / working / needs-you / error) — traffic-light order, see [Status vocabulary](#status-vocabulary) | **Never** |
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

Two faces, both declared as tokens in `globals.css`'s `@theme`:
`--font-sans` for the chrome (the `body` default) and `--font-mono`
(`Cascadia Code`/`JetBrains Mono`) reached through Tailwind's `font-mono`.
The rule for which: **monospace is for things that line up or get typed** —
timestamps, counts, durations, paths, `⌘K` hints, transcript text. Everything
you read as prose is sans. In practice `font-mono` travels with
`tabular-nums`; if you're adding one without the other, check you meant to.

The sizes in use form a consistent ladder (counted across
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

### Text tiers

Four, and a row is expected to use at least two of them — a name level with its
own timestamp is the single most common way a dense list stops being scannable:

| Tier | Token | What it holds |
|---|---|---|
| 1 | `foreground` | The selected row; the thing you're working on |
| 2 | `dim` | An unselected row's own name |
| 3 | `muted-foreground` | Timestamps, counts, section labels, status words |
| 4 | `faint` | Separators and placeholders — decoration, not content |

Ad-hoc opacities (`text-muted-foreground/60` and friends) are not a fifth tier.
They were how tiers 3 and 4 used to be spelled, and they drifted to seven
different values reaching as low as 1.7:1 contrast.

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
neighbours only by a hover/active background tint (`hover:bg-hover`,
`bg-selected` for active/selected, `bg-selected-hover` when it's both). Those
are tokens rather than literals on purpose: the same four overlays were once
fourteen hand-written whites between `bg-white/[0.008]` and `bg-white/10`, which
is how a "selected" row in one panel came to look like a "hover" row in
another.

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

## Buttons and focus

Most of what looks like a button in this app is a bare `<button>` with a class
string, not a component — `ui/button.tsx` exists but speaks shadcn's vocabulary
(`text-sm`, `rounded-md`) rather than this app's. Three shapes recur often
enough to be shared from `lib/utils.ts`, as strings the call site composes with
`cn()` and its own sizing:

| Constant | Shape |
|---|---|
| `ICON_BUTTON` | Square, centered, icon-only, ghost. Call site sets `w-5 h-5` or `w-6 h-6` |
| `ACTION_ROW` | Full-width left-aligned row: an inspector's action list, a sidebar footer row |
| `ACTION_ROW_DANGER` | The same, `destructive` — muted until hovered, so a Delete at the bottom of a list isn't the loudest thing in it |

They're strings and not a component on purpose: every call site already wraps
them in `cn()` and supplies its own height and padding, so a wrapper would exist
only to forward props straight through. What they buy is agreement — one place
that decides what a ghost hover looks like.

Bordered buttons (`border-border` + `hover:border-border-hover`) are the
secondary variant, used where something needs to look pressable against an empty
area: **New task**, **Create task**, the Retry in an error state. There is no
filled/primary variant anywhere in the chrome. `primary` is a *state* color here
(see [Color](#color)) and spending it on a button would put it in competition
with the selected row it's supposed to mark.

**Focus is restyled, never removed.** `globals.css` gives `:focus-visible` a 2px
`--ring` outline inset by 1px, so a ring on a 26px row doesn't clip its
neighbour. An input that wants a border-based focus instead opts out with
`outline-none` — utilities win over base — but nothing may simply have no focus
treatment. Before this, most custom buttons had none at all.

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
- **App-level destinations, next to a screen that isn't about them** → a
  **vertical rail** beside the content, not a band above or below it. The
  sidebar's Home / Search / History / Files / Settings / collapse squares live
  in a 44px rail (see
  [terminals.md](features/terminals.md#the-rail-folders-and-navigation)) for
  one reason: none of them is a question about *the session list*, so none
  should cost the list a row. The same rail holds the open folders, which was
  the bigger win — as a wrapping row of pills their band was 34px tall with
  three folders and 90px with eight, so the list jumped every time a project
  was opened. A column grows into space that was already empty.
- **A measurement worth glancing at** → give it **words**, or don't show it.
  `SidebarFooter` spent a round as `⚡ 42%  📅 18%` with the labels, bars and
  countdowns folded into a "⋯" menu; that saved 20px and produced two numbers
  nobody could tell apart. It is now two labeled rows — window, bar,
  percentage, countdown (see [usage-meter.md](features/usage-meter.md)). A
  meter you have to decode is not a meter.
- **A second signal on the same mark** → a **different channel**, never a
  second meaning for the color. The usage bar's pace mark (where the clock
  stands in the window) is a hairline, not a recolor: color already carries
  the 70/90 thresholds, and a threshold warns while a mark informs.
- **A set of things too small to label individually** → keep the small form and
  add a **flush hover panel that labels the whole set at once**, not a tooltip
  per item. The sidebar rail's folder names work this way (see
  [terminals.md](features/terminals.md#the-name-panel)): a tooltip answers
  "what is this one", but the question a rail of abbreviations actually raises
  is "which of these two", and that needs them side by side. Three rules make
  it behave: the panel is **flush** against what it labels, so the pointer never
  crosses a gap (no safe-triangle hack); hover waits **300ms** while focus opens
  it instantly; and its rows share the pitch of the things they label, so each
  label lands beside its own item and the item serves as that row's icon. Note
  what this pattern does *not* excuse — an item still has to be recognizable
  without the gesture, so the panel is a supplement to a legible glyph, never a
  substitute for one.
- **An action that applies to one specific item, only sometimes** → the
  item's own **right-click context menu**, not a new always-visible hover
  icon. Pin/unpin went through several drafts (a hover pin icon, a corner
  badge) before landing here, next to Rename/Open directory/Close — one menu
  to check instead of a growing row of hover-only icon buttons.
- **A cross-cutting collection that isn't a folder** → a **count that filters
  the one list**, not a second copy of it above the first. See below.
- **A grouping the user thinks in but doesn't read top-to-bottom** → a
  **filter control**, not nested groups. Folders went from collapsible
  headings to pills to rail squares for exactly this: a heading costs a row
  (plus its own "New session" row) whether or not you are looking inside it,
  while a filter costs a fraction of one and answers "which folders are open"
  at a glance. Use a heading only when the group's contents are read as a set.
- **The one control that creates rather than narrows** → give it a **row in
  the list's own rhythm**, and make it name what it will create. The sidebar's
  "New session · api" row sits directly on the list, same width and height as
  a session, dashed instead of filled. Everything else above the list narrows
  it; this is the exception, so it looks like the thing it makes rather than
  like the chrome around it. Two creating controls never share a corner —
  "add folder" is a square in the rail against the folders, "new session" is
  a row against the sessions.

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

### A mark that must not be missed → take it away from everything else

With one terminal on screen, which pane has the keyboard is never a question.
With four, it is the only question that matters — in a text editor a misplaced
keystroke lands in an undoable buffer, here it lands in a live Claude session.

The answer is **subtraction, not addition**. The active tab's 2px cyan rule
renders only in the focused pane; unfocused strips drop to 60%. An unfocused
pane keeps its notch (`bg-background` against the strip's `bg-card`), so you can
still read what it is showing — it just gives up the accent. Nothing new is
drawn, no reserved status colour is borrowed, and exactly one thing on screen
wears cyan.

The alternatives were both additions that this system forbids: a border or ring
around the focused pane wraps a thing in its own tinted bordered card (the rule
above), and a second accent colour would collide with the status vocabulary.
When every pane can carry the same mark, the way to make one pane's mark mean
something is to withhold it from the others.

### A drop that changes the layout → show the shape, not a hint

Dragging a tab onto a pane highlights **the literal region the pane will
become**: half for an edge, the whole pane for a move into its strip.
`bg-primary/12` with a `1px border-primary` — `primary` because it means "you
put this here", the same reason it carries the tab strip's insertion line and
the sidebar's drop line.

When a split has no room (a pane already one cell wide, or the fourth pane), the
highlight shows the **whole** pane, because a move is what will actually happen.
The affordance never promises a layout the model won't produce, which is why
there is no disabled-looking zone and no error to explain.

The zones exist **only while a drag is in flight**. A permanent invisible
overlay would sit between the pointer and the terminal.

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
- `src/components/PaneView.tsx`, `src/components/PaneDropZones.tsx`,
  `src/components/Seam.tsx` — the pane grid's focus rule, drop affordance and
  seam (see [panes.md](features/panes.md))
- `src/components/SidebarFooter.tsx` — the menu-over-persistent-chrome pattern
- `src/components/SettingsView.tsx` — the left-rail pattern
- `src/types.ts` — `PROJECT_COLORS`, `projectHue`
