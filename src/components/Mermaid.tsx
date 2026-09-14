import { memo, useEffect, useId, useState } from 'react';
import CodeBlock from './CodeBlock';

/** `mermaid` is ~1 MB — loaded the first time a diagram actually shows up,
 *  never at startup. One module-level promise, so every diagram after the
 *  first reuses the same instance. */
let loading: Promise<typeof import('mermaid').default> | null = null;
function mermaid() {
  loading ??= import('mermaid').then((m) => {
    m.default.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'strict', // mermaid sanitizes the SVG it hands back
      suppressErrorRendering: true, // a bad diagram must not paint itself into <body>
      fontFamily: 'inherit',
    });
    return m.default;
  });
  return loading;
}

/** A ```mermaid fence rendered as a diagram. A diagram that doesn't parse
 *  falls back to its own source — while you're typing one, every keystroke
 *  is a half-written diagram, and blanking the pane on each of them would be
 *  worse than showing the text. */
function Mermaid({ chart }: { chart: string }) {
  const [svg, setSvg] = useState('');
  // Three states, not two: nothing has been attempted yet, it failed, or we
  // have a diagram. Without the first, a mount shows the raw source for as long
  // as mermaid takes to load (~1 MB on the first diagram) and then swaps it for
  // the picture — a flash of code and a jump in height every single time.
  const [failed, setFailed] = useState(false);
  const [tried, setTried] = useState(false);
  // useId is unique per instance; mermaid wants a plain DOM-id-safe string.
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useEffect(() => {
    let cancelled = false;
    mermaid()
      .then((m) => m.render(id, chart))
      .then((r) => {
        if (!cancelled) {
          setSvg(r.svg);
          setFailed(false);
          setTried(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSvg('');
          setFailed(true);
          setTried(true);
        }
      });
    return () => { cancelled = true; };
  }, [chart, id]);

  // Only a diagram that actually failed falls back to its source — while you're
  // typing one, every keystroke is a half-written diagram and blanking the pane
  // on each would be worse than showing the text.
  if (failed) return <CodeBlock lang="mermaid — couldn't render" code={chart} />;
  if (!svg) {
    return (
      <div
        data-testid="mermaid-pending"
        aria-busy={!tried}
        className="rounded-lg border border-border bg-[#0a0b0e] px-3 py-4 text-[11px] text-muted-foreground"
      >
        Rendering diagram…
      </div>
    );
  }
  return (
    <div
      className="rounded-lg border border-border bg-[#0a0b0e] p-3 overflow-x-auto scrollbar-thin [&_svg]:max-w-full [&_svg]:h-auto"
      // mermaid's own output, sanitized by it under securityLevel: 'strict'.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Memoised so an unchanged chart never re-renders: the diagram is injected
 *  with `dangerouslySetInnerHTML`, and re-setting that replaces the whole SVG
 *  subtree — enough on its own to drop a selection that reaches into it. */
export default memo(Mermaid);
