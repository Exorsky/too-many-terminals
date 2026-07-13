import { FileText, Loader2 } from 'lucide-react';
import type { TranscriptTurn } from '@/types';

/** The loading / error / empty placeholders shared by the History overlay and
 *  the in-place markdown view. Returns null once there are turns to render. */
export default function TranscriptStates({ turns, error }: {
  turns: TranscriptTurn[] | null;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="flex flex-col items-center gap-1.5 text-center px-6 py-16 text-muted-foreground">
        <FileText size={20} className="text-border-hover mb-1" />
        <div className="text-[12.5px] text-foreground">Couldn't read this session</div>
        <div className="text-[11px] max-w-[42ch] leading-relaxed">The transcript file may have been moved or deleted since it was opened.</div>
      </div>
    );
  }
  if (turns === null) {
    return (
      <div className="flex items-center gap-2 px-5 py-8 text-[12px] text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> Reading transcript…
      </div>
    );
  }
  if (turns.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 text-center px-6 py-16 text-muted-foreground">
        <FileText size={20} className="text-border-hover mb-1" />
        <div className="text-[12.5px] text-foreground">Nothing to read yet</div>
        <div className="text-[11px] max-w-[42ch] leading-relaxed">This session has no messages yet.</div>
      </div>
    );
  }
  return null;
}
