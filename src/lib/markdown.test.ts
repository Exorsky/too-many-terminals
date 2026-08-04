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

  it('parses single-star italics without eating snake_case words', () => {
    expect(parseInline('a *quick* look at max_retries_count')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'em', v: 'quick' },
      { t: 'text', v: ' look at max_retries_count' },
    ]);
  });

  it('autolinks a bare URL and trims trailing punctuation', () => {
    expect(parseInline('see https://example.com/x, then stop.')).toEqual([
      { t: 'text', v: 'see ' },
      { t: 'link', v: 'https://example.com/x', href: 'https://example.com/x' },
      { t: 'text', v: ', then stop.' },
    ]);
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
      items: [{ inlines: [{ t: 'text', v: 'one' }] }, { inlines: [{ t: 'text', v: 'two' }] }],
    });
    expect(blocks[1]).toEqual({ t: 'paragraph', inlines: [{ t: 'text', v: 'plain' }] });
  });

  it('recognizes ordered lists', () => {
    const blocks = parseMarkdown('1. first\n2. second');
    expect(blocks[0]).toEqual({
      t: 'list',
      ordered: true,
      items: [{ inlines: [{ t: 'text', v: 'first' }] }, { inlines: [{ t: 'text', v: 'second' }] }],
    });
  });

  it('nests an indented sub-list under its parent item', () => {
    const blocks = parseMarkdown('- one\n  - nested a\n  - nested b\n- two');
    expect(blocks[0]).toEqual({
      t: 'list',
      ordered: false,
      items: [
        {
          inlines: [{ t: 'text', v: 'one' }],
          sublist: {
            ordered: false,
            items: [{ inlines: [{ t: 'text', v: 'nested a' }] }, { inlines: [{ t: 'text', v: 'nested b' }] }],
          },
        },
        { inlines: [{ t: 'text', v: 'two' }] },
      ],
    });
  });

  it('reads checkbox items and strips the marker from the text', () => {
    const blocks = parseMarkdown('- [ ] todo\n- [x] done');
    expect(blocks[0]).toEqual({
      t: 'list',
      ordered: false,
      items: [
        { inlines: [{ t: 'text', v: 'todo' }], checked: false },
        { inlines: [{ t: 'text', v: 'done' }], checked: true },
      ],
    });
  });

  it('reads a horizontal rule on its own line', () => {
    const blocks = parseMarkdown('before\n\n---\n\nafter');
    expect(blocks).toEqual([
      { t: 'paragraph', inlines: [{ t: 'text', v: 'before' }] },
      { t: 'hr' },
      { t: 'paragraph', inlines: [{ t: 'text', v: 'after' }] },
    ]);
  });

  it('parses a pipe table with alignment and stops at a blank line', () => {
    const blocks = parseMarkdown('| Name | Price |\n| --- | ---: |\n| Foo | $1 |\n| Bar | $2 |\n\nafter');
    expect(blocks[0]).toEqual({
      t: 'table',
      header: [[{ t: 'text', v: 'Name' }], [{ t: 'text', v: 'Price' }]],
      align: ['left', 'right'],
      rows: [
        [[{ t: 'text', v: 'Foo' }], [{ t: 'text', v: '$1' }]],
        [[{ t: 'text', v: 'Bar' }], [{ t: 'text', v: '$2' }]],
      ],
    });
    expect(blocks[1]).toEqual({ t: 'paragraph', inlines: [{ t: 'text', v: 'after' }] });
  });

  it('does not treat a plain line with a stray pipe as a table', () => {
    const blocks = parseMarkdown('a | b\nnot a separator');
    expect(blocks[0]).toEqual({ t: 'paragraph', inlines: [{ t: 'text', v: 'a | b not a separator' }] });
  });
});
