import React, { useMemo } from 'react';
import { parseMarkdown, type MdInline } from '@/lib/markdown';

function Inlines({ parts }: { parts: MdInline[] }): React.ReactNode {
  return parts.map((p, i) => {
    switch (p.t) {
      case 'code':
        return (
          <code key={i} className="font-mono text-[0.85em] px-1 py-px rounded-[3px] bg-white/[0.05] border border-border text-[#c792ea]">
            {p.v}
          </code>
        );
      case 'strong':
        return <strong key={i} className="font-semibold text-foreground">{p.v}</strong>;
      case 'link':
        return (
          <a key={i} href={p.href} className="text-primary underline decoration-primary/30 underline-offset-2 cursor-pointer">
            {p.v}
          </a>
        );
      default:
        return <React.Fragment key={i}>{p.v}</React.Fragment>;
    }
  });
}

/** Renders Session Reader Markdown as React elements. Prose is proportional
 *  (the "document" voice); code stays monospace. */
export default function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);

  return (
    <div className="flex flex-col gap-3 font-sans text-[14.5px] leading-[1.62] text-[#d7dae1]">
      {blocks.map((block, i) => {
        switch (block.t) {
          case 'heading': {
            const cls = 'font-semibold text-foreground mt-1 [text-wrap:balance] ' +
              (block.level === 1 ? 'text-[16px]' : block.level === 2 ? 'text-[14.5px]' : 'text-[13px]');
            if (block.level === 1) return <h1 key={i} className={cls}><Inlines parts={block.inlines} /></h1>;
            if (block.level === 2) return <h2 key={i} className={cls}><Inlines parts={block.inlines} /></h2>;
            return <h3 key={i} className={cls}><Inlines parts={block.inlines} /></h3>;
          }
          case 'code':
            return (
              <div key={i} className="rounded-lg border border-border bg-[#0a0b0e] overflow-x-auto scrollbar-thin">
                {block.lang && (
                  <div className="px-3 py-1.5 border-b border-border text-[10.5px] tracking-[0.04em] text-muted-foreground">
                    {block.lang}
                  </div>
                )}
                <pre className="m-0 p-3 font-mono text-[12.5px] leading-[1.6] text-foreground whitespace-pre">{block.code}</pre>
              </div>
            );
          case 'list':
            return block.ordered ? (
              <ol key={i} className="list-decimal pl-5 flex flex-col gap-1 marker:text-primary">
                {block.items.map((item, j) => <li key={j}><Inlines parts={item} /></li>)}
              </ol>
            ) : (
              <ul key={i} className="list-disc pl-5 flex flex-col gap-1 marker:text-primary">
                {block.items.map((item, j) => <li key={j}><Inlines parts={item} /></li>)}
              </ul>
            );
          case 'quote':
            return (
              <blockquote key={i} className="border-l-2 border-border pl-3 text-muted-foreground">
                <Inlines parts={block.inlines} />
              </blockquote>
            );
          default:
            return <p key={i} className="m-0"><Inlines parts={block.inlines} /></p>;
        }
      })}
    </div>
  );
}
