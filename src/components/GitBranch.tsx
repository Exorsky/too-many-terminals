import { GitBranch as BranchIcon } from 'lucide-react';
import type { GitStatus } from '@/lib/ipc';
import { cn } from '@/lib/utils';

/** Text color for a git file mark. Deliberately not the session status colors
 *  (success/warning/attention/destructive are reserved): blue for modified —
 *  the link color — cyan for new, magenta for a conflict. */
export function gitCodeClass(code: string): string {
  if (code === 'M') return 'text-link';
  if (code === 'C') return 'text-magenta';
  return 'text-cyan';
}

/** `⑂ feat/x ● ↑2 ↓1` — the branch (or the short commit when detached), a dot
 *  when the working tree has changes, and ahead/behind only when non-zero. */
export default function GitBranch({ status, className }: { status: GitStatus; className?: string }) {
  const dirty = status.files.length > 0;
  const name = status.branch ?? (status.head ? `detached ${status.head}` : 'no commits');
  return (
    <span
      data-git-branch
      className={cn('inline-flex items-center gap-1 min-w-0 font-mono text-[11px]', className)}
      title={[
        status.branch ? `On ${status.branch}` : `HEAD detached at ${status.head ?? '—'}`,
        dirty ? `${status.files.length} changed file${status.files.length === 1 ? '' : 's'}` : 'clean',
        status.upstream && (status.ahead || status.behind)
          ? `${status.ahead} ahead, ${status.behind} behind ${status.upstream}` : status.upstream ? `up to date with ${status.upstream}` : null,
      ].filter(Boolean).join(' · ')}
    >
      <BranchIcon size={11} className="shrink-0" />
      <span className="truncate">{name}</span>
      {dirty && <span aria-label="uncommitted changes" className="shrink-0 text-foreground">●</span>}
      {status.ahead > 0 && <span className="shrink-0 text-muted-foreground">↑{status.ahead}</span>}
      {status.behind > 0 && <span className="shrink-0 text-muted-foreground">↓{status.behind}</span>}
    </span>
  );
}
