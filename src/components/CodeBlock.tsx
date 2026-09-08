import CopyButton from './CopyButton';

/** A fenced code block: language label, horizontal scroll, and a copy button
 *  that appears on hover. The scroll lives on an inner element so the button
 *  stays put while a wide line scrolls under it. */
export default function CodeBlock({ lang, code }: { lang?: string; code: string }) {
  return (
    <div className="group relative rounded-lg border border-border bg-[#0a0b0e] overflow-hidden">
      {lang && (
        <div className="px-3 py-1.5 border-b border-border text-[10.5px] tracking-[0.04em] text-muted-foreground">
          {lang}
        </div>
      )}
      <div className="overflow-x-auto scrollbar-thin">
        <pre className="m-0 p-3 font-mono text-[12.5px] leading-[1.6] text-foreground whitespace-pre">{code}</pre>
      </div>
      <CopyButton
        text={code}
        label="Copy"
        className="absolute right-1.5 top-1.5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 transition-opacity"
      />
    </div>
  );
}
