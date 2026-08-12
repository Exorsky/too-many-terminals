import React, { useMemo } from 'react';
import { parseMarkdown, type MdInline, type MdListItem } from '@/lib/markdown';
import * as ipc from '@/lib/ipc';

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
      case 'em':
        return <em key={i} className="italic">{p.v}</em>;
      case 'link':
        return (
          <a
            key={i}
            href={p.href}
            className="text-primary underline decoration-primary/30 underline-offset-2 cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              ipc.openExternal(p.href);
            }}
          >
            {p.v}
          </a>
        );
      default:
        return <React.Fragment key={i}>{p.v}</React.Fragment>;
    }
  });
}

/** Renders a list's items, recursing into a nested `sublist` and rendering a
 *  `- [ ]`/`- [x]` item as a disabled checkbox instead of a bullet. */
function ListItems({ ordered, items }: { ordered: boolean; items: MdListItem[] }): React.ReactNode {
  const items_ = items.map((item, j) => (
    <li key={j} className={item.checked !== undefined ? 'list-none' : undefined}>
      {item.checked !== undefined ? (
        <label className="inline-flex items-start gap-1.5 cursor-default">
          <input type="checkbox" checked={item.checked} readOnly disabled className="mt-1 accent-primary" />
          <span className={item.checked ? 'line-through text-muted-foreground' : undefined}>
            <Inlines parts={item.inlines} />
          </span>
        </label>
      ) : (
        <Inlines parts={item.inlines} />
      )}
      {item.sublist && (
        <div className="mt-1">
          <ListItems ordered={item.sublist.ordered} items={item.sublist.items} />
        </div>
      )}
    </li>
  ));
  return ordered ? (
    <ol className="list-decimal pl-5 flex flex-col gap-1 marker:text-primary">{items_}</ol>
  ) : (
    <ul className="list-disc pl-5 flex flex-col gap-1 marker:text-primary">{items_}</ul>
  );
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
            return <React.Fragment key={i}><ListItems ordered={block.ordered} items={block.items} /></React.Fragment>;
          case 'hr':
            return <hr key={i} className="border-border" />;
          case 'quote':
            return (
              <blockquote key={i} className="border-l-2 border-border pl-3 text-muted-foreground">
                <Inlines parts={block.inlines} />
              </blockquote>
            );
          case 'table':
            return (
              <div key={i} className="overflow-x-auto rounded-lg border border-border scrollbar-thin">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-white/[0.03] border-b border-border">
                      {block.header.map((cell, j) => (
                        <th key={j} className="px-3 py-1.5 font-semibold text-foreground whitespace-nowrap" style={{ textAlign: block.align[j] ?? 'left' }}>
                          <Inlines parts={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-b border-border last:border-b-0">
                        {row.map((cell, c) => (
                          <td key={c} className="px-3 py-1.5 align-top" style={{ textAlign: block.align[c] ?? 'left' }}>
                            <Inlines parts={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <p key={i} className="m-0"><Inlines parts={block.inlines} /></p>;
        }
      })}
    </div>
  );
}
