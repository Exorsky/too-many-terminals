/**
 * Serializes parsed transcript turns back to Markdown — the source shown in the
 * Reader's Raw view, copied per-turn on hover, and copied whole by "Copy all".
 * Tool chips render as blockquotes so the copied text still reads as a document.
 */
import type { TranscriptBlock, TranscriptTurn } from '@/types';

export function roleLabel(role: TranscriptTurn['role']): string {
  return role === 'user' ? 'You' : 'Claude';
}

function blockToMarkdown(block: TranscriptBlock): string {
  if (block.kind === 'text') return block.text;
  if (!block.detail) return `> ${block.name}`;
  // Quote every line so a multi-line command stays a single blockquote.
  const [first, ...rest] = block.detail.split('\n');
  return [`> ${block.name}: ${first}`, ...rest.map((l) => `> ${l}`)].join('\n');
}

/** One turn's body as Markdown (no role heading) — used for per-turn copy. */
export function turnToMarkdown(turn: TranscriptTurn): string {
  return turn.blocks.map(blockToMarkdown).join('\n\n');
}

/** The whole conversation as a Markdown document, each turn under a `## You` /
 *  `## Claude` heading. */
export function transcriptToMarkdown(turns: TranscriptTurn[]): string {
  return turns
    .map((turn) => `## ${roleLabel(turn.role)}\n\n${turnToMarkdown(turn)}`)
    .join('\n\n');
}
