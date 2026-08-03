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
| project hue (`projectHue(index)`, `PROJECT_COLORS` in `types.ts`) | A folder's identity — one small dot, cycling blue→green→orange→purple→teal→red→pink→yellow in the order folders were added | Never a full tinted background (see [Shape](#shape)) |

`primary` doing double duty (active state *and* pinned state) is deliberate,
not sloppy overlap: both mean "this is here because you put it here," as
opposed to `attention` (orange), which means "the app noticed this
automatically." That blue/orange split is the whole visual grammar behind the
[Pinned/Waiting-on-you pairing](#the-strip-pattern) below.

**Known inconsistency.** The "reading" accent — the cyan used for the
Markdown/Split toggle, the transcript reader's icon, an assistant turn's
label — is a literal `#6fd4c9` hardcoded in nine places (`TabBar.tsx`,
`SessionBar.tsx`, `SessionReader.tsx`, `SessionHistoryPanel.tsx`,
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
`SidebarFooter`'s trigger, the search row, `TabBar`) and **40px** (`h-10` —
panel headers: Settings, History, the session bar). Uppercase eyebrow labels
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

A folder or session row is **never** wrapped in its own tinted, bordered
card — that was the pre-redesign look (a colored box per folder) and reads as
busy once more than three or four are open. Color marks identity as one small
dot; the row itself stays borderless and flat, differing from its neighbors
only by a hover/active background tint (`hover:bg-white/4`,
`bg-white/6`–`bg-white/8` for active/selected).

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
  usage percentages sit in the open, History/Files/Settings live behind one
  "⋯" (see [usage-meter.md](features/usage-meter.md)) — three separately
  hoverable icons would cost the same information for more permanent chrome.
- **An action that applies to one specific item, only sometimes** → the
  item's own **right-click context menu**, not a new always-visible hover
  icon. Pin/unpin went through several drafts (a hover pin icon, a corner
  badge) before landing here, next to Rename/Open directory/Close — one menu
  to check instead of a growing row of hover-only icon buttons.
- **A cross-cutting collection that isn't a folder** → a **strip** above the
  regular list. See below.

## The "strip" pattern

Pinned and "Waiting on you" ([attention-inbox.md](features/attention-inbox.md))
are the same shape on purpose:

- A one-line header: icon, label, a live count badge.
- A scrollable list capped at a max height, so a long queue never pushes the
  folder list off-screen.
- Returns `null` (zero height, zero cost) when empty — the empty state *is*
  the strip's absence, never a "nothing here" placeholder.
- `shrink-0`, fixed between the header/search row and the scrolling folder
  list, so it never scrolls away.

The only difference is who fills it and what color that implies: **Pinned**
is user-controlled and rendered in `primary` blue; **Waiting on you** fills
itself from live session state and is rendered in `attention` orange. Building
a third strip later ("just finished," a per-repo queue, whatever) should copy
this shape exactly and pick the color from that same rule — did a person ask
for this, or did the app notice it?

## Discoverability

If a feature only exists behind a keyboard shortcut, it needs a visible
entry point somewhere a mouse can find it — a shortcut alone is not
discoverable. The command palette existed for a while as Ctrl+Shift+P only;
the "Search sessions" row at the top of the sidebar
(see [command-palette.md](features/command-palette.md)) is the fix, and the
same question is worth asking of any future shortcut-only feature.

## Explored, not yet built

The terminal's own top chrome (`TabBar.tsx` + `SessionBar.tsx`) went through
the same critique this round but wasn't implemented — worth recording so a
future pass doesn't re-litigate it from scratch:

- **One identity, shown once.** Today the tab strip and the session bar both
  render the active session's name/folder/status — the same information
  twice, stacked in two rows. The validated direction: drop the second row;
  the tab strip is enough.
- **The Terminal/Split/Markdown toggle moves into that same row** as three
  icon-only buttons (no labels, tooltip on hover) docked to the tab strip
  that already scopes it, instead of a whole second bar just to hold a
  3-way switch.
- **Markdown's own controls (Rendered/Raw, copy, refresh) move into
  `MarkdownPane`'s own header**, next to the label it already shows in Split
  mode, instead of the global session bar — they only ever act on that pane,
  so they belong on it.

This is a real, agreed direction (worked through as an interactive mockup),
just not yet ported into `TabBar.tsx`/`SessionBar.tsx`/`MarkdownPane.tsx` —
treat it as the next redesign pass on this codebase, not a rejected idea.

## Files

- `src/globals.css`, `src/lib/themes.ts` — token mechanics (see
  [themes.md](features/themes.md))
- `src/components/Sidebar.tsx` — `TabIndicator` (status vocabulary),
  `PinnedStrip`/`AttentionStrip` (the strip pattern), folder-group rows
  (shape rules)
- `src/components/SidebarFooter.tsx` — the menu-over-persistent-chrome pattern
- `src/components/SettingsView.tsx` — the left-rail pattern
- `src/types.ts` — `PROJECT_COLORS`, `projectHue`
