import { useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import * as ipc from '@/lib/ipc';
import { useGitStatus } from '@/lib/git';
import { cn } from '@/lib/utils';

interface Line {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

/** A unified diff as numbered lines. Headers (`diff --git`, `index`, `---`,
 *  `+++`) are dropped — the pane's own header names the file — and hunk
 *  headers keep their function context. */
export function parseDiff(text: string): Line[] {
  const out: Line[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const raw of text.split('\n')) {
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hunk) {
      oldNo = +hunk[1];
      newNo = +hunk[2];
      inHunk = true;
      out.push({ kind: 'hunk', text: raw, oldNo: null, newNo: null });
    } else if (!inHunk) {
      if (/^(Binary files|similarity index|rename from|rename to|new file mode|deleted file mode)/.test(raw)) {
        out.push({ kind: 'meta', text: raw, oldNo: null, newNo: null });
      }
    } else if (raw.startsWith('+')) {
      out.push({ kind: 'add', text: raw.slice(1), oldNo: null, newNo: newNo++ });
    } else if (raw.startsWith('-')) {
      out.push({ kind: 'del', text: raw.slice(1), oldNo: oldNo++, newNo: null });
    } else if (raw.startsWith(' ')) {
      out.push({ kind: 'ctx', text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
    } else if (raw.startsWith('diff --git')) {
      inHunk = false;
    } else if (raw.startsWith('\\') || raw.startsWith('…')) {
      out.push({ kind: 'meta', text: raw, oldNo: null, newNo: null });
    }
  }
  return out;
}

/** One file's diff, read-only, in a pane beside the session. A working-tree
 *  diff follows the folder's git status, so it updates when a Claude run
 *  ends; a commit's diff never changes. */
export default function DiffView({ dir, path, commit, onOpenFile }: {
  dir: string;
  path: string;
  commit: string | null;
  onOpenFile: (dir: string, path: string) => void;
}) {
  const status = useGitStatus(commit ? null : dir);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(() => ipc.gitFileDiff(dir, path, commit))
      .then((t) => { if (alive) { setText(t ?? ''); setFailed(t === null); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [dir, path, commit, status]);

  const lines = useMemo(() => parseDiff(text ?? ''), [text]);
  const added = lines.filter((l) => l.kind === 'add').length;
  const deleted = lines.filter((l) => l.kind === 'del').length;
  const root = status?.root ?? dir;
  const abs = `${root.replace(/[\\/]+$/, '')}/${path}`;

  return (
    <div className="flex flex-col w-full h-full min-h-0 bg-background">
      <div className="flex items-center gap-2.5 h-8 px-3 shrink-0 border-b border-border text-[12px]">
        <span className="font-mono text-foreground truncate" title={path}>{path}</span>
        <span className="font-mono text-[11px] whitespace-nowrap">
          {added > 0 && <span className="text-cyan">+{added}</span>} {deleted > 0 && <span className="text-[color-mix(in_srgb,var(--destructive)_60%,var(--muted-foreground))]">−{deleted}</span>}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground shrink-0">{commit ? commit.slice(0, 7) : 'uncommitted'}</span>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1.5 h-6 px-2 rounded-sm border border-border bg-transparent text-dim text-[12px] cursor-pointer hover:text-foreground hover:border-border-hover font-inherit shrink-0"
          onClick={() => onOpenFile(dir, abs)}
        >
          <FileText size={12} />Open file
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin font-mono text-[12px] leading-[1.6]">
        {failed ? (
          <div className="p-4 text-muted-foreground">No diff for this file.</div>
        ) : text === null ? (
          <div className="p-4 text-muted-foreground">Loading…</div>
        ) : lines.length === 0 ? (
          <div className="p-4 text-muted-foreground">No changes.</div>
        ) : (
          <div className="min-w-max">
            {lines.map((l, i) => (
              l.kind === 'hunk' || l.kind === 'meta' ? (
                <div key={i} className="px-3 py-0.5 border-y border-border bg-raised text-[11px] text-muted-foreground whitespace-pre">{l.text}</div>
              ) : (
                <div
                  key={i}
                  data-diff-line={l.kind}
                  className={cn(
                    'grid grid-cols-[44px_44px_1fr] whitespace-pre',
                    l.kind === 'add' && 'bg-[color-mix(in_srgb,var(--cyan)_10%,transparent)]',
                    l.kind === 'del' && 'bg-[color-mix(in_srgb,var(--destructive)_11%,transparent)]',
                  )}
                >
                  <span className="pr-2.5 text-right text-faint select-none">{l.oldNo ?? ''}</span>
                  <span className="pr-2.5 text-right text-faint select-none">{l.newNo ?? ''}</span>
                  <span className={cn('pr-4', l.kind === 'ctx' ? 'text-dim' : 'text-foreground')}>
                    <span className="select-none text-muted-foreground">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>{l.text}
                  </span>
                </div>
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
