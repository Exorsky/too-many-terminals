import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import * as ipc from '@/lib/ipc';
import type { JiraIssue } from '@/lib/ipc';
import { fetchIssue, findIssueKeys, hideIssueCard, holdIssueCard, issueUrl, useIssueCard } from '@/lib/jira';
import { useSettings } from '@/lib/settings-store';
import { cn } from '@/lib/utils';
import type { Tab } from '@/types';

const CATEGORY_CLASS: Record<string, string> = {
  done: 'bg-success/15 text-success',
  indeterminate: 'bg-link/15 text-link',
};

/** "28.10.2026 13:02", in local time — the user's own zone. Always the full
 *  date: "14:16" alone doesn't say which day, and a card is read in passing. */
export function formatIssueDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The one hover card for every issue key on screen — sidebar chips, tab
 *  chips, terminal links. Mounted once by App; `showIssueCard` drives it. */
export default function IssueCard({ sessions, onNewSession }: {
  /** Open sessions, to say which others already mention this key. */
  sessions: Tab[];
  onNewSession: (key: string, summary: string) => void;
}) {
  const card = useIssueCard();
  const { jiraBaseUrl, jiraTokenVar } = useSettings();
  const [issue, setIssue] = useState<JiraIssue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = card?.key ?? null;

  useEffect(() => {
    setIssue(null);
    setError(null);
    // Without a token the card can still say where the key goes.
    if (!key || !jiraTokenVar) return;
    let alive = true;
    fetchIssue(key)
      .then((i) => { if (alive) setIssue(i); })
      .catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [key, jiraTokenVar]);

  if (!card || !key || !jiraBaseUrl) return null;
  // Whole keys only: PROJ-1 must not claim the session named for PROJ-12.
  const related = sessions.filter((s) => findIssueKeys(s.name, [key.split('-')[0]]).some((m) => m.key === key));
  const created = formatIssueDate(issue?.created ?? null);
  const updated = formatIssueDate(issue?.updated ?? null);
  // Keep the card on screen near the right and bottom edges.
  const left = Math.min(card.x, window.innerWidth - 380);
  const top = Math.min(card.y, window.innerHeight - 220);

  return (
    <div
      role="dialog"
      aria-label={`${key} details`}
      className="fixed z-50 w-[360px] rounded-md border border-border-hover bg-popover p-3 shadow-lg text-[12px]"
      style={{ left, top }}
      onMouseEnter={holdIssueCard}
      onMouseLeave={hideIssueCard}
    >
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-mono text-foreground">{key}</span>
        {issue && (
          <span className={cn('px-1.5 rounded-sm text-[10.5px] font-medium', CATEGORY_CLASS[issue.statusCategory] ?? 'bg-raised text-dim')}>
            {issue.status}
          </span>
        )}
        <span className="ml-auto">click opens</span>
      </div>
      <div className="mt-1.5 mb-2.5 text-[13px] leading-snug font-medium text-foreground">
        {issue?.summary ?? (error
          ? <span className="text-muted-foreground font-normal">{error}</span>
          : jiraTokenVar
            ? <span className="text-muted-foreground font-normal">Loading…</span>
            : <span className="text-muted-foreground font-normal">Set a token variable in Settings › Integrations to see the title and status here.</span>)}
      </div>
      {issue && (
        <dl className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <dt>Assignee</dt><dd className="text-dim">{issue.assignee ?? 'Unassigned'}</dd>
          {issue.reporter && (<><dt>Reporter</dt><dd className="text-dim">{issue.reporter}</dd></>)}
          {issue.priority && (<><dt>Priority</dt><dd className="text-dim">{issue.priority}</dd></>)}
          {created && (<><dt>Created</dt><dd className="text-dim font-mono tabular-nums">{created}</dd></>)}
          {updated && (<><dt>Updated</dt><dd className="text-dim font-mono tabular-nums">{updated}</dd></>)}
          {related.length > 0 && (
            <><dt>Sessions</dt><dd className="text-dim truncate">{related.map((s) => s.name).join(', ')}</dd></>
          )}
        </dl>
      )}
      <div className="flex gap-1.5 mt-3">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-sm border border-primary/50 bg-primary/12 text-foreground cursor-pointer hover:bg-primary/20"
          onClick={() => { ipc.openExternal(issueUrl(jiraBaseUrl, key)); hideIssueCard(); }}
        >
          <ExternalLink size={12} />Open in Jira
        </button>
        <button
          type="button"
          className="h-[26px] px-2.5 rounded-sm border border-border-hover bg-transparent text-dim cursor-pointer hover:text-foreground"
          onClick={() => { void navigator.clipboard.writeText(key); hideIssueCard(); }}
        >
          Copy key
        </button>
        <button
          type="button"
          className="h-[26px] px-2.5 rounded-sm border border-border-hover bg-transparent text-dim cursor-pointer hover:text-foreground"
          onClick={() => { onNewSession(key, issue?.summary ?? ''); hideIssueCard(); }}
        >
          New session for this
        </button>
      </div>
    </div>
  );
}
