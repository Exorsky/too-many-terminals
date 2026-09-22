import { Children, isValidElement, useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as ipc from '@/lib/ipc';
import { isExternalHref } from '@/lib/paths';
import { cn } from '@/lib/utils';
import CodeBlock from './CodeBlock';
import Mermaid from './Mermaid';

interface MarkdownProps {
  source: string;
  /** Called for a link that points at a file rather than the web — the raw
   *  href, resolved by whoever knows which file this text came from
   *  (`FileViewer`). Without it such links do nothing, which is what a
   *  transcript wants: it has no file to resolve against. */
  onOpenLink?: (href: string) => void;
}

type HastNode = { value?: string; children?: HastNode[] };

/** The text of a hast node, for turning a heading into an anchor id. */
function hastText(node?: HastNode): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(hastText).join('');
}

/** The id GitHub would give this heading, so a `#some-heading` link written
 *  for GitHub lands in the right place here too. */
export function slug(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

const HEADING_CLS: Record<number, string> = {
  1: 'text-[16px]',
  2: 'text-[14.5px]',
  3: 'text-[13px]',
  4: 'text-[12.5px]',
  5: 'text-[12px] text-muted-foreground',
  6: 'text-[12px] text-muted-foreground',
};

function heading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  const Tag = `h${level}` as const;
  return function Heading({ node, children }: { children?: ReactNode } & ExtraProps) {
    return (
      <Tag
        id={slug(hastText(node as HastNode | undefined))}
        className={cn('font-semibold text-foreground mt-1 [text-wrap:balance] scroll-mt-4', HEADING_CLS[level])}
      >
        {children}
      </Tag>
    );
  };
}

/** Renders Markdown as React elements — CommonMark plus GitHub extensions
 *  (tables, task lists, strikethrough, autolinks) through `react-markdown`,
 *  which builds real elements rather than HTML, so nothing is injected as raw
 *  markup. Prose is proportional (the document voice); code stays monospace. */
export default function Markdown({ source, onOpenLink }: MarkdownProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  /** A `#anchor` scrolls inside this document. Scoped to this instance first —
   *  a transcript mounts one Markdown per turn, so ids repeat down the page
   *  and the nearest one is the right one. */
  const scrollToAnchor = (id: string) => {
    let target: Element | null = null;
    try {
      target = rootRef.current?.querySelector(`[id="${CSS.escape(id)}"]`) ?? null;
    } catch {
      /* CSS.escape missing — fall through to the document lookup */
    }
    (target ?? rootRef.current?.ownerDocument.getElementById(id))?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  // Whatever the current render's handlers are. Held in a ref so `components`
  // below can be built once and still call through to them.
  const liveRef = useRef({ onOpenLink, scrollToAnchor });
  liveRef.current = { onOpenLink, scrollToAnchor };

  // Built ONCE. react-markdown maps tag names to these functions, and React
  // compares element types by reference — so rebuilding this object every render
  // hands every tag a brand-new component type and React unmounts and remounts
  // the entire document. That threw away any text the reader had selected, and
  // reset every <Mermaid> to its "not rendered yet" state, which is why a
  // diagram flashed its own source and the page jumped. The two handlers that
  // need live values read them from a ref at click time instead of being baked
  // in as dependencies.
  const components = useMemo<Components>(() => ({
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),

    a({ href, children }) {
      const target = href ?? '';
      return (
        <a
          href={target}
          title={target}
          className="text-primary underline decoration-primary/30 underline-offset-2 cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            if (target.startsWith('#')) {
              let id = target.slice(1);
              try { id = decodeURIComponent(id); } catch { /* keep it as written */ }
              liveRef.current.scrollToAnchor(id);
            } else if (isExternalHref(target)) {
              ipc.openExternal(target);
            } else if (target) {
              liveRef.current.onOpenLink?.(target);
            }
          }}
        >
          {children}
        </a>
      );
    },

    // A fenced block arrives as <pre><code class="language-x">…</code></pre>;
    // taking it over here means the `code` component below only ever sees
    // inline code.
    pre({ children }) {
      const child = Children.toArray(children).find(isValidElement) as
        | ReactElement<{ className?: string; children?: ReactNode }>
        | undefined;
      const lang = /language-([\w+#-]+)/.exec(child?.props.className ?? '')?.[1] ?? '';
      const code = textOf(child?.props.children ?? children).replace(/\n$/, '');
      if (lang === 'mermaid') return <Mermaid chart={code} />;
      return <CodeBlock lang={lang} code={code} />;
    },

    code: ({ children }) => (
      <code className="font-mono text-[0.85em] px-1 py-px rounded-[3px] bg-raised border border-border text-[#c792ea]">
        {children}
      </code>
    ),

    p: ({ children }) => <p className="m-0">{children}</p>,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="text-muted-foreground">{children}</del>,
    hr: () => <hr className="border-border" />,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-border pl-3 text-muted-foreground flex flex-col gap-2">
        {children}
      </blockquote>
    ),

    ul: ({ children }) => <ul className="list-disc pl-5 flex flex-col gap-1 marker:text-primary">{children}</ul>,
    ol: ({ children, start }) => (
      <ol start={start} className="list-decimal pl-5 flex flex-col gap-1 marker:text-primary">
        {children}
      </ol>
    ),
    // A task-list item carries its own checkbox, so it drops the bullet and
    // greys out once ticked.
    li: ({ children, className }) => (
      <li
        className={cn(
          '[&>ul]:mt-1 [&>ol]:mt-1',
          className?.includes('task-list-item') &&
            'list-none [&:has(>input:checked)]:line-through [&:has(>input:checked)]:text-muted-foreground',
        )}
      >
        {children}
      </li>
    ),
    input: (props) => <input {...props} readOnly className="mr-1.5 accent-primary align-[-1px]" />,

    img: ({ src, alt }) => (
      <img
        src={typeof src === 'string' ? src : undefined}
        alt={alt}
        className="max-w-full rounded-md border border-border"
      />
    ),

    table: ({ children }) => (
      <div className="overflow-x-auto rounded-lg border border-border scrollbar-thin">
        <table className="w-full border-collapse text-[13px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-hover">{children}</thead>,
    tr: ({ children }) => <tr className="border-b border-border last:border-b-0">{children}</tr>,
    th: ({ children, style }) => (
      <th style={style} className="px-3 py-1.5 font-semibold text-foreground whitespace-nowrap text-left">
        {children}
      </th>
    ),
    td: ({ children, style }) => <td style={style} className="px-3 py-1.5 align-top">{children}</td>,
  }), []);

  return (
    <div ref={rootRef} className="flex flex-col gap-3 font-sans text-[14.5px] leading-[1.62] text-[#d7dae1]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
