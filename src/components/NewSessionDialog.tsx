import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Inbox, Plus, X } from 'lucide-react';
import { projectHue } from '@/types';
import { cn, folderName } from '@/lib/utils';
import { fetchIssue, issueUrl, jiraOn, parseIssueInput } from '@/lib/jira';
import { useSettings } from '@/lib/settings-store';
import type { NewSessionKind } from './SessionsSidebar';

const KINDS: { kind: NewSessionKind; label: string; hint: string }[] = [
  { kind: 'claude', label: 'Claude', hint: 'A Claude Code session.' },
  { kind: 'shell', label: 'Shell', hint: 'Just a terminal.' },
  { kind: 'both', label: 'Claude + Shell', hint: 'Side by side, same folder.' },
];

/** The layout a kind opens as, drawn small — the choice is about what lands on
 *  screen, so the card shows it rather than describing it. */
function LayoutThumb({ kind }: { kind: NewSessionKind }) {
  const claude = 'flex-1 bg-[color-mix(in_srgb,#6fd4c9_14%,transparent)]';
  const shell = 'flex-1 bg-raised';
  return (
    <span className="flex h-12 border border-border-hover" aria-hidden="true">
      {kind !== 'shell' && <span className={cn(claude, kind === 'both' && 'border-r border-border-hover')} />}
      {kind !== 'claude' && <span className={shell} />}
    </span>
  );
}

export interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where it opens pointed: the project the sidebar is inside, else the Inbox. */
  defaultDir: string | null;
  projects: string[];
  /** Open (non-archived) sessions per project, for the counts beside each. */
  counts: Map<string, number>;
  /** `prompt` is set when the session starts from a Jira issue: the key, its
   *  title and link, handed to Claude without pressing Enter. */
  onStart: (dir: string | null, kind: NewSessionKind, name: string, prompt?: string) => void;
  onAddProject: () => void;
  /** Open with this Jira issue filled in (from an issue card). */
  initialIssue?: { key: string; summary: string } | null;
}

/** New session: where, then what, then an optional name.
 *
 *  It opens on Claude in the project the sidebar is inside (the Inbox at the
 *  top level) — so Enter, or ⌘N again (handled in App), is still one keystroke
 *  from a session.
 *  See docs/features/scratch-sessions.md. */
