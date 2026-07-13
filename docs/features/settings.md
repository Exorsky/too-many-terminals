# Settings

The Settings button (sidebar footer, or the icon rail when collapsed) swaps the main
pane to `SettingsView`, mirroring how the History button swaps in
`SessionHistoryPanel` — terminals stay mounted but hidden underneath. Opening one
of History/Settings closes the other; selecting or spawning a tab closes both.

`SettingsView` owns its own sub-tab state (`general` | `customize`) with a small
in-component tab strip — no router, no persistence yet. Both sub-tabs are currently
placeholders; real settings/customization options will be added incrementally.

## Files

- `src/components/SettingsView.tsx` — the view + its General/Customize sub-tabs
- Wiring: `App.tsx` (`showSettings` state, mutual exclusion with `showHistory`),
  `Sidebar.tsx` (`showSettings`/`onToggleSettings` props, footer + collapsed-rail buttons)
