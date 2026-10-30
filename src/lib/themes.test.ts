import { describe, expect, it } from 'vitest';
import {
  cssVars,
  DEFAULT_THEME,
  isHexColor,
  isLight,
  mix,
  statusColors,
  PRESETS,
  resolveTheme,
  sanitizeCustomThemes,
  THEME_COLOR_KEYS,
  toXtermTheme,
  type Theme,
} from './themes';

describe('mix', () => {
  it('interpolates per channel', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('cssVars (Default theme)', () => {
  const vars = cssVars(DEFAULT_THEME.colors);

  it('passes core colors through', () => {
    expect(vars['--background']).toBe('#0a0a0c');
    expect(vars['--foreground']).toBe('#e9e9ee');
    expect(vars['--card']).toBe('#101014');
    expect(vars['--popover']).toBe('#101014');
    expect(vars['--primary']).toBe('#8b7df7');
    expect(vars['--ring']).toBe('#8b7df7');
    expect(vars['--border']).toBe('#1e1e24');
    expect(vars['--input']).toBe('#1e1e24');
    expect(vars['--muted-foreground']).toBe('#7c7c87');
  });

  it('derives surfaces close to the original hand-picked palette', () => {
    // The hand-picked palette now lives in the Classic preset, which is what
    // this guards: --muted #15161b, --accent #181a20, --secondary #1a1c22.
    // They weren't a perfect lerp; the derivation reproduces them within
    // ±4 per channel, which is imperceptible on near-black surfaces.
    const classic = cssVars(resolveTheme('classic', []).colors);
    const close = (a: string, b: string) => {
      for (const i of [1, 3, 5]) {
        const da = parseInt(a.slice(i, i + 2), 16);
        const db = parseInt(b.slice(i, i + 2), 16);
        expect(Math.abs(da - db)).toBeLessThanOrEqual(4);
      }
    };
    close(classic['--muted'], '#15161b');
    close(classic['--accent'], '#181a20');
    close(classic['--secondary'], '#1a1c22');
    close(classic['--border-hover'], '#33363f');
  });

  it('uses the background as on-color foreground', () => {
    expect(vars['--primary-foreground']).toBe('#0a0a0c');
    expect(vars['--destructive-foreground']).toBe('#0a0a0c');
    expect(vars['--success-foreground']).toBe('#0a0a0c');
    expect(vars['--warning-foreground']).toBe('#0a0a0c');
  });
});

describe('toXtermTheme (Classic theme)', () => {
  it('matches the palette previously hardcoded in Terminal.tsx', () => {
    expect(toXtermTheme(resolveTheme('classic', []).colors)).toEqual({
      background: '#0c0d10',
      foreground: '#e7e8ec',
      cursor: '#7c9eff',
      selectionBackground: '#2a2f45',
      black: '#0c0d10',
      red: '#ff6b6b',
      green: '#8bd17c',
      yellow: '#f0b357',
      blue: '#7c9eff',
      magenta: '#c792ea',
      cyan: '#6fd4c9',
      white: '#e7e8ec',
      brightBlack: '#666b78',
      brightRed: '#ff6b6b',
      brightGreen: '#8bd17c',
      brightYellow: '#f0b357',
      brightBlue: '#7c9eff',
      brightMagenta: '#c792ea',
      brightCyan: '#6fd4c9',
      brightWhite: '#ffffff',
    });
  });
});

describe('PRESETS', () => {
  it('has unique ids and Default first', () => {
    const ids = PRESETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('default');
  });

  it('only contains valid #rrggbb colors', () => {
    for (const preset of PRESETS) {
      expect(preset.builtIn).toBe(true);
      for (const key of THEME_COLOR_KEYS) {
        expect(isHexColor(preset.colors[key]), `${preset.id}.${key}`).toBe(true);
      }
    }
  });
});

describe('sanitizeCustomThemes', () => {
  it('drops entries without id, name, or colors', () => {
    expect(
      sanitizeCustomThemes([
        null,
        42,
        'nope',
        { id: 'a' },
        { id: 'b', name: 'B' },
        { name: 'C', colors: {} },
        { id: '', name: 'D', colors: {} },
      ]),
    ).toEqual([]);
  });

  it('fills missing or invalid color fields from Default', () => {
    const [theme] = sanitizeCustomThemes([
      { id: 't1', name: 'Mine', colors: { primary: '#FFCC00', background: 'red', cyan: 12 } },
    ]);
    expect(theme.builtIn).toBe(false);
    expect(theme.colors.primary).toBe('#ffcc00');
    expect(theme.colors.background).toBe(DEFAULT_THEME.colors.background);
    expect(theme.colors.cyan).toBe(DEFAULT_THEME.colors.cyan);
  });
});

describe('resolveTheme', () => {
  const custom: Theme = { ...DEFAULT_THEME, id: 'custom-1', name: 'Custom', builtIn: false };

  it('finds presets and custom themes by id', () => {
    expect(resolveTheme('violet', []).name).toBe('Violet');
    expect(resolveTheme('custom-1', [custom])).toBe(custom);
  });

  it('falls back to Default for unknown ids', () => {
    expect(resolveTheme('deleted-theme', [custom])).toBe(DEFAULT_THEME);
  });
});

describe('cssVars (derived UI tiers)', () => {
  it('derives the two text tiers between foreground and muted-foreground', () => {
    const vars = cssVars(DEFAULT_THEME.colors);
    // These match the static fallbacks in globals.css, which carry the shell
    // until applyTheme runs — if one moves, the other has to move with it.
    expect(vars['--dim']).toBe('#ababaf');
    expect(vars['--faint']).toBe('#494950');
  });

  it('gives every preset a full set of row-state overlays: white lifts a dark theme, ink a light one', () => {
    for (const preset of PRESETS) {
      const vars = cssVars(preset.colors);
      const base = isLight(preset.colors) ? 'rgba(0, 0, 0, ' : 'rgba(255, 255, 255, ';
      for (const name of ['--hover', '--raised', '--selected', '--selected-hover']) {
        expect(vars[name], `${preset.name} ${name}`).toMatch(base);
      }
    }
    expect(cssVars(DEFAULT_THEME.colors)['--hover']).toBe('rgba(255, 255, 255, 0.04)');
  });

  it('keeps the text tiers ordered loud-to-quiet for every preset', () => {
    // dim stands further from the background than muted-foreground, which
    // stands further than faint — on dark and light themes alike. A theme that
    // inverted them would quietly flip the whole hierarchy.
    const gray = (hex: string) => [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);
    for (const preset of PRESETS) {
      const vars = cssVars(preset.colors);
      const away = (hex: string) => Math.abs(gray(hex) - gray(preset.colors.background));
      expect(away(vars['--dim']), preset.name).toBeGreaterThan(away(vars['--muted-foreground']));
      expect(away(vars['--muted-foreground']), preset.name).toBeGreaterThan(away(vars['--faint']));
    }
  });

  it('a light theme swaps the terminal\'s black and white, so black text stays visible', () => {
    const latte = PRESETS.find((p) => p.id === 'catppuccin-latte')!;
    expect(isLight(latte.colors)).toBe(true);
    const x = toXtermTheme(latte.colors);
    expect(x.black).toBe(latte.colors.foreground);
    expect(x.brightWhite).toBe(latte.colors.background);
    expect(toXtermTheme(DEFAULT_THEME.colors).black).toBe(DEFAULT_THEME.colors.background);
  });

  it('a custom theme saved before blue existed keeps its accent as ansi blue', () => {
    const [t] = sanitizeCustomThemes([{ id: 'x', name: 'Old', colors: { primary: '#ff0000' } }]);
    expect(t.colors.blue).toBe('#ff0000');
  });
});

describe('status colors', () => {
  const hue = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
    if (!d) return 0;
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return h * 60;
  };

  it('done, working and needs-you are told apart by hue in every preset', () => {
    for (const p of PRESETS) {
      const s = statusColors(p.colors);
      const att = hue(s.attention) > 300 ? hue(s.attention) - 360 : hue(s.attention);
      expect(hue(s.success), p.name).toBeGreaterThanOrEqual(119.5);
      expect(hue(s.success), p.name).toBeLessThanOrEqual(160.5);
      expect(hue(s.warning), p.name).toBeGreaterThanOrEqual(37.5);
      expect(hue(s.warning), p.name).toBeLessThanOrEqual(50.5);
      expect(hue(s.warning) - att, p.name).toBeGreaterThanOrEqual(23.5);
    }
  });

  it('a color already in its corridor is left exactly as the theme set it', () => {
    const s = statusColors(DEFAULT_THEME.colors);
    expect(s.success).toBe(DEFAULT_THEME.colors.success);
    expect(s.warning).toBe(DEFAULT_THEME.colors.warning);
    // globals.css carries the derived needs-you color for the first paint.
    expect(cssVars(DEFAULT_THEME.colors)['--attention']).toBe('#df6c46');
  });

  it('the terminal keeps the theme\'s own palette', () => {
    const gruvbox = PRESETS.find((p) => p.id === 'gruvbox-dark')!;
    expect(toXtermTheme(gruvbox.colors).green).toBe('#b8bb26');
    expect(cssVars(gruvbox.colors)['--success']).not.toBe('#b8bb26');
  });
});
