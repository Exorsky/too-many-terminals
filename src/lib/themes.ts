/**
 * Theme system: built-in presets + user-defined custom themes.
 *
 * A theme is 12 editable core colors; every other UI token (muted/accent/
 * secondary surfaces, on-color foregrounds, xterm brights) is derived so
 * custom themes stay coherent. `applyTheme` restyles the shell via CSS
 * variables on <html> and mutates every cached xterm instance — no React
 * re-render is involved.
 */
import type { ITheme } from '@xterm/xterm';
import { terminalCache } from '@/components/terminalCache';

export interface ThemeColors {
  /** App + terminal background, ansi black. */
  background: string;
  /** Main text, ansi white. */
  foreground: string;
  /** Card + popover surfaces. */
  card: string;
  /** Borders, inputs, scrollbar thumb. */
  border: string;
  /** Accent: primary, ring, terminal cursor, ansi blue. */
  primary: string;
  /** Secondary text, ansi brightBlack. */
  mutedForeground: string;
  /** ansi red. */
  destructive: string;
  /** ansi green. */
  success: string;
  /** ansi yellow. */
  warning: string;
  /** ansi magenta. */
  magenta: string;
  /** ansi cyan. */
  cyan: string;
  /** Terminal selection background. */
  selection: string;
}

export interface Theme {
  id: string;
  name: string;
  builtIn: boolean;
  colors: ThemeColors;
}

export const THEME_COLOR_KEYS: (keyof ThemeColors)[] = [
  'background',
  'foreground',
  'card',
  'border',
  'primary',
  'mutedForeground',
  'destructive',
  'success',
  'warning',
  'magenta',
  'cyan',
  'selection',
];

/** Human-readable labels for the editor UI. */
export const THEME_COLOR_LABELS: Record<keyof ThemeColors, string> = {
  background: 'Background',
  foreground: 'Foreground',
  card: 'Card',
  border: 'Border',
  primary: 'Accent',
  mutedForeground: 'Muted text',
  destructive: 'Red',
  success: 'Green',
  warning: 'Yellow',
  magenta: 'Magenta',
  cyan: 'Cyan',
  selection: 'Selection',
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value);
}

/** Per-channel linear interpolation between two #rrggbb colors. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  let out = '#';
  for (const shift of [16, 8, 0]) {
    const ca = (pa >> shift) & 0xff;
    const cb = (pb >> shift) & 0xff;
    const c = Math.round(ca + (cb - ca) * t);
    out += c.toString(16).padStart(2, '0');
  }
  return out;
}

/** Full set of CSS custom properties derived from the 12 core colors. */
export function cssVars(c: ThemeColors): Record<string, string> {
  return {
    '--background': c.background,
    '--foreground': c.foreground,
    '--card': c.card,
    '--card-foreground': c.foreground,
    '--popover': c.card,
    '--popover-foreground': c.foreground,
    '--primary': c.primary,
    '--primary-foreground': c.background,
    '--secondary': mix(c.background, c.foreground, 0.064),
    '--secondary-foreground': c.foreground,
    '--muted': mix(c.background, c.foreground, 0.041),
    '--muted-foreground': c.mutedForeground,
    '--accent': mix(c.background, c.foreground, 0.055),
    '--accent-foreground': c.foreground,
    '--destructive': c.destructive,
    '--destructive-foreground': c.background,
    '--border': c.border,
    '--border-hover': mix(c.border, c.foreground, 0.087),
    '--input': c.border,
    '--ring': c.primary,
    '--success': c.success,
    '--success-foreground': c.background,
    '--warning': c.warning,
    '--warning-foreground': c.background,
    '--attention': mix(c.warning, c.destructive, 0.5),
  };
}

/** xterm ITheme derived from the core colors. */
export function toXtermTheme(c: ThemeColors): ITheme {
  return {
    background: c.background,
    foreground: c.foreground,
    cursor: c.primary,
    selectionBackground: c.selection,
    black: c.background,
    red: c.destructive,
    green: c.success,
    yellow: c.warning,
    blue: c.primary,
    magenta: c.magenta,
    cyan: c.cyan,
    white: c.foreground,
    brightBlack: c.mutedForeground,
    brightRed: c.destructive,
    brightGreen: c.success,
    brightYellow: c.warning,
    brightBlue: c.primary,
    brightMagenta: c.magenta,
    brightCyan: c.cyan,
    brightWhite: '#ffffff',
  };
}

