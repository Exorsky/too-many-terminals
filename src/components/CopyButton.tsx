import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Copies `text` to the clipboard and flips to a check for a beat. Used for
 *  per-turn copy and the bar/toolbar "Copy all". */
export default function CopyButton({ text, label, className }: {
  text: string;
  label: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      /* clipboard unavailable (e.g. tests) — nothing to recover */
    }
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1400);
  }, [text]);

  return (
    <button
      onClick={(e) => { e.stopPropagation(); copy(); }}
      className={cn(
        'inline-flex items-center gap-1.5 text-[11px] rounded-md border px-2 py-1 cursor-pointer font-inherit transition-colors',
        done
          ? 'border-success/40 text-success'
          : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-border-hover',
        className,
      )}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? 'Copied' : label}
    </button>
  );
}
