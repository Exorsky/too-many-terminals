# Themes

Settings → Customize hosts the theme system: four built-in presets plus
user-created custom themes. A theme recolors both the app shell (CSS custom
properties) and every terminal (xterm `ITheme`), live and across restarts.

## Data model

A theme is 12 editable core colors (`ThemeColors` in `src/lib/themes.ts`):
background, foreground, card, border, primary (accent), mutedForeground, and
the terminal palette (destructive/red, success/green, warning/yellow, magenta,
cyan, selection). Everything else is **derived** so custom themes stay
coherent:

- Surfaces: `--muted` / `--accent` / `--secondary` are lerps from background
  toward foreground (`mix()`, ratios chosen to reproduce the original
  hand-picked palette); `--border-hover` from border toward foreground.
- On-color foregrounds (`--primary-foreground` etc.) = background;
  surface foregrounds = foreground; `--ring` = primary; `--input` = border;
  `--attention` = warning/destructive midpoint.
- xterm: bright colors reuse the normal ones, `brightBlack` = mutedForeground,
  `brightWhite` = `#ffffff`, cursor and ansi blue = primary.

Built-in presets (`PRESETS`): **Default** (the original look — its values also
ship as the static `:root` in `globals.css`), **Amber**, **Violet**, **Seafoam**.

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

- Card grid of presets + custom themes: name, five swatch dots, "Built-in"
  badge or edit/delete buttons, duplicate button on every card. Clicking a
  card applies and persists immediately.
- "New theme" duplicates the currently selected theme into an editable copy.
- The editor (inline, custom themes only): name field + 12 color inputs with
  live preview on every change; **Save** persists, **Delete** removes the
  theme and falls selection back to Default. Built-ins are read-only.

## Files

- `src/lib/themes.ts` — types, presets, derivations, `applyTheme`, sanitizing
- `src/components/CustomizeTab.tsx` — picker + editor UI
- `src-tauri/src/settings.rs` — settings.json load/save; commands in
  `commands.rs` (`load_settings`/`save_settings`), wrappers in `src/lib/ipc.ts`
- `src/main.tsx` — applies the saved theme before first paint
