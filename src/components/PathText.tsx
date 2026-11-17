import { useEffect, useMemo, useState } from 'react';
import type { PathInfo } from '@/lib/ipc';
import { clickPathLink, findPaths, hidePathCard, outermost, showPathCard, statPaths, type PathMatch, type PathTarget } from '@/lib/path-links';
import { useSettings } from '@/lib/settings-store';

/** `cd /abs/dir && …` — the folder the rest of a command line runs in, so
 *  `cat notes.txt` after it resolves there rather than in the session's cwd.
 *  ponytail: absolute targets only, and only a leading `cd`; a relative `cd`
 *  or one mid-line falls back to the session's cwd. */
export function commandCwd(text: string): string | null {
  const m = /^\s*cd\s+(["']?)((?:[A-Za-z]:[\\/]|\/)[^"'&;|\n]*?)\1\s*(?:&&|;|\n)/.exec(text);
  return m ? m[2] : null;
}

/** Every path-shaped token, line by line — `findPaths` caps matches per line,
 *  and a long command or a multi-line script would run past it as one string. */
function candidates(text: string): PathMatch[] {
  const out: PathMatch[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    for (const m of findPaths(line)) out.push({ ...m, index: m.index + offset });
    offset += line.length + 1;
  }
  return out;
}

// One `statPaths` per cwd per tick: a transcript mounts hundreds of tool blocks
// at once, and each asking on its own is hundreds of IPC calls. After the batch
// lands every block's own `statPaths` is answered from its 10s cache.
let batch: Map<string, Set<string>> | null = null;
let flushed: Promise<unknown> = Promise.resolve();
function statSoon(cwd: string, paths: string[]): Promise<(PathInfo | null)[]> {
  if (!batch) {
    const b = (batch = new Map());
    flushed = Promise.resolve().then(() => {
      batch = null;
      return Promise.all([...b].map(([c, ps]) => statPaths(c, [...ps]).catch(() => null)));
    });
  }
  const set = batch.get(cwd) ?? batch.set(cwd, new Set()).get(cwd)!;
  paths.forEach((p) => set.add(p));
  return flushed.then(() => statPaths(cwd, paths));
}

function PathSpan({ target, children }: { target: PathTarget; children: string }) {
  const below = (el: Element) => el.getBoundingClientRect().bottom + 4;
  return (
    <span
      data-path-link
      className="cursor-pointer underline decoration-dotted underline-offset-2"
      onMouseEnter={(e) => showPathCard(target, e.clientX, below(e.currentTarget))}
      onMouseLeave={hidePathCard}
      onClick={(e) => clickPathLink(target, e.nativeEvent, e.clientX, below(e.currentTarget))}
    >
      {children}
    </span>
  );
}

/** Plain text — a tool call's command line — with the paths in it that exist
 *  on disk as links: hover for the card, click pins it, ⌘-click opens. The
 *  same detector and existence check as the terminal (see path-links.md). */
export default function PathText({ text, cwd }: { text: string; cwd?: string }) {
  const { pathLinksEnabled } = useSettings();
  const base = cwd && pathLinksEnabled ? (commandCwd(text) ?? cwd) : null;
  const found = useMemo(() => (base ? candidates(text) : []), [text, base]);
  const [links, setLinks] = useState<PathMatch[]>([]);

  useEffect(() => {
    setLinks([]);
    if (!base || found.length === 0) return;
    let live = true;
    statSoon(base, found.map((m) => m.path))
      .then((infos) => { if (live) setLinks(outermost(found.filter((_, i) => infos[i]))); })
      .catch(() => {});
    return () => { live = false; };
  }, [base, found]);

  if (!base || links.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const m of links) {
    if (m.index < at) continue;
    parts.push(text.slice(at, m.index));
    parts.push(
      <PathSpan key={m.index} target={{ cwd: base, path: m.path }}>{text.slice(m.index, m.index + m.length)}</PathSpan>,
    );
    at = m.index + m.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
