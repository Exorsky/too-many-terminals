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
    expect(vars['--background']).toBe('#0c0d10');
    expect(vars['--foreground']).toBe('#e7e8ec');
    expect(vars['--card']).toBe('#121319');
    expect(vars['--popover']).toBe('#121319');
    expect(vars['--primary']).toBe('#7c9eff');
    expect(vars['--ring']).toBe('#7c9eff');
    expect(vars['--border']).toBe('#23252d');
    expect(vars['--input']).toBe('#23252d');
    expect(vars['--muted-foreground']).toBe('#666b78');
  });

  it('derives surfaces close to the original hand-picked palette', () => {
    // Original values: --muted #15161b, --accent #181a20, --secondary #1a1c22.
    // They weren't a perfect lerp; the derivation reproduces them within
    // ±4 per channel, which is imperceptible on near-black surfaces.
    const close = (a: string, b: string) => {
      for (const i of [1, 3, 5]) {
        const da = parseInt(a.slice(i, i + 2), 16);
        const db = parseInt(b.slice(i, i + 2), 16);
        expect(Math.abs(da - db)).toBeLessThanOrEqual(4);
      }
    };
    close(vars['--muted'], '#15161b');
    close(vars['--accent'], '#181a20');
    close(vars['--secondary'], '#1a1c22');
    close(vars['--border-hover'], '#33363f');
  });

  it('uses the background as on-color foreground', () => {
    expect(vars['--primary-foreground']).toBe('#0c0d10');
    expect(vars['--destructive-foreground']).toBe('#0c0d10');
    expect(vars['--success-foreground']).toBe('#0c0d10');
    expect(vars['--warning-foreground']).toBe('#0c0d10');
  });
});

describe('toXtermTheme (Default theme)', () => {
  it('matches the palette previously hardcoded in Terminal.tsx', () => {
    expect(toXtermTheme(DEFAULT_THEME.colors)).toEqual({
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
