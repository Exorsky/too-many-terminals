import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time';

const NOW = new Date('2026-07-12T12:00:00.000Z').getTime();

describe('relativeTime', () => {
  it('says "just now" under a minute', () => {
    expect(relativeTime('2026-07-12T11:59:30.000Z', NOW)).toBe('just now');
  });

  it('formats minutes, hours and days', () => {
    expect(relativeTime('2026-07-12T11:55:00.000Z', NOW)).toBe('5m ago');
    expect(relativeTime('2026-07-12T09:00:00.000Z', NOW)).toBe('3h ago');
    expect(relativeTime('2026-07-09T12:00:00.000Z', NOW)).toBe('3d ago');
  });
});