export default function NewSessionDialog({
  open, onOpenChange, defaultDir, projects, counts, onStart, onAddProject, initialIssue = null,
}: NewSessionDialogProps) {
  const [dir, setDir] = useState<string | null>(null);
  const [kind, setKind] = useState<NewSessionKind>('claude');
  const [name, setName] = useState('');
  const [issueInput, setIssueInput] = useState('');
  const [summary, setSummary] = useState<{ key: string; text: string } | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const settings = useSettings();
  const { jiraBaseUrl, jiraProjectKeys, jiraTokenVar } = settings;
  const issueKey = jiraOn(settings) ? parseIssueInput(issueInput, jiraProjectKeys) : null;

  // A pasted key or URL looks its title up, so the session can be named after
  // the ticket rather than "Claude".
  useEffect(() => {
    setIssueError(null);
    if (!issueKey || !jiraTokenVar || summary?.key === issueKey) return;
    // Typing PROJ-4821 passes through PROJ-4, PROJ-48…, each a valid key: wait
    // for the typing to stop so only the last one costs a request.
    let alive = true;
    const timer = setTimeout(() => {
      fetchIssue(issueKey)
        .then((i) => { if (alive) setSummary({ key: issueKey, text: i.summary }); })
        .catch((e) => { if (alive) setIssueError(String(e)); });
    }, 500);
    return () => { alive = false; clearTimeout(timer); };
  }, [issueKey, jiraTokenVar, summary?.key]);
  const issueTitle = summary?.key === issueKey ? summary.text : '';

  // Every opening starts from the defaults; a half-filled form from last time
  // would start the wrong thing on a reflexive Enter.
  useEffect(() => {
    if (!open) return;
    setDir(defaultDir);
    setKind('claude');
    setName('');
    setIssueInput(initialIssue?.key ?? '');
    // An empty summary (the card hadn't loaded yet) is no summary: leave it
    // to the lookup, or the session ends up named after the bare key.
    setSummary(initialIssue?.summary ? { key: initialIssue.key, text: initialIssue.summary } : null);
  }, [open, defaultDir, initialIssue]);

  // A folder added from here is the one you meant to start in.
  const known = useRef(projects);
  useEffect(() => {
    const added = projects.find((p) => !known.current.includes(p));
    known.current = projects;
    if (added && open) setDir(added);
  }, [projects, open]);

  const wheres: (string | null)[] = [null, ...projects];
  const start = () => {
    onOpenChange(false);
    if (!issueKey) { onStart(dir, kind, name.trim()); return; }
    const title = issueTitle ? `${issueKey} · ${issueTitle}` : issueKey;
    // The prompt is the ticket, nothing invented around it — and it lands
    // unsubmitted, the same as starting a session from a To-Do.
    const prompt = kind === 'shell' ? undefined
      : `${issueKey}${issueTitle ? `: ${issueTitle}` : ''}\n${issueUrl(jiraBaseUrl, issueKey)}`;
    onStart(dir, kind, name.trim() || title.slice(0, 80), prompt);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const inName = e.target === nameRef.current;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = wheres.indexOf(dir) + (e.key === 'ArrowDown' ? 1 : -1);
      setDir(wheres[Math.max(0, Math.min(wheres.length - 1, i))]);
    } else if (!inName && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const i = KINDS.findIndex((k) => k.kind === kind) + (e.key === 'ArrowRight' ? 1 : -1);
      setKind(KINDS[Math.max(0, Math.min(KINDS.length - 1, i))].kind);
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      start();
    }
  };

  const whereRow = (active: boolean) => cn(
    'flex items-center gap-2 w-full h-[30px] px-3 shrink-0 border-none cursor-pointer font-inherit text-left text-[13px]',
    active ? 'bg-selected text-foreground' : 'bg-transparent text-dim hover:bg-hover hover:text-foreground',
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-[12%] z-50 flex flex-col w-[680px] max-w-[calc(100vw-32px)] max-h-[76vh] -translate-x-1/2 rounded-md border border-border bg-card shadow-lg"
          onOpenAutoFocus={(e) => { e.preventDefault(); nameRef.current?.focus(); }}
          onKeyDown={onKeyDown}
        >
          <div className="flex items-center h-11 px-4 border-b border-border shrink-0">
            <Dialog.Title className="m-0 text-[13px] font-semibold text-foreground">New session</Dialog.Title>
            <Dialog.Description className="sr-only">Pick where and what to start.</Dialog.Description>
            <Dialog.Close
              aria-label="Close"
              className="ml-auto flex items-center justify-center w-6 h-6 rounded-sm border-none bg-transparent text-muted-foreground cursor-pointer hover:text-foreground hover:bg-hover"
            >
              <X size={13} />
            </Dialog.Close>
          </div>

          <div className="grid grid-cols-[220px_minmax(0,1fr)] min-h-0 flex-1">
            <div role="radiogroup" aria-label="Where" className="flex flex-col py-2 border-r border-border overflow-y-auto scrollbar-thin">
              <div className="px-3 pt-1 pb-1.5 text-[12px] font-semibold text-muted-foreground">Where</div>
              <button type="button" role="radio" aria-checked={dir === null} className={whereRow(dir === null)} onClick={() => setDir(null)}>
                <Inbox size={12} className="shrink-0 text-muted-foreground" />
                <span className="flex-1">Inbox</span>
                <span className="text-[11px] text-faint">no folder</span>
              </button>
              {projects.length > 0 && <div className="h-px mx-3 my-1.5 bg-border" />}
              {projects.map((p, i) => (
                <button key={p} type="button" role="radio" aria-checked={dir === p} title={p} className={whereRow(dir === p)} onClick={() => setDir(p)}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: `hsl(${projectHue(i)} 60% 62%)` }} />
                  <span className="flex-1 truncate">{folderName(p)}</span>
                  <span className="text-[11px] font-mono tabular-nums text-muted-foreground">{counts.get(p) || ''}</span>
                </button>
              ))}
              <button type="button" className={cn(whereRow(false), 'text-muted-foreground')} onClick={onAddProject}>
                <Plus size={12} className="shrink-0" />
                <span>Add a project folder…</span>
              </button>
            </div>

            <div className="flex flex-col gap-3 px-4 py-3 min-w-0">
              <div className="text-[12px] font-semibold text-muted-foreground">What</div>
              <div role="radiogroup" aria-label="What" className="grid grid-cols-3 gap-2">
                {KINDS.map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    role="radio"
                    aria-checked={kind === k.kind}
                    className={cn(
                      'flex flex-col gap-2 p-2.5 rounded-sm border cursor-pointer font-inherit text-left',
                      kind === k.kind
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-transparent text-dim hover:border-border-hover',
                    )}
                    onClick={() => setKind(k.kind)}
                  >
                    <LayoutThumb kind={k.kind} />
                    <span className="text-[13px] font-semibold text-foreground">{k.label}</span>
                    <span className="text-[11.5px] leading-snug text-muted-foreground">{k.hint}</span>
                  </button>
                ))}
              </div>

              {jiraOn(settings) && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-semibold text-muted-foreground">
                    Jira issue <span className="font-normal text-faint">— optional, a key or a link</span>
                  </span>
                  <input
                    value={issueInput}
                    onChange={(e) => setIssueInput(e.target.value)}
                    placeholder="ABC-123"
                    spellCheck={false}
                    autoComplete="off"
                    className="h-[30px] px-2.5 rounded-sm border border-border bg-background font-mono text-[12px] text-foreground placeholder:text-faint outline-none focus:border-border-hover"
                  />
                  {issueKey && (
                    <span className="text-[11px] leading-snug text-muted-foreground truncate">
                      {issueTitle || issueError || (jiraTokenVar ? 'Looking it up…' : issueKey)}
                    </span>
                  )}
                </label>
              )}

              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold text-muted-foreground">
                  Name <span className="font-normal text-faint">— optional{kind !== 'shell' && ', Claude names it otherwise'}</span>
                </span>
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Code review session"
                  spellCheck={false}
                  autoComplete="off"
                  className="h-[30px] px-2.5 rounded-sm border border-border bg-background text-[13px] text-foreground placeholder:text-faint outline-none focus:border-border-hover font-inherit"
                />
              </label>
              <div className="font-mono text-[11px] text-muted-foreground truncate" title={dir ?? undefined}>
                {dir ?? '~/.tmt/scratch/<new>'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 h-12 px-4 border-t border-border shrink-0">
            <span className="text-[11.5px] text-muted-foreground">
              <kbd className="px-1 rounded-sm border border-border bg-raised font-mono text-[11px] text-dim">⌘N</kbd> again starts Claude in {defaultDir ? folderName(defaultDir) : 'the Inbox'}
            </span>
            <Dialog.Close className="ml-auto px-3 h-7 rounded-sm border border-border bg-transparent text-[13px] text-dim cursor-pointer font-inherit hover:bg-hover hover:text-foreground">
              Cancel
            </Dialog.Close>
            <button
              type="button"
              className="px-3 h-7 rounded-sm border border-border-hover bg-transparent text-[13px] text-foreground cursor-pointer font-inherit hover:bg-hover"
              onClick={start}
            >
              Start session
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
