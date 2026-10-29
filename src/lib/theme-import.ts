/**
 * A color scheme from another terminal, pasted in, becomes a custom theme.
 * Four formats cover nearly every published scheme — iTerm2-Color-Schemes and
 * most theme repos ship all of them:
 *
 * - Windows Terminal: a JSON scheme object (`background`, `red`, `purple`…)
 * - Ghostty: `background = 1e1e2e`, `palette = 1=#f38ba8`
 * - kitty: `background #1e1e2e`, `color1 #f38ba8`
 * - Alacritty (TOML): `[colors.normal]` / `[colors.bright]` sections
 *
 * Terminal schemes carry 16 ansi colors and a background, not an app's
 * surfaces, so card, border and the rest are derived the way `cssVars`
 * derives its own tiers. See docs/features/themes.md.
 */
import { DEFAULT_THEME, mix, type ThemeColors } from './themes';

const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

/** `#1E1E2E`, `1e1e2e`, `0x1e1e2e` → `#1e1e2e`; anything else → null. */
function hex(value: string | undefined): string | null {
  const m = value?.trim().replace(/^["']|["']$/g, '').match(/^(?:#|0x)?([0-9a-fA-F]{6})$/);
  return m ? `#${m[1].toLowerCase()}` : null;
}

interface Scheme {
  name?: string;
  background?: string;
  foreground?: string;
  selection?: string;
  /** ansi 0–15. */
  palette: (string | undefined)[];
}

/** Text copied out of a Windows Terminal settings.json is JSONC and rarely a
 *  clean object: `//` comments, a trailing comma, sometimes just the members
 *  without their braces. */
function looseJson(text: string): unknown {
  let t = text.replace(/^\s*\/\/.*$/gm, '').trim().replace(/,\s*$/, '');
  if (!/^[[{]/.test(t) && /^"[\w-]+"\s*:/.test(t)) t = `{${t}}`;
  t = t.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(t);
}

function fromJson(text: string): Scheme | null {
  let json: unknown;
  try { json = looseJson(text); } catch { return null; }
  // A settings.json fragment or a list of schemes: take the first one.
  if (Array.isArray(json)) json = json[0];
  if (json && typeof json === 'object' && Array.isArray((json as { schemes?: unknown }).schemes)) {
    json = (json as { schemes: unknown[] }).schemes[0];
  }
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, string>;
  const palette: (string | undefined)[] = [];
  ANSI_NAMES.forEach((n, i) => {
    // Windows Terminal says purple where everyone else says magenta.
    const name = n === 'magenta' ? 'purple' : n;
    palette[i] = hex(o[name] ?? o[n]) ?? undefined;
    const bright = `bright${name[0].toUpperCase()}${name.slice(1)}`;
    palette[i + 8] = hex(o[bright] ?? o[`bright${n[0].toUpperCase()}${n.slice(1)}`]) ?? undefined;
  });
  return {
    name: typeof o.name === 'string' ? o.name : undefined,
    background: hex(o.background) ?? undefined,
    foreground: hex(o.foreground) ?? undefined,
    selection: hex(o.selectionBackground) ?? undefined,
    palette,
  };
}

function fromLines(text: string): Scheme {
  const scheme: Scheme = { palette: [] };
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // A comment, unless it's a bare hex value — none of these formats start a
    // line with one.
    if (line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) {
      const title = line.match(/^#+\s*(?:name|theme)\s*[:=]\s*(.+)$/i);
      if (title && !scheme.name) scheme.name = title[1].trim();
      continue;
    }
    const header = line.match(/^\[(.+)\]$/);
    if (header) { section = header[1].toLowerCase(); continue; }
    const kv = line.match(/^([\w.-]+)\s*(?:=|:|\s)\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase().replace(/[-_]/g, '');
    const value = kv[2].trim();
    if (key === 'palette') {
      // Ghostty: palette = 1=#f38ba8
      const p = value.match(/^(\d{1,2})\s*=\s*(.+)$/);
      if (p && +p[1] < 16) scheme.palette[+p[1]] = hex(p[2]) ?? undefined;
      continue;
    }
    const color = hex(value);
    if (!color) continue;
    const kitty = key.match(/^color(\d{1,2})$/);
    if (kitty && +kitty[1] < 16) { scheme.palette[+kitty[1]] = color; continue; }
    // Alacritty: [colors.normal] red = '#…' / [colors.bright] red = '#…'
    const ansi = ANSI_NAMES.indexOf(key);
    if (ansi >= 0 && /(normal|bright)$/.test(section)) {
      scheme.palette[ansi + (section.endsWith('bright') ? 8 : 0)] = color;
      continue;
    }
    if (key === 'background' && !/(selection|cursor|search|hints|footer)/.test(section)) scheme.background ??= color;
    else if (key === 'foreground' && !/(selection|cursor|search|hints|footer)/.test(section)) scheme.foreground ??= color;
    else if (key === 'selectionbackground' || (key === 'background' && section.endsWith('selection'))) scheme.selection ??= color;
  }
  return scheme;
}

/** A pasted scheme as theme colors, or null when it isn't one — at least a
 *  background, a foreground and the six ansi hues (red to cyan) are needed. */
export function parseScheme(text: string): { name: string | null; colors: ThemeColors } | null {
  const s = fromJson(text.trim()) ?? fromLines(text);
  const { background: bg, foreground: fg, palette: p } = s;
  if (!bg || !fg || [1, 2, 3, 4, 5, 6].some((i) => !p[i])) return null;
  const blue = p[4]!;
  // Bright black is the scheme's own comment grey — unless it sits so close to
  // the background that it would be unreadable as secondary text.
  const brightBlack = p[8];
  const muted = brightBlack && Math.abs(gray(brightBlack) - gray(bg)) > 60 ? brightBlack : mix(bg, fg, 0.5);
  return {
    name: s.name ?? null,
    colors: {
      ...DEFAULT_THEME.colors,
      background: bg,
      foreground: fg,
      card: mix(bg, fg, 0.04),
      border: mix(bg, fg, 0.12),
      primary: blue,
      blue,
      mutedForeground: muted,
      usage: blue,
      destructive: p[1]!,
      success: p[2]!,
      warning: p[3]!,
      magenta: p[5]!,
      cyan: p[6]!,
      selection: s.selection ?? mix(bg, blue, 0.3),
    },
  };
}

function gray(color: string): number {
  return [1, 3, 5].reduce((sum, i) => sum + parseInt(color.slice(i, i + 2), 16), 0) / 3;
}
