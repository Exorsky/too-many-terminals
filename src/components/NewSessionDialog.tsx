import { useEffect, useRef, useState } from 'react';
import ModalDialog, { DIALOG_BUTTON, DIALOG_PRIMARY, DialogClose } from './ui/dialog';
import { History, Inbox, Pencil, Plus } from 'lucide-react';
import { projectHue, type Tab } from '@/types';
import { cn, folderName } from '@/lib/utils';
import { fetchIssue, issuePrompt, jiraOn, parseIssueInput, sessionsForIssue } from '@/lib/jira';
import { compactAge, recencyOf } from '@/lib/sessions';
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
  const claude = 'flex-1 bg-[color-mix(in_srgb,var(--cyan)_14%,transparent)]';
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
  /** Every session, so a ticket that already has one is offered first. */
  sessions?: Tab[];
  /** Transcript mtimes by Claude session id — which of those is the latest. */
  lastUsed?: Map<string, number>;
  /** Go back to an existing session instead of starting another. */
  onResume?: (tabId: string) => void;
}

const NO_SESSIONS: Tab[] = [];
const NO_TIMES = new Map<string, number>();

/** New session: where, then what, then an optional name.
 *
 *  It opens on Claude in the project the sidebar is inside (the Inbox at the
 *  top level) — so Enter, or ⌘N again (handled in App), is still one keystroke
 *  from a session.
 *  See docs/features/scratch-sessions.md. */
export default function NewSessionDialog({
  open, onOpenChange, defaultDir, projects, counts, onStart, onAddProject, initialIssue = null,
  sessions = NO_SESSIONS, lastUsed = NO_TIMES, onResume,
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

  // A ticket that already has a session gets that session offered first: the
  // same ticket spread over five sessions is five half-histories.
  const seenAt = (t: Tab) => recencyOf(t, t.resumeSessionId ? lastUsed.get(t.resumeSessionId) : undefined);
  const existing = issueKey && kind !== 'shell' && onResume
    ? sessionsForIssue(sessions, issueKey).sort((a, b) => seenAt(b) - seenAt(a))
    : NO_SESSIONS;
  const now = Date.now();

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
  const resume = (tabId: string) => { onOpenChange(false); onResume?.(tabId); };
  const start = (forceNew = false) => {
    if (!forceNew && existing.length) { resume(existing[0].id); return; }
    onOpenChange(false);
    if (!issueKey) { onStart(dir, kind, name.trim()); return; }
    const title = issueTitle ? `${issueKey} · ${issueTitle}` : issueKey;
    // The ticket, or the project's template from Settings › Jira — and it
    // lands unsubmitted, the same as starting a session from a To-Do.
    const prompt = kind === 'shell' ? undefined
      : issuePrompt(settings.jiraPromptTemplates ?? {}, issueKey, issueTitle, jiraBaseUrl);
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
      start(e.metaKey || e.ctrlKey);
    }
  };

  const whereRow = (active: boolean) => cn(
    'flex items-center gap-2 w-full h-[30px] px-3 shrink-0 border-none cursor-pointer font-inherit text-left text-[13px]',
    active ? 'bg-selected text-foreground' : 'bg-transparent text-dim hover:bg-hover hover:text-foreground',
  );

  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New session"
      description="Pick where and what to start."
      className="top-[12%] w-[680px] max-h-[76vh]"
      onOpenAutoFocus={(e) => { e.preventDefault(); nameRef.current?.focus(); }}
      onKeyDown={onKeyDown}
      footer={(
        <>
          <span className="text-[11.5px] text-muted-foreground">
            <kbd className="px-1 rounded-sm border border-border bg-raised font-mono text-[11px] text-dim">⌘N</kbd> again starts Claude in {defaultDir ? folderName(defaultDir) : 'the Inbox'}
          </span>
          <DialogClose className={cn(DIALOG_BUTTON, 'ml-auto')}>
            Cancel
          </DialogClose>
          {existing.length > 0 && (
            <button
              type="button"
              className={DIALOG_BUTTON}
              onClick={() => start(true)}
            >
              New session anyway <kbd className="ml-1 font-mono text-[11px] text-faint">⌘↵</kbd>
            </button>
          )}
          <button
            type="button"
            className={DIALOG_PRIMARY}
            onClick={() => start()}
          >
            {existing.length > 0 ? 'Resume latest' : 'Start session'}
          </button>
        </>
      )}
    >
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

          {existing.length > 0 && (
            <div data-existing-sessions className="rounded-sm border border-border overflow-hidden">
              <div className="flex items-center gap-1.5 px-2.5 h-7 border-b border-border text-[12px] text-dim">
                <History size={12} className="text-muted-foreground" />
                {issueKey} already has {existing.length} session{existing.length === 1 ? '' : 's'}
              </div>
              {existing.slice(0, 3).map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => resume(t.id)}
                  className={cn(
                    'flex items-center gap-2 w-full h-[30px] px-2.5 border-none cursor-pointer font-inherit text-left text-[12.5px]',
                    i === 0 ? 'bg-selected text-foreground' : 'bg-transparent text-dim hover:bg-hover hover:text-foreground',
                  )}
                >
                  <span className="flex-1 truncate">{t.name}</span>
                  {!!t.writes && (
                    <span className="flex items-center gap-0.5 font-mono tabular-nums text-[10.5px] text-muted-foreground">
                      <Pencil size={10} />{t.writes}
                    </span>
                  )}
                  <span className="font-mono tabular-nums text-[11px] text-muted-foreground">{compactAge(seenAt(t), now)}</span>
                </button>
              ))}
            </div>
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

    </ModalDialog>
  );
}
