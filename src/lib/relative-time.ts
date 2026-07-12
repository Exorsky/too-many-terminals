const UNITS: [number, string][] = [
  [60, 's'],
  [60, 'm'],
  [24, 'h'],
  [7, 'd'],
  [4.345, 'w'],
  [12, 'mo'],
  [Infinity, 'y'],
];

/** Compact relative time like "5m ago", "3d ago". Falls back to "just now" under a minute. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diffSeconds = (now - new Date(iso).getTime()) / 1000;
  if (diffSeconds < 60) return 'just now';

  let value = diffSeconds;
  for (const [step, label] of UNITS) {
    if (value < step || step === Infinity) {
      return `${Math.floor(value)}${label} ago`;
    }
    value /= step;
  }
  return 'just now';
}
