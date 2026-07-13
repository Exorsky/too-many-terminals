# Settings

The Settings button (sidebar footer, or the icon rail when collapsed) swaps the main
pane to `SettingsView`, mirroring how the History button swaps in
`SessionHistoryPanel` — terminals stay mounted but hidden underneath. Opening one
of History/Settings closes the other; selecting or spawning a tab closes both.

`SettingsView` owns its own sub-tab state (`general` | `customize`) with a small
in-component tab strip — no router. General is still a placeholder; Customize
hosts the theme system (see [themes.md](themes.md)).

## Files

- `src/components/SettingsView.tsx` — the view + its General/Customize sub-tabs
- `src/components/CustomizeTab.tsx` — theme picker/editor (Customize sub-tab)
- Wiring: `App.tsx` (`showSettings` state, mutual exclusion with `showHistory`),
  `Sidebar.tsx` (`showSettings`/`onToggleSettings` props, footer + collapsed-rail buttons)
