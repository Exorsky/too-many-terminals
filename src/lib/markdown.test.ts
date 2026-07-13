import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

describe('parseInline', () => {
  it('splits code, bold, and links out of surrounding text', () => {
    expect(parseInline('use `taskkill` to **kill** the [tree](https://x)')).toEqual([
      { t: 'text', v: 'use ' },
      { t: 'code', v: 'taskkill' },
      { t: 'text', v: ' to ' },
      { t: 'strong', v: 'kill' },
      { t: 'text', v: ' the ' },
      { t: 'link', v: 'tree', href: 'https://x' },
    ]);
  });

  it('leaves an unterminated marker as literal text', () => {
    expect(parseInline('a `b c')).toEqual([{ t: 'text', v: 'a `b c' }]);
  });
});

describe('parseMarkdown', () => {
  it('parses headings and folds wrapped lines into one paragraph', () => {
    const blocks = parseMarkdown('### Why\n\nfirst line\nsecond line');
    expect(blocks[0]).toEqual({ t: 'heading', level: 3, inlines: [{ t: 'text', v: 'Why' }] });
    expect(blocks[1]).toEqual({ t: 'paragraph', inlines: [{ t: 'text', v: 'first line second line' }] });
  });

  it('keeps fenced code verbatim, including blank lines, with its language', () => {
    const blocks = parseMarkdown('```rust\nfn kill() {\n\n}\n```');
    expect(blocks).toEqual([{ t: 'code', lang: 'rust', code: 'fn kill() {\n\n}' }]);
  });

  it('does not treat markers inside a fence as blocks', () => {
    const blocks = parseMarkdown('```\n# not a heading\n- not a list\n```\nafter');
    expect(blocks[0]).toEqual({ t: 'code', lang: '', code: '# not a heading\n- not a list' });
    expect(blocks[1]).toEqual({ t: 'paragraph', inlines: [{ t: 'text', v: 'after' }] });
  });

  it('groups consecutive bullets into one list and stops at prose', () => {
    const blocks = parseMarkdown('- one\n- two\nplain');
    expect(blocks[0]).toEqual({
      t: 'list',
      ordered: false,
      items: [[{ t: 'text', v: 'one' }], [{ t: 'text', v: 'two' }]],
    });
    expect(blocks[1]).toEqual({ t: 'paragraph', inlines: [{ t: 'text', v: 'plain' }] });
  });

  it('recognizes ordered lists', () => {
    const blocks = parseMarkdown('1. first\n2. second');
    expect(blocks[0]).toEqual({
      t: 'list',
      ordered: true,
      items: [[{ t: 'text', v: 'first' }], [{ t: 'text', v: 'second' }]],
    });
  });
});
