/**
 * Tiny fuzzy subsequence scorer for the command palette. `query` matches
 * `text` when its characters appear in order (not necessarily adjacent),
 * case-insensitively. Returns a score (higher = better) or `null` for no match.
 *
 * Scoring rewards the things that make a match feel "right": consecutive
 * characters, and characters that land at the start of a word (after a space,
 * `-`, `_`, `/`, or `\`) — so "ag" ranks "api-gateway" above "images". An empty
 * query matches everything with a flat score, so the palette shows all entries.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (q === '') return 0;

  let score = 0;
  let ti = 0;
  let streak = 0;

  for (const ch of q) {
    if (ch === ' ') continue; // spaces separate terms, don't require them literally
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;

    streak = found === ti ? streak + 1 : 0;
    let bonus = 1 + streak;
    if (found === 0 || /[\s\-_/\\]/.test(t[found - 1])) bonus += 3; // word-boundary start
    score += bonus;
    ti = found + 1;
  }

  // Nudge toward tighter matches so a short exact-ish name beats a long one.
  return score - t.length * 0.01;
}
