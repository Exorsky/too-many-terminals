import { useEffect, useState } from 'react';
import { Check, Copy, Import, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { confirmAction } from '@/lib/confirm';
import { loadSettings, patchSettings } from '@/lib/settings-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  applyTheme,
  DEFAULT_THEME,
  isLight,
  PRESETS,
  statusColors,
  resolveTheme,
  sanitizeCustomThemes,
  THEME_COLOR_KEYS,
  THEME_COLOR_LABELS,
  type Theme,
  type ThemeColors,
} from '@/lib/themes';
import { parseScheme } from '@/lib/theme-import';

/** Swatch colors shown on each theme card. */
function swatches(c: ThemeColors): string[] {
  return [c.background, c.card, c.primary, c.foreground];
}

export default function CustomizeTab() {
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState('default');
  const [customThemes, setCustomThemes] = useState<Theme[]>([]);
  /** Id of the custom theme open in the editor, or null when closed. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The import panel: null when closed, else the pasted text. */
  const [importText, setImportText] = useState<string | null>(null);
  const [importError, setImportError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then((settings) => {
        if (cancelled) return;
        setSelectedId(settings.selectedThemeId);
        setCustomThemes(sanitizeCustomThemes(settings.customThemes));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Merge through the store so theme writes preserve the UI prefs (and vice versa).
  const persist = (id: string, customs: Theme[]) => {
    patchSettings({ selectedThemeId: id, customThemes: customs });
  };

  const selectTheme = (theme: Theme) => {
    applyTheme(theme);
    setSelectedId(theme.id);
    if (theme.builtIn || theme.id !== editingId) setEditingId(null);
    persist(theme.id, customThemes);
  };

  const duplicateTheme = (source: Theme) => {
    const copy: Theme = {
      id: crypto.randomUUID(),
      name: `${source.name} copy`,
      builtIn: false,
      colors: { ...source.colors },
    };
    const customs = [...customThemes, copy];
    setCustomThemes(customs);
    setSelectedId(copy.id);
    setEditingId(copy.id);
    applyTheme(copy);
    persist(copy.id, customs);
  };

  /** A pasted scheme becomes a custom theme, selected and open in the editor
   *  — derived surfaces are a guess worth checking. */
  const importScheme = () => {
    const parsed = parseScheme(importText ?? '');
    if (!parsed) { setImportError(true); return; }
    const theme: Theme = { id: crypto.randomUUID(), name: parsed.name ?? 'Imported theme', builtIn: false, colors: parsed.colors };
    const customs = [...customThemes, theme];
    setCustomThemes(customs);
    setSelectedId(theme.id);
    setEditingId(theme.id);
    applyTheme(theme);
    persist(theme.id, customs);
    setImportText(null);
    setImportError(false);
  };

  const editTheme = (theme: Theme) => {
    // Editing selects the theme so color changes live-preview on the app.
    applyTheme(theme);
    setSelectedId(theme.id);
    setEditingId(theme.id);
    persist(theme.id, customThemes);
  };

  const updateEditing = (patch: Partial<Theme> | { color: [keyof ThemeColors, string] }) => {
    setCustomThemes((customs) =>
      customs.map((t) => {
        if (t.id !== editingId) return t;
        const next: Theme =
          'color' in patch
            ? { ...t, colors: { ...t.colors, [patch.color[0]]: patch.color[1] } }
            : { ...t, ...patch };
        applyTheme(next);
        return next;
      }),
    );
  };

  const saveEditing = () => {
    persist(selectedId, customThemes);
    setEditingId(null);
  };

  const deleteTheme = async (theme: Theme) => {
    if (!await confirmAction({ title: `Delete the "${theme.name}" theme?`, confirmLabel: 'Delete theme' })) return;
    const customs = customThemes.filter((t) => t.id !== theme.id);
    setCustomThemes(customs);
    if (editingId === theme.id) setEditingId(null);
    let id = selectedId;
    if (selectedId === theme.id) {
      id = DEFAULT_THEME.id;
      setSelectedId(id);
      applyTheme(DEFAULT_THEME);
    }
    persist(id, customs);
  };

  if (!loaded) return null;

  const allThemes = [...PRESETS, ...customThemes];
  const editing = customThemes.find((t) => t.id === editingId) ?? null;

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13.5px] text-foreground">Theme</div>
          <div className="text-[12px] text-muted-foreground">
            Applies to the app and terminal colors.
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button variant="outline" size="xs" onClick={() => { setImportText(importText === null ? '' : null); setImportError(false); }}>
            <Import />
            Import…
          </Button>
          <Button variant="outline" size="xs" onClick={() => duplicateTheme(resolveTheme(selectedId, customThemes))}>
            <Plus />
            New theme
          </Button>
        </div>
      </div>

      {importText !== null && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="text-[12px] text-muted-foreground leading-relaxed">
            Paste a color scheme from Windows Terminal (JSON), Ghostty, kitty or Alacritty — most theme repos and
            iTerm2-Color-Schemes ship one of these. Surfaces the scheme doesn&apos;t define are derived; adjust them in the editor.
          </div>
          <textarea
            aria-label="Color scheme"
            value={importText}
            spellCheck={false}
            rows={6}
            placeholder={'background = #1e1e2e\nforeground = #cdd6f4\npalette = 1=#f38ba8\n…'}
            onChange={(e) => { setImportText(e.target.value); setImportError(false); }}
            className="w-full px-2.5 py-2 rounded-sm border border-border bg-card text-foreground font-mono text-[12px] outline-none focus:border-border-hover placeholder:text-faint resize-y"
          />
          <div className="flex items-center gap-2">
            {importError && (
              <span className="text-[12px] text-attention">Not a scheme this can read — it needs a background, a foreground and ansi colors 1–6.</span>
            )}
            <div className="flex-1" />
            <Button variant="outline" size="xs" onClick={() => { setImportText(null); setImportError(false); }}>Cancel</Button>
            <Button size="xs" disabled={!importText?.trim()} onClick={importScheme}>Import</Button>
          </div>
        </div>
      )}

      {(['dark', 'light'] as const).map((tone) => {
        const themes = allThemes.filter((t) => isLight(t.colors) === (tone === 'light'));
        if (!themes.length) return null;
        return (
          <section key={tone} aria-label={tone === 'dark' ? 'Dark themes' : 'Light themes'} className="flex flex-col gap-2">
            <div className="text-[11px] font-medium text-muted-foreground">{tone === 'dark' ? 'Dark' : 'Light'}</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
              {themes.map((theme) => {
                const isSelected = theme.id === selectedId;
                return (
                  <div
                    key={theme.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => selectTheme(theme)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') selectTheme(theme);
                    }}
                    className={cn(
                      'group flex flex-col gap-2 rounded-md border p-3 text-left cursor-pointer transition-colors',
                      isSelected ? 'border-primary bg-accent' : 'border-border hover:border-border-hover hover:bg-muted',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] text-foreground truncate flex-1">{theme.name}</span>
                      {isSelected && <Check size={12} className="text-primary shrink-0" />}
                    </div>
                    <div className="flex items-center gap-1">
                      {swatches(theme.colors).map((color, i) => (
                        <span
                          key={i}
                          className="size-3.5 rounded-full border border-border shrink-0"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                      {/* The session statuses as this theme paints them — done,
                          working, needs you — on the theme's own background, so
                          whether they tell apart is visible before you pick it. */}
                      <span
                        aria-label="Status colors: done, working, needs you"
                        className="inline-flex items-center gap-1 ml-1.5 px-1.5 h-[18px] rounded-full shrink-0"
                        style={{ backgroundColor: theme.colors.background }}
                      >
                        {Object.values(statusColors(theme.colors)).map((color, i) => (
                          <span key={i} className="size-2 rounded-full" style={{ backgroundColor: color }} />
                        ))}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 min-h-6">
                      {theme.builtIn ? (
                        <span className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Built-in</span>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Edit ${theme.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              editTheme(theme);
                            }}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Delete ${theme.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteTheme(theme);
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Duplicate ${theme.name}`}
                        className={cn(!theme.builtIn && 'ml-auto')}
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateTheme(theme);
                        }}
                      >
                        <Copy />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {editing && (
        <div className="flex flex-col gap-3 rounded-md border border-border p-4">
          <div className="flex items-center gap-2">
            <Input
              value={editing.name}
              aria-label="Theme name"
              className="h-7 max-w-55 text-[13px]"
              onChange={(e) => updateEditing({ name: e.target.value })}
            />
            <div className="flex-1" />
            <Button size="xs" onClick={saveEditing}>
              Save
            </Button>
            <Button variant="outline" size="xs" onClick={() => deleteTheme(editing)}>
              Delete
            </Button>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-2">
            {THEME_COLOR_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer">
                <input
                  type="color"
                  value={editing.colors[key]}
                  aria-label={THEME_COLOR_LABELS[key]}
                  className="size-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
                  onChange={(e) => updateEditing({ color: [key, e.target.value] })}
                />
                <span className="truncate">{THEME_COLOR_LABELS[key]}</span>
              </label>
            ))}
          </div>

          <div className="text-[11.5px] text-muted-foreground leading-relaxed">
            Changes preview live. Save to keep them across restarts.
          </div>
        </div>
      )}
    </div>
  );
}
