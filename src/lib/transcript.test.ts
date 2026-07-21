import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '@/types';
import { transcriptToMarkdown, turnToMarkdown } from './transcript';

const turns: TranscriptTurn[] = [
  { role: 'user', timestamp: null, blocks: [{ kind: 'text', text: 'fix pty.rs' }] },
  {
    role: 'assistant',
    timestamp: null,
    blocks: [
      { kind: 'text', text: 'On it.' },
      { kind: 'tool', name: 'Read', detail: 'src/pty.rs' },
    ],
  },
];

describe('turnToMarkdown', () => {
  it('joins text and renders a tool chip as a blockquote', () => {
    expect(turnToMarkdown(turns[1])).toBe('On it.\n\n> Read: src/pty.rs');
  });

  it('omits the colon when a tool has no detail', () => {
    expect(turnToMarkdown({ role: 'assistant', timestamp: null, blocks: [{ kind: 'tool', name: 'TodoWrite', detail: '' }] }))
      .toBe('> TodoWrite');
  });

  it('quotes every line of a multi-line command so it stays one blockquote', () => {
    const block = { kind: 'tool' as const, name: 'PowerShell', detail: '$s = "x"\nnode $s list' };
    expect(turnToMarkdown({ role: 'assistant', timestamp: null, blocks: [block] }))
      .toBe('> PowerShell: $s = "x"\n> node $s list');
  });
});

describe('transcriptToMarkdown', () => {
  it('prefixes each turn with a role heading', () => {
    expect(transcriptToMarkdown(turns)).toBe('## You\n\nfix pty.rs\n\n## Claude\n\nOn it.\n\n> Read: src/pty.rs');
  });
});
