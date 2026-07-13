import { describe, expect, it } from 'vitest';
import { fuzzyScore } from './fuzzy';

describe('fuzzyScore', () => {
  it('matches a subsequence, not just substrings', () => {
    expect(fuzzyScore('ag', 'api-gateway')).not.toBeNull();
    expect(fuzzyScore('fxath', 'Fix auth')).not.toBeNull();
  });

  it('returns null when a character is missing', () => {
    expect(fuzzyScore('xyz', 'api-gateway')).toBeNull();
  });

  it('matches everything on an empty query', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
    expect(fuzzyScore('   ', 'anything')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('FIX', 'fix auth redirect')).not.toBeNull();
  });

  it('ranks word-boundary starts above mid-word hits', () => {
    const boundary = fuzzyScore('ag', 'api-gateway')!; // a…g both at word starts
    const midword = fuzzyScore('ag', 'images')!; // a…g mid-word
    expect(boundary).toBeGreaterThan(midword);
  });

  it('ranks consecutive matches above scattered ones', () => {
    const consecutive = fuzzyScore('fix', 'fixture')!;
    const scattered = fuzzyScore('fix', 'far index')!;
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it('ignores spaces in the query so terms can be typed loosely', () => {
    expect(fuzzyScore('fix auth', 'fix-auth-redirect')).not.toBeNull();
  });
});
