/**
 * Theme system: built-in presets + user-defined custom themes.
 *
 * A theme is 14 editable core colors; every other UI token (muted/accent/
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
  /** Accent: primary, ring, terminal cursor. */
  primary: string;
  /** ansi blue. Its own color since 0.28: a scheme's blue is rarely its
   *  accent (Gruvbox's accent is orange). Older custom themes fill it from
   *  their accent, which is what ansi blue used to be. */
  blue: string;
  /** Secondary text, ansi brightBlack. */
  mutedForeground: string;
  /** Usage meter bar below the warning threshold. App chrome only — it has
   *  no ansi counterpart, which is why it isn't just reused from `primary`. */
  usage: string;
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
  'blue',
  'mutedForeground',
  'usage',
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
  blue: 'Blue',
  mutedForeground: 'Muted text',
  usage: 'Usage bar',
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

/** Relative luminance (WCAG) of a #rrggbb color, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** A light theme: dark text on a light background. Decides which way the
 *  row overlays and the terminal's black/white go — derived, not a flag, so a
 *  custom theme can't claim one thing and paint another. */
export function isLight(c: ThemeColors): boolean {
  return luminance(c.background) > 0.4;
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return `#${[0, 8, 4].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Nudge a color into a hue corridor with a saturation floor, keeping its
 *  lightness — so it stays the theme's color, just unmistakable. A color
 *  already inside is returned untouched (no HSL round-trip drift). */
function corridor(hex: string, minHue: number, maxHue: number, minSat: number): string {
  const [h, s, l] = toHsl(hex);
  const hue = Math.min(maxHue, Math.max(minHue, h > 300 ? h - 360 : h));
  if (hue === h && s >= minSat) return hex;
  return fromHsl((hue + 360) % 360, Math.max(s, minSat), l);
}

/** The three session statuses as the app chrome paints them. A theme's own
 *  green/yellow are terminal colors first, and several palettes put them a
 *  few degrees apart (Gruvbox: yellow-green 61°, yellow 42°, orange 24°) —
 *  fine for syntax, unreadable as "done / working / needs you" at 7px. So
 *  each takes the theme's color and is pushed into its own corridor: done is
 *  green (120–160°), working amber (38–50°), needs-you red-orange, at least
 *  24° below working. The terminal keeps the theme's palette untouched. */
export function statusColors(c: ThemeColors): { success: string; warning: string; attention: string } {
  const success = corridor(c.success, 120, 160, 0.4);
  const warning = corridor(c.warning, 38, 50, 0.55);
  const workHue = toHsl(warning)[0];
  const attention = corridor(mix(c.warning, c.destructive, 0.5), -10, workHue - 24, 0.6);
  return { success, warning, attention };
}

/** Full set of CSS custom properties derived from the core colors. */
export function cssVars(c: ThemeColors): Record<string, string> {
  // Row states are overlays, not theme colors: they have to read as "this
  // surface is raised" on top of whatever background the theme set, and a
  // tinted overlay would fight the project hues sitting in the same rows.
  // White lifts a dark surface; on a light one it would vanish, so ink it is.
  const overlay = isLight(c) ? (a: number) => `rgba(0, 0, 0, ${a})` : (a: number) => `rgba(255, 255, 255, ${a})`;
  const k = isLight(c) ? 1.2 : 1;
  const status = statusColors(c);
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
    '--success': status.success,
    '--success-foreground': c.background,
    '--warning': status.warning,
    '--warning-foreground': c.background,
    '--attention': status.attention,
    '--usage': c.usage,
    // The two text tiers between `foreground` and `mutedForeground`'s floor.
    // Derived rather than editable: a theme picks how loud its text is, and
    // these keep the same relative steps whatever it picks.
    '--dim': mix(c.background, c.foreground, 0.72),
    '--faint': mix(c.background, c.mutedForeground, 0.55),
    '--hover': overlay(+(0.04 * k).toFixed(3)),
    '--selected': overlay(+(0.075 * k).toFixed(3)),
    '--selected-hover': overlay(+(0.095 * k).toFixed(3)),
    '--raised': overlay(+(0.055 * k).toFixed(3)),
    // Rendered Markdown: body text a step below foreground, and the two
    // accents transcripts use (assistant turns, inline code).
    '--prose': mix(c.background, c.foreground, 0.92),
    // Links: the shell's fixed light blue reads on every dark theme; on a
    // light one it's too pale, so the theme's own blue takes over.
    '--link': isLight(c) ? c.blue : '#7fb2ff',
    '--cyan': c.cyan,
    '--magenta': c.magenta,
  };
}

/** xterm ITheme derived from the core colors. */
export function toXtermTheme(c: ThemeColors): ITheme {
  // On a light theme ansi black is the ink and white the paper — the other
  // way round, `ls` and friends print black text you can't see.
  const light = isLight(c);
  return {
    background: c.background,
    foreground: c.foreground,
    cursor: c.primary,
    selectionBackground: c.selection,
    black: light ? c.foreground : c.background,
    red: c.destructive,
    green: c.success,
    yellow: c.warning,
    blue: c.blue,
    magenta: c.magenta,
    cyan: c.cyan,
    white: light ? mix(c.background, c.foreground, 0.15) : c.foreground,
    brightBlack: c.mutedForeground,
    brightRed: c.destructive,
    brightGreen: c.success,
    brightYellow: c.warning,
    brightBlue: c.blue,
    brightMagenta: c.magenta,
    brightCyan: c.cyan,
    brightWhite: light ? c.background : '#ffffff',
  };
}

export const DEFAULT_THEME: Theme = {
  id: 'default',
  name: 'Default',
  builtIn: true,
  colors: {
    background: '#0a0a0c',
    foreground: '#e9e9ee',
    card: '#101014',
    border: '#1e1e24',
    primary: '#8b7df7',
    blue: '#8b7df7',
    mutedForeground: '#7c7c87',
    usage: '#8b7df7',
    destructive: '#e5534b',
    success: '#45b96a',
    warning: '#d9a441',
    magenta: '#c792ea',
    cyan: '#6fd4c9',
    selection: '#2e2a45',
  },
};

/** The palette the app shipped with through 0.24 — kept as a preset so the
 *  retune of Default is a change of look, not a loss of one. */
const CLASSIC_THEME: Theme = {
  id: 'classic',
  name: 'Classic blue',
  builtIn: true,
  colors: {
    background: '#0c0d10',
    foreground: '#e7e8ec',
    card: '#121319',
    border: '#23252d',
    primary: '#7c9eff',
    blue: '#7c9eff',
    mutedForeground: '#666b78',
    usage: '#7c9eff',
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
  CLASSIC_THEME,
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
      blue: '#e8b45a',
      mutedForeground: '#7a7362',
      usage: '#e8b45a',
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
      blue: '#b48eff',
      mutedForeground: '#6f6a84',
      usage: '#b48eff',
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
      blue: '#5fd4a0',
      mutedForeground: '#62766e',
      usage: '#5fd4a0',
      destructive: '#ff7a70',
      success: '#7cd190',
      warning: '#d8c268',
      magenta: '#8fb8a8',
      cyan: '#6fd4c9',
      selection: '#22392f',
    },
  },
  // Well-known palettes, each from its own repo's terminal extras where one
  // exists (Windows Terminal / Alacritty files, so already ansi-mapped). App
  // surfaces come from the theme's own panel and border roles: a step lighter
  // than the background on dark themes, a step darker on light ones.
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    builtIn: true,
    colors: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      card: '#313244',
      border: '#45475a',
      primary: '#cba6f7',
      blue: '#89b4fa',
      mutedForeground: '#9399b2',
      usage: '#cba6f7',
      destructive: '#f38ba8',
      success: '#a6e3a1',
      warning: '#f9e2af',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      selection: '#585b70',
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    builtIn: true,
    colors: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      card: '#292e42',
      border: '#3b4261',
      primary: '#7aa2f7',
      blue: '#7aa2f7',
      mutedForeground: '#565f89',
      usage: '#7aa2f7',
      destructive: '#f7768e',
      success: '#9ece6a',
      warning: '#e0af68',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      selection: '#283457',
    },
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    builtIn: true,
    colors: {
      background: '#282828',
      foreground: '#ebdbb2',
      card: '#3c3836',
      border: '#504945',
      primary: '#fe8019',
      blue: '#83a598',
      mutedForeground: '#928374',
      usage: '#fe8019',
      destructive: '#fb4934',
      success: '#b8bb26',
      warning: '#fabd2f',
      magenta: '#d3869b',
      cyan: '#8ec07c',
      selection: '#665c54',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    builtIn: true,
    colors: {
      background: '#2e3440',
      foreground: '#d8dee9',
      card: '#3b4252',
      border: '#434c5e',
      primary: '#88c0d0',
      blue: '#81a1c1',
      mutedForeground: '#616e88',
      usage: '#88c0d0',
      destructive: '#bf616a',
      success: '#a3be8c',
      warning: '#ebcb8b',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      selection: '#4c566a',
    },
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    builtIn: true,
    colors: {
      background: '#191724',
      foreground: '#e0def4',
      card: '#1f1d2e',
      border: '#524f67',
      primary: '#ebbcba',
      blue: '#9ccfd8',
      mutedForeground: '#6e6a86',
      usage: '#ebbcba',
      destructive: '#eb6f92',
      success: '#31748f',
      warning: '#f6c177',
      magenta: '#c4a7e7',
      cyan: '#ebbcba',
      selection: '#403d52',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    builtIn: true,
    colors: {
      background: '#282a36',
      foreground: '#f8f8f2',
      card: '#343746',
      border: '#424450',
      primary: '#bd93f9',
      blue: '#bd93f9',
      mutedForeground: '#6272a4',
      usage: '#bd93f9',
      destructive: '#ff5555',
      success: '#50fa7b',
      warning: '#f1fa8c',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      selection: '#44475a',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    builtIn: true,
    colors: {
      background: '#002b36',
      foreground: '#839496',
      card: '#073642',
      border: '#586e75',
      primary: '#268bd2',
      blue: '#268bd2',
      mutedForeground: '#586e75',
      usage: '#268bd2',
      destructive: '#dc322f',
      success: '#859900',
      warning: '#b58900',
      magenta: '#d33682',
      cyan: '#2aa198',
      selection: '#073642',
    },
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    builtIn: true,
    colors: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      card: '#161b22',
      border: '#30363d',
      primary: '#58a6ff',
      blue: '#58a6ff',
      mutedForeground: '#8b949e',
      usage: '#58a6ff',
      destructive: '#ff7b72',
      success: '#3fb950',
      warning: '#d29922',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      selection: '#1c2f45',
    },
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    builtIn: true,
    colors: {
      background: '#282c34',
      foreground: '#abb2bf',
      card: '#31363f',
      border: '#3a3f4b',
      primary: '#61afef',
      blue: '#61afef',
      mutedForeground: '#5c6370',
      usage: '#61afef',
      destructive: '#e06c75',
      success: '#98c379',
      warning: '#e5c07b',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      selection: '#3e4451',
    },
  },
  {
    id: 'kanagawa-wave',
    name: 'Kanagawa Wave',
    builtIn: true,
    colors: {
      background: '#1f1f28',
      foreground: '#dcd7ba',
      card: '#2a2a37',
      border: '#54546d',
      primary: '#7e9cd8',
      blue: '#7e9cd8',
      mutedForeground: '#727169',
      usage: '#7e9cd8',
      destructive: '#c34043',
      success: '#76946a',
      warning: '#c0a36e',
      magenta: '#957fb8',
      cyan: '#6a9589',
      selection: '#2d4f67',
    },
  },
  {
    id: 'everforest-dark',
    name: 'Everforest Dark',
    builtIn: true,
    colors: {
      background: '#2d353b',
      foreground: '#d3c6aa',
      card: '#343f44',
      border: '#4f585e',
      primary: '#a7c080',
      blue: '#7fbbb3',
      mutedForeground: '#859289',
      usage: '#a7c080',
      destructive: '#e67e80',
      success: '#a7c080',
      warning: '#dbbc7f',
      magenta: '#d699b6',
      cyan: '#83c092',
      selection: '#543a48',
    },
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    builtIn: true,
    colors: {
      background: '#eff1f5',
      foreground: '#4c4f69',
      card: '#e6e9ef',
      border: '#ccd0da',
      primary: '#8839ef',
      blue: '#1e66f5',
      mutedForeground: '#7c7f93',
      usage: '#8839ef',
      destructive: '#d20f39',
      success: '#40a02b',
      warning: '#df8e1d',
      magenta: '#ea76cb',
      cyan: '#179299',
      selection: '#acb0be',
    },
  },
  {
    id: 'rose-pine-dawn',
    name: 'Rosé Pine Dawn',
    builtIn: true,
    colors: {
      background: '#faf4ed',
      foreground: '#575279',
      card: '#f2e9e1',
      border: '#cecacd',
      primary: '#d7827e',
      blue: '#56949f',
      mutedForeground: '#9893a5',
      usage: '#d7827e',
      destructive: '#b4637a',
      success: '#286983',
      warning: '#ea9d34',
      magenta: '#907aa9',
      cyan: '#d7827e',
      selection: '#dfdad9',
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    builtIn: true,
    colors: {
      background: '#fdf6e3',
      foreground: '#657b83',
      card: '#eee8d5',
      border: '#93a1a1',
      primary: '#268bd2',
      blue: '#268bd2',
      mutedForeground: '#93a1a1',
      usage: '#268bd2',
      destructive: '#dc322f',
      success: '#859900',
      warning: '#b58900',
      magenta: '#d33682',
      cyan: '#2aa198',
      selection: '#eee8d5',
    },
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    builtIn: true,
    colors: {
      background: '#ffffff',
      foreground: '#24292f',
      card: '#f6f8fa',
      border: '#d0d7de',
      primary: '#0969da',
      blue: '#0969da',
      mutedForeground: '#6e7781',
      usage: '#0969da',
      destructive: '#cf222e',
      success: '#116329',
      warning: '#9a6700',
      magenta: '#8250df',
      cyan: '#1b7c83',
      selection: '#cee1f8',
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

/** xterm's contrast floor. On a light theme, text a program colors for a
 *  dark terminal — white, or Claude Code's own near-white truecolor — would
 *  vanish; 4.5 (WCAG AA) nudges it dark enough to read. Dark themes keep the
 *  colors exactly as sent. */
export function terminalContrast(c: ThemeColors = activeTheme.colors): number {
  return isLight(c) ? 4.5 : 1;
}

/** Restyle the app shell (CSS vars) and every cached terminal. */
export function applyTheme(theme: Theme): void {
  activeTheme = theme;
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(cssVars(theme.colors))) {
    style.setProperty(name, value);
  }
  // The webview's own chrome — native <select> popups, checkboxes, unstyled
  // scrollbars — follows this, not our variables.
  style.colorScheme = isLight(theme.colors) ? 'light' : 'dark';
  const xtermTheme = toXtermTheme(theme.colors);
  const contrast = terminalContrast(theme.colors);
  for (const cached of terminalCache.values()) {
    cached.term.options.theme = xtermTheme;
    cached.term.options.minimumContrastRatio = contrast;
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
    // Saved before blue was its own color: ansi blue was the accent.
    if (!isHexColor(src.blue)) clean.blue = clean.primary;
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
