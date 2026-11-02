import { describe, expect, it, vi } from 'vitest';

vi.mock('./ipc', () => ({
  statPaths: vi.fn(async (_cwd: string, paths: string[]) =>
    paths.map((p) => (p.startsWith('src') ? { path: `/repo/${p}`, isDir: false, size: 1 } : null))),
  homeDir: vi.fn(async () => '/home/me'),
}));

vi.mock('./file-search', () => ({
  searchFiles: vi.fn(async () => [{ name: 'path-links.md', path: 'src/docs/path-links.md', root: '/repo' }]),
}));

import * as ipc from './ipc';
import { searchFiles } from './file-search';
import { findPaths, imageType, knownPaths, outermost, resolvePath, statPaths, wholePath } from './path-links';

const paths = (line: string) => findPaths(line).map((m) => m.path);

describe('findPaths', () => {
  it('finds relative, absolute, home and Windows paths', () => {
    expect(paths('⏺ Update(src/components/Terminal.tsx)')).toEqual(['src/components/Terminal.tsx']);
    expect(paths('see /etc/hosts and ~/notes.md')).toEqual(['/etc/hosts', '~/notes.md']);
    expect(paths('cd ../docs/ then ./run.sh')).toEqual(['../docs/', './run.sh']);
    expect(paths('C:\\proj\\app.ts failed')).toEqual(['C:\\proj\\app.ts']);
  });

  it('takes a bare file name only when it has an extension', () => {
    expect(paths('edit package.json and README.md, not README')).toEqual(['package.json', 'README.md']);
  });

  it('underlines a :line:col suffix but leaves it out of the path', () => {
    const [m] = findPaths('at src/app.ts:12:5 here');
    expect(m).toEqual({ path: 'src/app.ts', index: 3, length: 'src/app.ts:12:5'.length });
  });

  it('drops the full stop that ends a sentence', () => {
    expect(paths('Wrote docs/x.md.')).toEqual(['docs/x.md']);
  });

  it('finds a quoted path with spaces, then keeps the longest that exists', () => {
    const line = 'Wrote "C:\\Users\\John Smith\\notes.md" and \'/Users/me/My Docs/a.png\'';
    const found = findPaths(line);
    expect(found.map((m) => m.path)).toContain('C:\\Users\\John Smith\\notes.md');
    expect(found.map((m) => m.path)).toContain('/Users/me/My Docs/a.png');
    expect(outermost(found).map((m) => m.path))
      .toEqual(['C:\\Users\\John Smith\\notes.md', '/Users/me/My Docs/a.png']);
  });

  it("an apostrophe pairing with a later quote doesn't hide a real path", () => {
    const found = findPaths("don't touch src/a.ts or it's gone");
    const existing = found.filter((m) => m.path === 'src/a.ts'); // the quoted run doesn't exist
    expect(outermost(existing).map((m) => m.path)).toEqual(['src/a.ts']);
  });

  it('skips URLs, versions, dates and fractions', () => {
    expect(paths('https://example.com/a/b.png')).toEqual([]);
    expect(paths('v0.29.0 on 02/11/2026, 1/2')).toEqual([]);
  });
});

it('wholePath accepts a code span that is only a path', () => {
  expect(wholePath('src/app.ts:12')).toBe('src/app.ts');
  expect(wholePath('package.json')).toBe('package.json');
  expect(wholePath('npm run build')).toBeNull();
  expect(wholePath('useState')).toBeNull();
  expect(wholePath('foo.bar()')).toBeNull();
  expect(wholePath('C:\\Program Files\\app\\x.ini:3')).toBe('C:\\Program Files\\app\\x.ini');
  expect(wholePath('npm run build')).toBeNull();
});

it('imageType knows images by extension', () => {
  expect(imageType('/a/logo.SVG')).toBe('image/svg+xml');
  expect(imageType('shot.png')).toBe('image/png');
  expect(imageType('app.ts')).toBeNull();
});

it('statPaths asks once per path and keeps the answer in order', async () => {
  const first = await statPaths('/repo', ['src/a.ts', 'and/or', 'src/a.ts']);
  expect(first.map((i) => i?.path ?? null)).toEqual(['/repo/src/a.ts', null, '/repo/src/a.ts']);
  await statPaths('/repo', ['and/or', 'src/a.ts']);
  expect(ipc.statPaths).toHaveBeenCalledTimes(1);
  expect(ipc.statPaths).toHaveBeenCalledWith('/repo', ['src/a.ts', 'and/or']);
});

it('resolvePath finds a bare file name deeper in the tree, by its exact name', async () => {
  // The mocked stat knows only paths under src/: path-links.md at the root misses.
  expect((await resolvePath('/repo', 'path-links.md'))?.path).toBe('/repo/src/docs/path-links.md');
  expect(searchFiles).toHaveBeenLastCalledWith(['/repo'], 'path-links.md', 1, true);
  expect(await resolvePath('/repo', 'docs/missing.md')).toBeNull(); // a path with a folder is never searched
  expect(await resolvePath('/home/me/', 'notes.md')).toBeNull(); // never walks all of ~
  expect(searchFiles).toHaveBeenCalledTimes(1);
});

it('knownPaths answers from the cache without waiting, and only when every path was asked', async () => {
  expect(knownPaths('/k', ['src/b.ts'])).toBeUndefined();
  await statPaths('/k', ['src/b.ts', 'nope/x']);
  expect(knownPaths('/k', ['nope/x', 'src/b.ts'])?.map((i) => i?.path ?? null)).toEqual([null, '/repo/src/b.ts']);
  expect(knownPaths('/k', ['src/b.ts', 'src/c.ts'])).toBeUndefined();
});
