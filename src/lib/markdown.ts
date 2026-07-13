/**
 * A deliberately small Markdown parser for the Session Reader — enough to
 * render what Claude Code actually emits (headings, fenced code, lists, bold,
 * inline code, links) without pulling in a full CommonMark dependency. It
 * produces a plain data model; `Markdown.tsx` turns that into React elements,
 * so React does all HTML escaping and there's no `dangerouslySetInnerHTML`.
 */

export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; v: string }
  | { t: 'link'; v: string; href: string };

export type MdBlock =
  | { t: 'heading'; level: 1 | 2 | 3; inlines: MdInline[] }
  | { t: 'paragraph'; inlines: MdInline[] }
  | { t: 'code'; lang: string; code: string }
  | { t: 'list'; ordered: boolean; items: MdInline[][] }
  | { t: 'quote'; inlines: MdInline[] };

/** Splits a single line of text into inline spans (code, bold, links). The
 *  scan is left-to-right and non-nesting — a `**bold**` span is emitted whole,
 *  not re-parsed for links inside — which is plenty for transcript prose. */
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

    buf += c;
    i += 1;
  }

  flush();
  return out;
}

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const UL_RE = /^[-*]\s+(.*)$/;
const OL_RE = /^\d+\.\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const FENCE_RE = /^```(.*)$/;

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

    const isUl = UL_RE.test(line);
    const isOl = OL_RE.test(line);
    if (isUl || isOl) {
      flushPara();
      const ordered = isOl;
      const re = ordered ? OL_RE : UL_RE;
      const items: MdInline[][] = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push(parseInline(re.exec(lines[i])![1]));
        i += 1;
      }
      i -= 1; // step back; the for-loop will advance past the last item.
      blocks.push({ t: 'list', ordered, items });
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      flushPara();
      blocks.push({ t: 'quote', inlines: parseInline(quote[1]) });
      continue;
    }

    para.push(line);
  }

  flushPara();
  return blocks;
}
