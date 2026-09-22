import { describe, expect, it } from 'vitest';
import {
  cssVars,
  DEFAULT_THEME,
  isHexColor,
  mix,
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

  it('gives every preset a full set of row-state overlays', () => {
    for (const preset of PRESETS) {
      const vars = cssVars(preset.colors);
      expect(vars['--hover']).toBe('rgba(255, 255, 255, 0.04)');
      expect(vars['--raised']).toBe('rgba(255, 255, 255, 0.055)');
      expect(vars['--selected']).toBe('rgba(255, 255, 255, 0.075)');
      expect(vars['--selected-hover']).toBe('rgba(255, 255, 255, 0.095)');
    }
  });

  it('keeps the text tiers ordered light-to-dark for every preset', () => {
    // dim reads louder than muted-foreground, which reads louder than faint.
    // A theme that inverted them would quietly flip the whole hierarchy.
    const luminance = (hex: string) =>
      [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);
    for (const preset of PRESETS) {
      const vars = cssVars(preset.colors);
      expect(luminance(vars['--dim'])).toBeGreaterThan(luminance(vars['--muted-foreground']));
      expect(luminance(vars['--muted-foreground'])).toBeGreaterThan(luminance(vars['--faint']));
    }
  });
});
