import { describe, expect, it } from 'vitest';
import { isExternalHref, resolveFrom, splitHref } from './paths';

describe('isExternalHref', () => {
  it('knows a scheme from a relative path', () => {
    expect(isExternalHref('https://example.com')).toBe(true);
    expect(isExternalHref('mailto:a@b.c')).toBe(true);
    expect(isExternalHref('docs/architecture.md')).toBe(false);
    expect(isExternalHref('../design.md')).toBe(false);
  });

  it('reads a Windows drive letter as a path, not a scheme', () => {
    expect(isExternalHref('C:\\proj\\README.md')).toBe(false);
  });
});

describe('splitHref', () => {
  it('separates the anchor and decodes both halves', () => {
    expect(splitHref('docs/a%20b.md#the-rail')).toEqual({ path: 'docs/a b.md', anchor: 'the-rail' });
    expect(splitHref('#top')).toEqual({ path: '', anchor: 'top' });
    expect(splitHref('plain.md')).toEqual({ path: 'plain.md', anchor: '' });
  });

  it('leaves a stray percent alone instead of throwing', () => {
    expect(splitHref('100%.md').path).toBe('100%.md');
  });
});

describe('resolveFrom', () => {
  it('resolves against the linking file, not the process cwd', () => {
    expect(resolveFrom('/proj/docs/features/x.md', 'y.md')).toBe('/proj/docs/features/y.md');
    expect(resolveFrom('/proj/docs/features/x.md', '../design.md')).toBe('/proj/docs/design.md');
    expect(resolveFrom('/proj/docs/x.md', './a/b.md')).toBe('/proj/docs/a/b.md');
  });

  it('keeps the source file separator on Windows paths', () => {
    expect(resolveFrom('C:\\proj\\CLAUDE.md', 'docs/architecture.md')).toBe('C:\\proj\\docs\\architecture.md');
    expect(resolveFrom('C:\\proj\\docs\\a.md', '../README.md')).toBe('C:\\proj\\README.md');
  });

  it('takes an absolute target as-is', () => {
    expect(resolveFrom('/proj/a.md', '/etc/hosts')).toBe('/etc/hosts');
    expect(resolveFrom('C:\\proj\\a.md', 'D:\\other\\b.md')).toBe('D:\\other\\b.md');
  });

  it('never climbs above the root', () => {
    expect(resolveFrom('/proj/a.md', '../../../../etc/passwd')).toBe('/etc/passwd');
  });
});
