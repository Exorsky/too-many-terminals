import { describe, expect, it } from 'vitest';
import { parseScheme } from './theme-import';

const HUES = { red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5' };

describe('importing a color scheme', () => {
  it('reads a Windows Terminal scheme, purple and all', () => {
    const json = JSON.stringify({
      name: 'Mocha', background: '#1E1E2E', foreground: '#CDD6F4', black: '#45475A',
      red: HUES.red, green: HUES.green, yellow: HUES.yellow, blue: HUES.blue, purple: HUES.magenta, cyan: HUES.cyan,
      white: '#BAC2DE', brightBlack: '#585B70', selectionBackground: '#585B70',
    });
    const s = parseScheme(json)!;
    expect(s.name).toBe('Mocha');
    expect(s.colors).toMatchObject({ background: '#1e1e2e', foreground: '#cdd6f4', magenta: HUES.magenta, blue: HUES.blue, primary: HUES.blue, selection: '#585b70' });
  });

  it('reads a scheme copied out of settings.json: comments, trailing comma, no braces', () => {
    const members = `// my scheme\n"name": "Pasted", "background": "#101010", "foreground": "#eeeeee",\n${
      Object.entries(HUES).map(([n, c]) => `"${n === 'magenta' ? 'purple' : n}": "${c}",`).join('\n')}`;
    expect(parseScheme(members)!.name).toBe('Pasted');
    expect(parseScheme(`{\n${members}\n},`)!.colors.cyan).toBe(HUES.cyan);
  });

  it('reads Ghostty, with or without #', () => {
    const text = `# comment\nbackground = 1e1e2e\nforeground = #cdd6f4\n${
      Object.values(HUES).map((c, i) => `palette = ${i + 1}=${c}`).join('\n')}\npalette = 8=#7f849c\nselection-background = 353749`;
    const s = parseScheme(text)!;
    expect(s.colors).toMatchObject({ background: '#1e1e2e', destructive: HUES.red, cyan: HUES.cyan, mutedForeground: '#7f849c', selection: '#353749' });
  });

  it('reads kitty', () => {
    const text = `background #1e1e2e\nforeground #cdd6f4\n${
      Object.values(HUES).map((c, i) => `color${i + 1} ${c}`).join('\n')}\nselection_background #353749`;
    expect(parseScheme(text)!.colors.warning).toBe(HUES.yellow);
  });

  it('reads Alacritty TOML sections, and the selection background is not the background', () => {
    const text = `[colors.primary]\nbackground = '#1e1e2e'\nforeground = '#cdd6f4'\n[colors.selection]\nbackground = '#353749'\n[colors.normal]\n${
      Object.entries(HUES).map(([n, c]) => `${n} = '${c}'`).join('\n')}\n[colors.bright]\nblack = '#7f849c'`;
    const s = parseScheme(text)!;
    expect(s.colors).toMatchObject({ background: '#1e1e2e', selection: '#353749', success: HUES.green, mutedForeground: '#7f849c' });
  });

  it('refuses text that is not a scheme', () => {
    expect(parseScheme('hello world')).toBeNull();
    expect(parseScheme('background = #000000\nforeground = #ffffff')).toBeNull();
    expect(parseScheme('{"name": "x"}')).toBeNull();
  });

  it('a bright black that vanishes into the background is not used as muted text', () => {
    const text = `background #1e1e2e\nforeground #cdd6f4\n${
      Object.values(HUES).map((c, i) => `color${i + 1} ${c}`).join('\n')}\ncolor8 #202030`;
    expect(parseScheme(text)!.colors.mutedForeground).not.toBe('#202030');
  });
});
