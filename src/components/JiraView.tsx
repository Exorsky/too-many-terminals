import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, MessageSquareReply, Plus, RefreshCw, SquareTerminal, X } from 'lucide-react';
import * as ipc from '@/lib/ipc';
import type { JiraIssue, JiraIssueDetail } from '@/lib/ipc';
import { fetchIssueDetail, fetchMyIssues, findIssueKeys, issueUrl } from '@/lib/jira';
import { sessionState, STATE_LABEL } from '@/lib/sessions';
import { useSettings } from '@/lib/settings-store';
import { cn } from '@/lib/utils';
import type { Tab } from '@/types';
import { formatIssueDate } from './IssueCard';
import { StatusDot } from './SessionsSidebar';

/** Work in hand first, then what's waiting — the order you'd pick from.
 *  `usual` is the status that says nothing the group header doesn't, so its
 *  chip is left off the row. */
const GROUPS: { category: string; label: string; usual: string[] }[] = [
  { category: 'indeterminate', label: 'In progress', usual: ['in progress'] },
  { category: 'new', label: 'To do', usual: ['to do', 'open'] },
];

const STATUS_CLASS: Record<string, string> = {
  indeterminate: 'bg-link/15 text-link',
};

type PriorityLevel = 'critical' | 'high' | 'medium' | 'low';

/** Jira's priority names, folded onto four levels — schemes differ (Blocker,
 *  Major, Trivial…), the glyph shouldn't. Unknown names read as medium. */
export function priorityLevel(name: string | null): PriorityLevel | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (['highest', 'critical', 'blocker'].includes(n)) return 'critical';
  if (['high', 'major'].includes(n)) return 'high';
  if (['low', 'lowest', 'minor', 'trivial'].includes(n)) return 'low';
  return 'medium';
}

/** Priority as a glyph instead of a word: signal bars, and a red "!" for
 *  critical. Only critical and high carry color — medium and low stay quiet so
 *  they don't compete with the titles. */
function PriorityGlyph({ priority }: { priority: string | null }) {
  const level = priorityLevel(priority);
  if (!level) return <span className="w-3.5 shrink-0" />;
  if (level === 'critical') {
    return (
      <span title={priority!} aria-label={priority!} className="w-3.5 h-3.5 shrink-0 rounded-[3px] bg-destructive text-white text-[10px] font-bold leading-[14px] text-center">!</span>
    );
  }
  const lit = level === 'high' ? 3 : level === 'medium' ? 2 : 1;
  return (
    <span title={priority!} aria-label={priority!} className="inline-flex items-end gap-[1.5px] w-3.5 h-3 shrink-0">
      {[4, 8, 12].map((h, i) => (
        <i
          key={h}
          className={cn('block w-[3px] rounded-[1px]', i < lit ? (level === 'high' ? 'bg-warning' : 'bg-muted-foreground') : 'bg-border-hover')}
          style={{ height: h }}
        />
      ))}
    </span>
  );
}

/** Open Jira issues assigned to you: one quiet line each, details and the one
 *  action in an inspector on click. Asks Jira once when opened (then reuses the
 *  answer for five minutes) and on Refresh — never in the background. See
 *  docs/features/jira-links.md. */
