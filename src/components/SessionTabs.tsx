import { Plus, X } from 'lucide-react';
import { sessionState, STATE_DOT } from '@/lib/sessions';
import { cn, ICON_BUTTON } from '@/lib/utils';
import type { Tab } from '@/types';
import IssueChip, { useIssueName } from './IssueChip';

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

export interface SessionTabsProps {
  /** Session ids, in strip order. */
  open: string[];
  tabs: Tab[];
  current: string | null;
  /** How many panes each open session's tab holds, to badge the split ones. */
  paneCounts: Record<string, number>;
  onSelect: (id: string) => void;
  /** Take the tab off the strip. The session keeps running in the sidebar. */
  onHide: (id: string) => void;
  onNew: () => void;
  /** The current session's controls: split, transcript, details. */
  trailing?: React.ReactNode;
  /** A tab that isn't a session (the logbook), pinned at the leading edge. */
  extra?: { label: string; icon: React.ReactNode; active: boolean; onSelect: () => void; onClose: () => void } | null;
}

/** The strip of open sessions across the top of the workspace.
 *
 *  A tab is a session and its splits live inside it — the model iTerm2,
 *  Ghostty and Warp teach. The `+` sits at the leading edge because that is
 *  where a new tab lands by default (Settings › Sessions can switch it to
 *  "after the current tab"). See docs/features/session-workspace.md. */
export default function SessionTabs({
  open, tabs, current, paneCounts, onSelect, onHide, onNew, trailing, extra = null,
}: SessionTabsProps) {
  return (
    <div data-session-tabs className="flex items-stretch h-9 shrink-0 border-b border-border bg-card">
      <button
        type="button"
        aria-label="New session"
        title="New session  ⌘N"
        className={cn(ICON_BUTTON, 'w-9 h-auto rounded-none border-r border-border')}
        onClick={onNew}
      >
        <Plus size={15} />
      </button>
      <div className="flex items-stretch min-w-0 overflow-x-auto scrollbar-thin">
        {extra && (
          <div
            role="tab"
            aria-selected={extra.active}
            data-extra-tab
            className={cn(
              'group relative flex items-center gap-2 shrink-0 pl-3 pr-1.5 cursor-pointer',
              'border-r border-border text-[12px] transition-colors duration-100',
              extra.active ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-hover',
            )}
            onMouseDown={(e) => { if (e.button === 0) extra.onSelect(); }}
            onAuxClick={(e) => { if (e.button === 1) extra.onClose(); }}
          >
            {extra.active && <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
            {extra.icon}
            <span>{extra.label}</span>
            <button
              type="button"
              aria-label={`Close tab ${extra.label}`}
              className={cn(ICON_BUTTON, 'w-5 h-5 shrink-0', extra.active ? '' : 'opacity-0 group-hover:opacity-100')}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); extra.onClose(); }}
            >
              <X size={12} />
            </button>
          </div>
        )}
        {open.map((id, i) => {
          const tab = tabs.find((t) => t.id === id);
          if (!tab) return null;
          const active = id === current && !extra?.active;
          const panes = paneCounts[id] ?? 1;
          return (
            <div
              key={id}
              role="tab"
              aria-selected={active}
              data-session-tab
              title={`${tab.name}${IS_MAC && i < 9 ? `  ⌘${i + 1}` : ''}`}
              className={cn(
                'group relative flex items-center gap-2 shrink-0 pl-3 pr-1.5 max-w-[240px] cursor-pointer',
                'border-r border-border text-[12px] transition-colors duration-100',
                active ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-hover',
              )}
              onMouseDown={(e) => { if (e.button === 0) onSelect(id); }}
              onAuxClick={(e) => { if (e.button === 1) onHide(id); }}
            >
              {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
              <span className={cn('w-2 h-2 shrink-0 rounded-full box-border', STATE_DOT[sessionState(tab)])} />
              <TabName name={tab.name} />
              {panes > 1 && (
                <span
                  className="shrink-0 px-1 rounded-sm border border-border-hover font-mono text-[10.5px] leading-[15px] text-muted-foreground"
                  title={`${panes} panes`}
                >
                  {panes}
                </span>
              )}
              <button
                type="button"
                aria-label={`Close tab ${tab.name}`}
                title="Close tab — the session keeps running"
                className={cn(
                  ICON_BUTTON, 'w-5 h-5 shrink-0',
                  active ? '' : 'opacity-0 group-hover:opacity-100',
                )}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onHide(id); }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      {trailing && <div className="flex items-center gap-0.5 ml-auto shrink-0 pl-2 pr-2">{trailing}</div>}
    </div>
  );
}

/** The name with its Jira key lifted into a chip, as in the sidebar. */
function TabName({ name }: { name: string }) {
  const { key, label } = useIssueName(name);
  return (
    <>
      <span data-session-tab-name className="truncate min-w-0">{label}</span>
      {key && <IssueChip text={key} size="xs" />}
    </>
  );
}