export const DEFAULT_THEME: Theme = {
  id: 'default',
  name: 'Default',
  builtIn: true,
  colors: {
    background: '#0c0d10',
    foreground: '#e7e8ec',
    card: '#121319',
    border: '#23252d',
    primary: '#7c9eff',
    mutedForeground: '#666b78',
    destructive: '#ff6b6b',
    success: '#8bd17c',
    warning: '#f0b357',
    magenta: '#c792ea',
    cyan: '#6fd4c9',
    selection: '#2a2f45',
  },
};

export const PRESETS: Theme[] = [
  DEFAULT_THEME,
  {
    id: 'amber',
    name: 'Amber',
    builtIn: true,
    colors: {
      background: '#0e0d0a',
      foreground: '#eae7dd',
      card: '#16140e',
      border: '#2b2820',
      primary: '#e8b45a',
      mutedForeground: '#7a7362',
      destructive: '#ff6b6b',
      success: '#a8c97a',
      warning: '#f0b357',
      magenta: '#d09a70',
      cyan: '#c9a86a',
      selection: '#3a3222',
    },
  },
  {
    id: 'violet',
    name: 'Violet',
    builtIn: true,
    colors: {
      background: '#0d0c13',
      foreground: '#e8e6f0',
      card: '#14121d',
      border: '#262334',
      primary: '#b48eff',
      mutedForeground: '#6f6a84',
      destructive: '#ff6b8a',
      success: '#8bd17c',
      warning: '#e0a458',
      magenta: '#c792ea',
      cyan: '#9d7bd8',
      selection: '#322a4a',
    },
  },
  {
    id: 'seafoam',
    name: 'Seafoam',
    builtIn: true,
    colors: {
      background: '#0b0f0e',
      foreground: '#e2ebe7',
      card: '#101614',
      border: '#1f2b27',
      primary: '#5fd4a0',
      mutedForeground: '#62766e',
      destructive: '#ff7a70',
      success: '#7cd190',
      warning: '#d8c268',
      magenta: '#8fb8a8',
      cyan: '#6fd4c9',
      selection: '#22392f',
    },
  },
];

let activeTheme: Theme = DEFAULT_THEME;

export function getActiveTheme(): Theme {
  return activeTheme;
}

/** Theme for newly created xterm instances. */
export function getActiveXtermTheme(): ITheme {
  return toXtermTheme(activeTheme.colors);
}

/** Restyle the app shell (CSS vars) and every cached terminal. */
export function applyTheme(theme: Theme): void {
  activeTheme = theme;
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(cssVars(theme.colors))) {
    style.setProperty(name, value);
  }
  const xtermTheme = toXtermTheme(theme.colors);
  for (const cached of terminalCache.values()) {
    cached.term.options.theme = xtermTheme;
  }
}

/** Validate raw JSON from settings.json into Theme[]; drops garbage entries
 *  and fills missing/invalid color fields from the Default palette. */
export function sanitizeCustomThemes(raw: unknown[]): Theme[] {
  const themes: Theme[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, name, colors } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !id) continue;
    if (typeof name !== 'string' || !name) continue;
    if (typeof colors !== 'object' || colors === null) continue;
    const src = colors as Record<string, unknown>;
    const clean = { ...DEFAULT_THEME.colors };
    for (const key of THEME_COLOR_KEYS) {
      const value = src[key];
      if (isHexColor(value)) clean[key] = value.toLowerCase();
    }
    themes.push({ id, name, builtIn: false, colors: clean });
  }
  return themes;
}

/** Find a theme by id among presets + customs; unknown ids fall back to Default. */
export function resolveTheme(id: string, customThemes: Theme[]): Theme {
  return (
    PRESETS.find((t) => t.id === id) ??
    customThemes.find((t) => t.id === id) ??
    DEFAULT_THEME
  );
}