export default function JiraView({ sessions, onOpenSession, onNewSession }: {
  /** Open sessions, to find the one already working on an issue. */
  sessions: Tab[];
  onOpenSession: (tabId: string) => void;
  onNewSession: (key: string, summary: string) => void;
}) {
  const { jiraBaseUrl, jiraTokenVar } = useSettings();
  const [issues, setIssues] = useState<JiraIssue[] | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const load = useCallback((fresh: boolean) => {
    setLoading(true);
    setError(null);
    fetchMyIssues(jiraTokenVar, fresh)
      .then((list) => { setIssues(list); setLoadedAt(new Date()); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [jiraTokenVar]);
  useEffect(() => { if (jiraTokenVar) load(false); }, [jiraTokenVar, load]);

  const sessionFor = (key: string) =>
    sessions.find((s) => !s.archived && findIssueKeys(s.name, [key.split('-')[0]]).some((m) => m.key === key));
  /** The one thing to do with an issue: go back to its session, or start one. */
  const act = (issue: JiraIssue) => {
    const session = sessionFor(issue.key);
    if (session) onOpenSession(session.id);
    else onNewSession(issue.key, issue.summary);
  };

  const groups = [
    ...GROUPS.map((g) => ({ ...g, items: (issues ?? []).filter((i) => i.statusCategory === g.category) })),
    { category: 'other', label: 'Other', usual: [], items: (issues ?? []).filter((i) => !GROUPS.some((g) => g.category === i.statusCategory)) },
  ].filter((g) => g.items.length > 0);
  const selected = issues?.find((i) => i.key === selectedKey) ?? null;
  const replies = (issues ?? []).filter((i) => i.replyFrom).length;
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      <div className="flex items-center gap-2 h-11 px-4 shrink-0 border-b border-border">
        <span className="text-[13px] font-semibold text-foreground">My issues</span>
        {issues && <span className="text-[12px] font-mono tabular-nums text-muted-foreground">{issues.length}</span>}
        {replies > 0 && (
          <span className="inline-flex items-center gap-1 text-[12px] text-dim" title="Issues where someone else wrote the latest comment">
            <MessageSquareReply size={12} />{replies} {replies === 1 ? 'reply' : 'replies'}
          </span>
        )}
        {loadedAt && <span className="ml-auto text-[11px] text-muted-foreground">updated {hhmm(loadedAt)}</span>}
        <button
          type="button"
          aria-label="Refresh"
          title="Ask Jira again"
          disabled={loading || !jiraTokenVar}
          className={cn(
            'inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-sm border border-border bg-transparent text-dim text-[12px] cursor-pointer hover:text-foreground hover:border-border-hover disabled:opacity-40 disabled:cursor-default font-inherit',
            !loadedAt && 'ml-auto',
          )}
          onClick={() => load(true)}
        >
          <RefreshCw size={12} className={cn(loading && 'animate-spin')} />Refresh
        </button>
      </div>

      {/* A failed Refresh keeps the list it had — stale beats blank. */}
      {error && issues && (
        <div role="alert" className="px-4 py-1.5 shrink-0 border-b border-border text-[12px] text-attention">
          Couldn&apos;t refresh: {error}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin pb-3">
          {!jiraTokenVar ? (
            <Empty title="No token" body="Set a token variable in Settings › Integrations › Jira to see the issues assigned to you." />
          ) : error && !issues ? (
            <Empty title="Couldn't load your issues" body={error} />
          ) : issues && issues.length === 0 ? (
            <Empty title="Nothing assigned to you" body="Open issues assigned to you in Jira show up here." />
          ) : !issues ? (
            <Empty title="Loading…" body="" />
          ) : groups.map((g) => (
            <section key={g.category}>
              <div className="flex items-baseline gap-1.5 px-4 pt-3.5 pb-1 text-[12px] font-semibold text-muted-foreground">
                {g.label} <span className="font-mono tabular-nums text-[11px] font-normal">{g.items.length}</span>
              </div>
              {g.items.map((issue) => {
                const session = sessionFor(issue.key);
                const showStatus = !g.usual.includes(issue.status.toLowerCase());
                return (
                  <button
                    key={issue.key}
                    type="button"
                    aria-current={issue.key === selectedKey || undefined}
                    title="Double-click or Enter to open its session"
                    className={cn(
                      'group flex items-center gap-3 w-[calc(100%-16px)] h-[34px] mx-2 px-2.5 rounded-sm border-none cursor-pointer font-inherit text-left',
                      issue.key === selectedKey ? 'bg-selected' : 'bg-transparent hover:bg-hover',
                    )}
                    onClick={() => setSelectedKey(issue.key)}
                    onDoubleClick={() => act(issue)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); act(issue); } }}
                  >
                    <PriorityGlyph priority={issue.priority} />
                    <span className="w-[92px] shrink-0 font-mono tabular-nums text-[12px] text-muted-foreground">{issue.key}</span>
                    {session && <StatusDot tab={session} size={8} />}
                    <span
                      className={cn(
                        'flex-1 min-w-0 truncate text-[13px]',
                        issue.key === selectedKey ? 'text-foreground' : 'text-dim group-hover:text-foreground',
                      )}
                    >
                      {issue.summary}
                    </span>
                    {issue.replyFrom && (
                      // Not a status color: those are reserved for sessions.
                      // A plain chip with an icon reads as "something new here".
                      <span
                        title={`${issue.replyFrom} wrote the latest comment${issue.replyAt ? ` · ${formatIssueDate(issue.replyAt)}` : ''}`}
                        className="inline-flex items-center gap-1 shrink-0 max-w-[140px] px-1.5 rounded-sm bg-raised text-foreground text-[11px] leading-[18px]"
                      >
                        <MessageSquareReply size={11} className="shrink-0" />
                        <span className="truncate">{issue.replyFrom}</span>
                      </span>
                    )}
                    {showStatus && (
                      <span className={cn('shrink-0 px-1.5 rounded-sm text-[11px] leading-[18px]', STATUS_CLASS[issue.statusCategory] ?? 'bg-raised text-dim')}>
                        {issue.status}
                      </span>
                    )}
                    <span className="shrink-0 font-mono tabular-nums text-[11px] text-faint" title={formatIssueDate(issue.updated) ?? undefined}>
                      {formatIssueDate(issue.updated)?.replace(/\.\d{4}/, '')}
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>

        {selected && (
          <IssueInspector
            issue={selected}
            session={sessionFor(selected.key) ?? null}
            baseUrl={jiraBaseUrl}
            onAct={() => act(selected)}
            onClose={() => setSelectedKey(null)}
          />
        )}
      </div>
    </div>
  );
}

/** The selected issue in full. Its description and latest comment are one
 *  more request, asked 300ms after selection settles — like the hover card —
 *  so arrowing or clicking through the list doesn't ask for every row. */
function IssueInspector({ issue, session, baseUrl, onAct, onClose }: {
  issue: JiraIssue;
  session: Tab | null;
  baseUrl: string;
  onAct: () => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<JiraIssueDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  useEffect(() => {
    setDetail(null);
    setDetailError(null);
    let alive = true;
    const timer = setTimeout(() => {
      fetchIssueDetail(issue.key)
        .then((d) => { if (alive) setDetail(d); })
        .catch((e) => { if (alive) setDetailError(String(e)); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [issue.key]);

  const comment = detail?.comment ?? null;

  return (
    <aside
      aria-label={`${issue.key} details`}
      className="flex flex-col gap-3 w-[380px] shrink-0 p-4 border-l border-border bg-card overflow-y-auto scrollbar-thin"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="flex items-center gap-2 text-[12px]">
        <button
          type="button"
          className="p-0 bg-transparent border-none font-mono tabular-nums text-link cursor-pointer hover:underline"
          onClick={() => ipc.openExternal(issueUrl(baseUrl, issue.key))}
        >
          {issue.key}
        </button>
        <span className={cn('px-1.5 rounded-sm text-[11px] leading-[18px]', STATUS_CLASS[issue.statusCategory] ?? 'bg-raised text-dim')}>
          {issue.status}
        </span>
        {issue.priority && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-muted-foreground">
            <PriorityGlyph priority={issue.priority} />{issue.priority}
          </span>
        )}
        <button
          type="button"
          aria-label="Close details"
          className={cn('p-1 rounded-sm bg-transparent border-none text-muted-foreground cursor-pointer hover:text-foreground', !issue.priority && 'ml-auto')}
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>

      <div className="text-[15px] font-semibold leading-snug text-foreground">{issue.summary}</div>

      <dl className="grid grid-cols-[78px_1fr] gap-x-2.5 gap-y-1 m-0 text-[12px]">
        {issue.reporter && (<><dt className="text-muted-foreground">Reporter</dt><dd className="m-0 text-dim">{issue.reporter}</dd></>)}
        {issue.created && (<><dt className="text-muted-foreground">Created</dt><dd className="m-0 text-dim font-mono tabular-nums">{formatIssueDate(issue.created)}</dd></>)}
        {issue.updated && (<><dt className="text-muted-foreground">Updated</dt><dd className="m-0 text-dim font-mono tabular-nums">{formatIssueDate(issue.updated)}</dd></>)}
      </dl>

      {detailError ? (
        <div className="text-[12px] text-muted-foreground">{detailError}</div>
      ) : !detail ? (
        <div className="text-[12px] text-muted-foreground">Loading…</div>
      ) : (
        <>
          <Section label="Description">
            <div className="max-h-48 overflow-y-auto scrollbar-thin whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-dim">
              {detail.description ?? <span className="text-muted-foreground">No description.</span>}
            </div>
          </Section>
          {comment && (
            <Section label={issue.replyFrom ? 'Latest comment — not yours' : 'Latest comment'}>
              <div className="pl-2.5 border-l-2 border-border-hover text-[12.5px] leading-relaxed text-dim">
                <div className="mb-0.5">
                  <span className="text-foreground font-medium">{comment.author ?? 'Someone'}</span>
                  {comment.created && <span className="text-muted-foreground"> · {formatIssueDate(comment.created)}</span>}
                </div>
                <div className="max-h-32 overflow-y-auto scrollbar-thin whitespace-pre-wrap break-words">{comment.body}</div>
              </div>
            </Section>
          )}
        </>
      )}

      {session && (
        <Section label="Session">
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-sm border border-border text-[12.5px]">
            <StatusDot tab={session} size={8} />
            <span className="flex-1 min-w-0 truncate text-foreground">{session.name}</span>
            <span className="text-muted-foreground">{STATE_LABEL[sessionState(session)]}</span>
          </div>
        </Section>
      )}

      <div className="flex gap-1.5 mt-auto pt-3 border-t border-border">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-sm border border-primary/50 bg-primary/12 text-foreground text-[12px] cursor-pointer hover:bg-primary/20 font-inherit"
          onClick={onAct}
        >
          {session ? <><SquareTerminal size={12} />Open session</> : <><Plus size={12} />New session</>}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-sm border border-border-hover bg-transparent text-dim text-[12px] cursor-pointer hover:text-foreground font-inherit"
          onClick={() => ipc.openExternal(issueUrl(baseUrl, issue.key))}
        >
          <ExternalLink size={12} />Open in Jira
        </button>
        <button
          type="button"
          className="h-[26px] px-2.5 rounded-sm border border-border-hover bg-transparent text-dim text-[12px] cursor-pointer hover:text-foreground font-inherit"
          onClick={() => { void navigator.clipboard.writeText(issue.key); }}
        >
          Copy key
        </button>
      </div>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 h-full px-6 text-center">
      <div className="text-[13px] text-foreground">{title}</div>
      {body && <div className="max-w-sm text-[12px] text-muted-foreground leading-relaxed">{body}</div>}
    </div>
  );
}
