/**
 * A deliberately small Markdown parser for the Session Reader — enough to
 * render what Claude Code actually emits (headings, fenced code, lists,
 * bold/italic, inline code, links, tables) without pulling in a full
 * CommonMark dependency. It produces a plain data model; `Markdown.tsx` turns
 * that into React elements, so React does all HTML escaping and there's no
 * `dangerouslySetInnerHTML`.
 */

export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; v: string }
  | { t: 'em'; v: string }
  | { t: 'link'; v: string; href: string };

export type MdAlign = 'left' | 'center' | 'right';

export interface MdListItem {
  inlines: MdInline[];
  /** Checkbox state for a `- [ ]` / `- [x]` item; absent for a plain item. */
  checked?: boolean;
  /** A nested list directly under this item, if any. */
  sublist?: { ordered: boolean; items: MdListItem[] };
}

export type MdBlock =
  | { t: 'heading'; level: 1 | 2 | 3; inlines: MdInline[] }
  | { t: 'paragraph'; inlines: MdInline[] }
  | { t: 'code'; lang: string; code: string }
  | { t: 'list'; ordered: boolean; items: MdListItem[] }
  | { t: 'quote'; inlines: MdInline[] }
  | { t: 'table'; header: MdInline[][]; align: MdAlign[]; rows: MdInline[][][] }
  | { t: 'hr' };

const URL_RE = /^https?:\/\/[^\s<>()[\]]+/;

/** Splits a single line of text into inline spans (code, bold, italic, links,
 *  bare URLs). The scan is left-to-right and non-nesting — a `**bold**` span
 *  is emitted whole, not re-parsed for links inside — which is plenty for
 *  transcript prose. */
export function parseInline(s: string): MdInline[] {
  const out: MdInline[] = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };

  while (i < s.length) {
    const c = s[i];

    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end !== -1) {
        flush();
        out.push({ t: 'code', v: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (c === '*' && s[i + 1] === '*') {
      const end = s.indexOf('**', i + 2);
      if (end !== -1) {
        flush();
        out.push({ t: 'strong', v: s.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

    // Single `*em*` — not `_em_`, which collides too often with snake_case
    // identifiers in prose (e.g. `max_retries_count`).
    if (c === '*') {
      const end = s.indexOf('*', i + 1);
      if (end !== -1 && end > i + 1) {
        flush();
        out.push({ t: 'em', v: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (c === '[') {
      const close = s.indexOf(']', i + 1);
      if (close !== -1 && s[close + 1] === '(') {
        const paren = s.indexOf(')', close + 2);
        if (paren !== -1) {
          flush();
          out.push({ t: 'link', v: s.slice(i + 1, close), href: s.slice(close + 2, paren) });
          i = paren + 1;
          continue;
        }
      }
    }

    if (c === 'h') {
      const m = URL_RE.exec(s.slice(i));
      if (m) {
        let url = m[0];
        while (url.length > 0 && /[.,;:!?]/.test(url[url.length - 1])) url = url.slice(0, -1);
        flush();
        out.push({ t: 'link', v: url, href: url });
        i += url.length;
        continue;
      }
    }

    buf += c;
    i += 1;
  }

  flush();
  return out;
}

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const LIST_ITEM_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const CHECKBOX_RE = /^\[([ xX])\]\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const FENCE_RE = /^```(.*)$/;
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/;

function isOrderedMarker(marker: string): boolean {
  return marker !== '-' && marker !== '*';
}

/** Consumes a run of list items at exactly `indent` spaces (recursing into
 *  any more-indented run as that item's `sublist`), stopping at the first
 *  line that isn't a list item at `indent` or deeper. Mutates `pos.v` to the
 *  index just past the consumed lines. */
function parseListItems(lines: string[], pos: { v: number }, indent: number): MdListItem[] {
  const items: MdListItem[] = [];

  while (pos.v < lines.length) {
    const m = LIST_ITEM_RE.exec(lines[pos.v]);
    if (!m || m[1].length !== indent) break;

    let text = m[3];
    let checked: boolean | undefined;
    const cb = CHECKBOX_RE.exec(text);
    if (cb) {
      checked = cb[1].toLowerCase() === 'x';
      text = cb[2];
    }
    pos.v += 1;

    let sublist: MdListItem['sublist'];
    const next = pos.v < lines.length ? LIST_ITEM_RE.exec(lines[pos.v]) : null;
    if (next && next[1].length > indent) {
      sublist = { ordered: isOrderedMarker(next[2]), items: parseListItems(lines, pos, next[1].length) };
    }

    items.push({ inlines: parseInline(text), checked, sublist });
  }

  return items;
}

/** Splits a `| a | b |` row into trimmed cell strings, dropping the outer pipes. */
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/** A table's second line: cells of only `-`/`:`, e.g. `| --- | :---: |`. */
function isTableSeparator(line: string): boolean {
  if (!line.includes('|')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/** Parses Markdown source into a flat list of blocks. Consecutive plain lines
 *  fold into one paragraph; blank lines separate blocks; a ``` fence runs
 *  verbatim (including blank lines) until its closing fence or end of input. */
export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: MdBlock[] = [];

  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      blocks.push({ t: 'paragraph', inlines: parseInline(para.join(' ')) });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushPara();
      const lang = fence[1].trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      // i now sits on the closing fence (or past the end); the loop's i++ steps over it.
      blocks.push({ t: 'code', lang, code: body.join('\n') });
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPara();
      blocks.push({
        t: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        inlines: parseInline(heading[2]),
      });
      continue;
    }

    if (HR_RE.test(line.trim())) {
      flushPara();
      blocks.push({ t: 'hr' });
      continue;
    }

    const topItem = LIST_ITEM_RE.exec(line);
    if (topItem && topItem[1].length === 0) {
      flushPara();
      const ordered = isOrderedMarker(topItem[2]);
      const pos = { v: i };
      const items = parseListItems(lines, pos, 0);
      i = pos.v - 1; // step back; the for-loop will advance past the last item.
      blocks.push({ t: 'list', ordered, items });
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      flushPara();
      blocks.push({ t: 'quote', inlines: parseInline(quote[1]) });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara();
      const header = splitTableRow(line).map(parseInline);
      const align: MdAlign[] = splitTableRow(lines[i + 1]).map((c) => {
        if (c.startsWith(':') && c.endsWith(':')) return 'center';
        if (c.endsWith(':')) return 'right';
        return 'left';
      });
      i += 2;
      const rows: MdInline[][][] = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]).map(parseInline));
        i += 1;
      }
      i -= 1; // step back; the for-loop will advance past the last row.
      blocks.push({ t: 'table', header, align, rows });
      continue;
    }

    para.push(line);
  }

  flushPara();
  return blocks;
}
