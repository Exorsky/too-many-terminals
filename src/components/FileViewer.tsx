import { useEffect, useState } from 'react';
import * as ipc from '@/lib/ipc';
import Markdown from './Markdown';

interface FileViewerProps {
  path: string;
}

/** Read-only view of a file opened from the file explorer. Markdown renders
 *  through the same component the session reader uses; everything else is
 *  plain monospace text. */
export default function FileViewer({ path }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    ipc.readFile(path)
      .then((text) => { if (!cancelled) setContent(text); })
      .catch((e) => { if (!cancelled) setError(typeof e === 'string' ? e : 'Could not read this file'); });
    return () => { cancelled = true; };
  }, [path]);

  if (error) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
        {error}
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-[12px] text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (/\.mdx?$/i.test(path)) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-6 py-5">
        <Markdown source={content} />
      </div>
    );
  }

  return (
    <pre className="flex-1 min-h-0 overflow-auto px-4 py-3 text-[12px] leading-[1.6] font-mono text-foreground whitespace-pre">
      {content}
    </pre>
  );
}
