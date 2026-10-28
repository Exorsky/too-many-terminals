import * as ipc from '@/lib/ipc';
import { firstIssueKey, hideIssueCard, issueUrl, showIssueCard, stripIssueKey } from '@/lib/jira';
import { useSettings } from '@/lib/settings-store';
import { cn } from '@/lib/utils';

/** The issue key in a session name and the name without it — or no key at
 *  all while Jira links are off (no base URL set). */
export function useIssueName(name: string): { key: string | null; label: string } {
  const { jiraBaseUrl, jiraProjectKeys } = useSettings();
  const key = jiraBaseUrl ? firstIssueKey(name, jiraProjectKeys) : null;
  return { key, label: key ? stripIssueKey(name, key) : name };
}

/** A Jira key as a small monospace chip: click opens the issue, hover shows
 *  its card. Renders nothing when `text` holds no key or links are off.
 *
 *  Blue is a *link* color here, never a status — the reserved
 *  success/warning/attention/destructive set stays reserved. */
export default function IssueChip({ text, size = 'sm', className }: {
  /** A key, or any text that may contain one (a session name). */
  text: string;
  size?: 'xs' | 'sm';
  className?: string;
}) {
  const { key } = useIssueName(text);
  const { jiraBaseUrl } = useSettings();
  if (!key) return null;
  return (
    <button
      type="button"
      data-issue-chip
      aria-label={`Open ${key} in Jira`}
      className={cn(
        'inline-flex items-center shrink-0 rounded-sm border font-mono tabular-nums cursor-pointer',
        'border-link/25 bg-link/10 text-link hover:bg-link/20',
        size === 'xs' ? 'h-4 px-1 text-[10.5px]' : 'h-[18px] px-1.5 text-[11px]',
        className,
      )}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); ipc.openExternal(issueUrl(jiraBaseUrl, key)); }}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        showIssueCard(key, r.left, r.bottom + 6);
      }}
      onMouseLeave={hideIssueCard}
    >
      {key}
    </button>
  );
}
