# Themes

Settings › General › Appearance hosts the theme system: built-in presets —
dark and light — plus user-created and imported custom themes. A theme recolors both the app shell (CSS custom
properties) and every terminal (xterm `ITheme`), live and across restarts.

## Data model

A theme is 14 editable core colors (`ThemeColors` in `src/lib/themes.ts`):
background, foreground, card, border, primary (accent), blue (ansi blue — its
own color since 0.28, because a scheme's blue is rarely its accent — Gruvbox's
accent is orange; custom
themes saved before then fill it from their accent), mutedForeground,
`usage` (the usage meter's bar — app chrome with no ansi counterpart, which
is why it isn't just reused from primary; defaults to each preset's own accent
so it's coherent out of the box), and the terminal palette (destructive/red,
success/green, warning/yellow, magenta, cyan, selection). Everything else is
**derived** so custom themes stay coherent:

- Surfaces: `--muted` / `--accent` / `--secondary` are lerps from background
  toward foreground (`mix()`, ratios chosen to reproduce the original
  hand-picked palette); `--border-hover` from border toward foreground.
- On-color foregrounds (`--primary-foreground` etc.) = background;
  surface foregrounds = foreground; `--ring` = primary; `--input` = border;
  `--attention` = warning/destructive midpoint.
- xterm: bright colors reuse the normal ones, `brightBlack` = mutedForeground,
  `brightWhite` = `#ffffff`, cursor = primary.
- `--prose` (Markdown body text), `--cyan` and `--magenta` (transcript
  accents, inline code) — so rendered Markdown follows the theme too.

### Light themes

Light or dark isn't a flag: `isLight` reads the background's luminance, so a
custom theme can't claim one and paint the other. A light theme flips three
things: the row overlays (`--hover`, `--selected`…) are black instead of white
— white on white vanishes; ansi black becomes the ink and white the paper
(`black` = foreground, `brightWhite` = background), or `ls` prints invisible
text; Mermaid diagrams and the file editor use their light looks; links use
the theme's blue; the webview's `color-scheme` flips so native controls and
scrollbars match; and xterm gets a 4.5 minimum contrast ratio, so text a
program colored for a dark terminal (white, or Claude Code's default dark
`/theme`) is nudged readable. For the best result, also switch Claude Code's
own `/theme` to light.

Built-in presets (`PRESETS`): **Default** (the original look — its values also
ship as the static `:root` in `globals.css`), **Classic blue**, **Amber**,
**Violet**, **Seafoam**, and fifteen well-known palettes taken from each
project's own terminal extras: Catppuccin Mocha / Latte, Tokyo Night, Gruvbox
Dark, Nord, Rosé Pine / Dawn, Dracula, Solarized Dark / Light, GitHub Dark /
Light, One Dark, Kanagawa Wave, Everforest Dark. App surfaces (card, border)
come from each theme's own panel and border roles. A test keeps every preset's
text tiers ordered (dim → muted → faint, away from the background) — GitHub
Light uses `fg.subtle` for muted text because its `fg.muted` is louder than
the derived dim tier.

## Importing a scheme

**Import…** takes a pasted color scheme in any of four formats — Windows
Terminal JSON, Ghostty, kitty, Alacritty TOML — which between them cover
nearly every published scheme (iTerm2-Color-Schemes ships all four).
`parseScheme` (`src/lib/theme-import.ts`) needs a background, a foreground and
ansi 1–6; card and border are derived from background → foreground, the accent
is the scheme's blue, muted text is its bright black unless that vanishes into
the background. The result opens in the editor, since derived surfaces are a
guess worth checking.

## Applying a theme

`applyTheme(theme)` is module-level (no React state): it sets the CSS variables
on `document.documentElement` and mutates `term.options.theme` on every cached
xterm instance in `terminalCache`, so hidden tabs recolor too. New terminals
pick up the active theme via `getActiveXtermTheme()` (`Terminal.tsx`).

On startup `main.tsx` loads settings and applies the saved theme **before**
first render, so non-default themes don't flash the Default palette.

## Persistence

Stored in `<config>/too-many-terminals/settings.json` (next to
`workspace.json`, but a separate file — the workspace one is rewritten on every
tab change). Rust side (`src-tauri/src/settings.rs`) mirrors `workspace.rs`:
`AppSettings { selectedThemeId, customThemes }`, load falls back to defaults on
a missing/corrupt file. Custom themes are stored as **opaque JSON** — the
frontend owns the shape and validates on load with `sanitizeCustomThemes`
(drops garbage entries, fills missing/invalid colors from Default).
`resolveTheme` falls back to Default for unknown ids (e.g. a deleted theme).

## UI (`src/components/CustomizeTab.tsx`)

- Two card grids, Dark and Light, of presets + custom themes: name, five swatch dots, "Built-in"
  badge or edit/delete buttons, duplicate button on every card. Clicking a
  card applies and persists immediately.
- "New theme" duplicates the currently selected theme into an editable copy.
- The editor (inline, custom themes only): name field + 13 color inputs with
  live preview on every change; **Save** persists, **Delete** removes the
  theme and falls selection back to Default. Built-ins are read-only.

## Files

- `src/lib/themes.ts` — types, presets, derivations, `applyTheme`, sanitizing
- `src/lib/theme-import.ts` (+ tests) — pasted schemes → theme colors
- `src/components/CustomizeTab.tsx` — picker + editor UI
- `src-tauri/src/settings.rs` — settings.json load/save; commands in
  `commands.rs` (`load_settings`/`save_settings`), wrappers in `src/lib/ipc.ts`
- `src/main.tsx` — applies the saved theme before first paint
