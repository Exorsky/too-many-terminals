import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ChevronDown, ChevronRight, Clock, Columns2, Folder, FolderInput, FolderOpen, FolderPlus, Inbox,
  MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Settings, Code, Upload, X,
} from 'lucide-react';
import { TAB_MIME } from '@/lib/dnd';
import * as ipc from '@/lib/ipc';
import { useSettings } from '@/lib/settings-store';
import {
  bySessionOrder, compactAge, matchesQuery, recencyOf, sessionState, STATE_DOT, STATE_LABEL,
} from '@/lib/sessions';
import { ACTION_ROW, cn, folderName } from '@/lib/utils';
import type { SessionHistoryEntry, SessionTool, Tab } from '@/types';

/** What each tool is called, everywhere it's offered. */
const TOOL_LABEL: Record<SessionTool, string> = {
  claude: 'Claude',
  shell: 'Shell',
  files: 'Files',
};
import SidebarFooter from './SidebarFooter';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';

/** How many past sessions the Recent group offers before it stops being a
 *  shortcut and starts being a second history browser. */
const RECENT_LIMIT = 6;

/** What a new session opens as. The layout is decided here, at the moment you
 *  start something — which is the moment you already know whether this is a
 *  "ask Claude something" or a "poke at the box" job. Rearranging afterwards
 *  is still possible; this just means you usually don't have to. */
export type NewSessionKind = 'claude' | 'shell' | 'both';

const NEW_SESSION_LABEL: Record<NewSessionKind, string> = {
  claude: 'Claude',
  shell: 'Shell',
  both: 'Claude + Shell',
};

const NEW_SESSION_KINDS: NewSessionKind[] = ['claude', 'shell', 'both'];

/** A past Claude session that isn't open right now — what Recent is made of. */
export interface RecentEntry {
  dir: string;
  entry: SessionHistoryEntry;
  name: string;
  at: number;
}

export interface SessionsSidebarProps {
  tabs: Tab[];
  selectedId: string | null;
  projects: string[];
  recent: RecentEntry[];
  /** Transcript mtimes by Claude session id, for the age column. */
  lastUsed: Map<string, number>;
  showSettings: boolean;
  /** The past-session browser is the overlay currently up — the footer row's
   *  pressed state, not a switch for the Archived group below. */
  showArchive: boolean;
  /** What a new session starts as. `both` is a Claude session with its shell
   *  already open in a pane beside it. */
  onNewSession: (dir: string | null, kind: NewSessionKind) => void;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, name: string) => void;
  onSetProject: (tabId: string, projectDir: string | null) => void;
  onArchive: (tabId: string, archived: boolean) => void;
  onTogglePin: (tabId: string) => void;
  onOpenDirectory: (dir: string) => void;
  onOpenInVscode: (tabId: string) => void;
  onCreateTask: (tabId: string) => void;
  /** Put one of this session's tools on the workspace without asking where. */
  onOpenInWorkspace: (tabId: string, tool: SessionTool) => void;
  onOpenPalette: () => void;
  onAddProject: () => void;
  onRemoveProject: (dir: string) => void;
  onImportSession: (dir: string) => void;
  onResumeRecent: (entry: RecentEntry) => void;
  onToggleArchive: () => void;
  onToggleSettings: () => void;
}

/** The one status mark in the list. Four states, three of which are quiet on
 *  purpose — see `sessionState`. The slot is always rendered so names stay on
 *  one left edge whether or not anything is happening. */
export function StatusDot({ tab, size = 7 }: { tab: Tab; size?: number }) {
  const state = sessionState(tab);
  return (
    <span
      data-state={state}
      title={STATE_LABEL[state]}
      aria-label={STATE_LABEL[state]}
      className={cn('shrink-0 rounded-full box-border', STATE_DOT[state])}
      style={{ width: size, height: size }}
    />
  );
}

/** A group heading with its count: INBOX 4, PROJECTS, RECENT. Not a button
 *  unless it collapses something — a heading that looks clickable and isn't is
 *  worse than a plain one. */
function GroupLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-2 h-6 px-3 mt-3 shrink-0 select-none">
      <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        {children}
      </span>
      {count !== undefined && count > 0 && (
        <span className="ml-auto text-[9.5px] font-mono tabular-nums text-muted-foreground">{count}</span>
      )}
    </div>
  );
}

/** One session. Name, a status dot, an age — and nothing else visible.
 *
 *  Everything you can do to a session lives in the ⋯ menu (and the same menu on
 *  right-click), which appears on hover. That's the progressive-disclosure rule
 *  in its smallest form: the row is for reading the list, not for operating on
 *  it, and a close button on every row made a 20-session list look like a
 *  control panel. */
function SessionRow({
  tab, selected, depth, projects, compact, now, lastUsedAt,
  onSelect, onClose, onRename, onSetProject, onArchive, onTogglePin, onOpenDirectory,
  onOpenInVscode, onCreateTask, onOpenInWorkspace,
}: {
  tab: Tab;
  selected: boolean;
  /** Project sessions sit one step in from the project's own row. */
  depth: 0 | 1;
  projects: string[];
  compact: boolean;
  now: number;
  lastUsedAt?: number;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, name: string) => void;
  onSetProject: (tabId: string, projectDir: string | null) => void;
  onArchive: (tabId: string, archived: boolean) => void;
  onTogglePin: (tabId: string) => void;
  onOpenDirectory: (dir: string) => void;
  onOpenInVscode: (tabId: string) => void;
  onCreateTask: (tabId: string) => void;
  onOpenInWorkspace: (tabId: string, tool: SessionTool) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== tab.name) onRename(tab.id, trimmed);
    setEditing(false);
  };
  const startRename = () => { setDraft(tab.name); setEditing(true); };

  const age = compactAge(recencyOf(tab, lastUsedAt), now);
  const detail = tab.status === 'working' ? tab.statusDetail : undefined;

  const rowClass = cn(
    'group relative flex flex-col justify-center w-full shrink-0 h-[26px] pr-1.5 rounded-sm',
    'text-[11.5px] transition-colors duration-100 cursor-pointer',
    depth === 1 ? 'pl-7' : 'pl-3',
    // A session's name is the thing you scan for, so it sits a tier above its
    // own timestamp and status text rather than level with them.
    selected ? 'bg-selected text-foreground' : 'text-dim hover:text-foreground hover:bg-hover',
    tab.exited && 'opacity-55',
    detail && !compact && 'h-[34px]',
  );

  if (editing) {
    return (
      <div className={cn(rowClass, 'cursor-text')}>
        <div className="flex items-center gap-2 w-full">
          <StatusDot tab={tab} />
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              else if (e.key === 'Escape') { e.preventDefault(); setDraft(tab.name); setEditing(false); }
            }}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-[11.5px] text-foreground font-inherit"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      data-session-row
      data-selected={selected || undefined}
      className={rowClass}
      title={tab.cwd}
      onClick={() => onSelect(tab.id)}
      onDoubleClick={startRename}
      // Drag a session onto a pane's edge to split, or its middle to show it
      // there. `setData` has to run in the bubble phase, which is what a React
      // handler gives us — see PaneDropZones.test.tsx.
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(TAB_MIME, tab.id);
      }}
    >
      {selected && <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />}
      <div className="flex items-center gap-2 w-full">
        <StatusDot tab={tab} />
        <span data-session-name className="truncate flex-1">{tab.name}</span>
        {tab.pinned && <Pin size={9} className="shrink-0 text-muted-foreground" />}
        {/* The age gives way to the ⋯ on hover rather than sitting beside it:
            two things in one 40px gutter is how a calm list turns into a
            toolbar. */}
        <span className="shrink-0 text-[9.5px] font-mono tabular-nums text-muted-foreground group-hover:hidden">
          {tab.exited ? 'exited' : age}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${tab.name}`}
              className={cn(
                'hidden group-hover:flex data-[state=open]:flex items-center justify-center shrink-0',
                'w-4 h-4 rounded-sm border-none cursor-pointer bg-transparent',
                'text-muted-foreground hover:text-foreground hover:bg-selected-hover',
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={startRename}><Pencil size={13} /><span>Rename</span></DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><FolderInput size={13} /><span>Move to project…</span></DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {projects.map((dir) => (
                  <DropdownMenuItem key={dir} onSelect={() => onSetProject(tab.id, dir)} disabled={tab.projectDir === dir}>
                    <Folder size={13} /><span>{folderName(dir)}</span>
                  </DropdownMenuItem>
                ))}
                {projects.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={() => onSetProject(tab.id, null)} disabled={tab.projectDir === null}>
                  <Inbox size={13} /><span>Inbox</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => onCreateTask(tab.id)}>
              <Plus size={13} /><span>Create To-Do…</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Which tool, not which edge: where it lands is the layout's
                problem, and dragging the row onto a pane edge is there for
                when it's yours. A shell session has only its shell. */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Columns2 size={13} /><span>Add to workspace…</span></DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {(tab.kind === 'claude'
                  ? (['claude', 'shell', 'files'] as const)
                  : (['shell', 'files'] as const)
                ).map((t) => (
                  <DropdownMenuItem key={t} onSelect={() => onOpenInWorkspace(tab.id, t)}>
                    {TOOL_LABEL[t]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onOpenDirectory(tab.cwd)}>
              <FolderOpen size={13} /><span>Open directory</span>
            </DropdownMenuItem>
            {tab.kind === 'claude' && tab.resumeSessionId && (
              <>
                <DropdownMenuItem onSelect={() => onOpenInVscode(tab.id)}>
                  <Code size={13} /><span>Open in VS Code</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { ipc.exportSession(tab.cwd, tab.resumeSessionId!).catch(() => {}); }}>
                  <Upload size={13} /><span>Export session…</span>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onSelect={() => onTogglePin(tab.id)}>
              {tab.pinned ? <PinOff size={13} /> : <Pin size={13} />}
              <span>{tab.pinned ? 'Unpin' : 'Pin'}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onArchive(tab.id, !tab.archived)}>
              <Archive size={13} /><span>{tab.archived ? 'Unarchive' : 'Archive'}</span>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => onClose(tab.id)}>
              <X size={13} /><span>Close session</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {detail && !compact && (
        <div className="flex items-center gap-1 w-full pl-4 text-[9.5px] leading-tight text-muted-foreground truncate">
          {detail}
        </div>
      )}
    </div>
  );
}

/** A project: a collapsible heading with its sessions underneath. Not a
 *  navigation destination — clicking it folds the group, it doesn't take you
 *  anywhere, because a project isn't a place. */
function ProjectGroup({
  dir, sessions, open, onToggle, children,
  onNewSession, onOpenDirectory, onImportSession, onRemoveProject,
}: {
  dir: string;
  sessions: Tab[];
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  onNewSession: (dir: string | null, kind: NewSessionKind) => void;
  onOpenDirectory: (dir: string) => void;
  onImportSession: (dir: string) => void;
  onRemoveProject: (dir: string) => void;
}) {
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            data-project-row
            aria-expanded={open}
            title={dir}
            className={cn(
              'group flex items-center gap-1.5 w-full h-[26px] px-2 shrink-0 rounded-sm',
              'border-none cursor-pointer bg-transparent font-inherit text-left',
              'text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-hover',
            )}
            onClick={onToggle}
          >
            <ChevronRight
              size={11}
              className={cn('shrink-0 transition-transform duration-100', open && 'rotate-90')}
            />
            <span className="truncate flex-1">{folderName(dir)}</span>
            <span className="shrink-0 text-[9.5px] font-mono tabular-nums text-muted-foreground">
              {sessions.length || ''}
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-44">
          {NEW_SESSION_KINDS.map((kind) => (
            <ContextMenuItem key={kind} onSelect={() => onNewSession(dir, kind)}>
              <Plus size={13} /><span>New {NEW_SESSION_LABEL[kind]}</span>
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onOpenDirectory(dir)}>
            <FolderOpen size={13} /><span>Open directory</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onImportSession(dir)}>
            <FolderInput size={13} /><span>Import session…</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => onRemoveProject(dir)}>
            <X size={13} /><span>Remove project</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {open && children}
    </>
  );
}

/** The sidebar, and the only persistent list of sessions in the app.
 *
 *  Four groups down one column: Inbox, Projects, Recent, and the footer's
 *  Archived/Settings. There is deliberately no project rail beside it and no
 *  tab strip above the terminal — the same sessions rendered in three places
 *  was the whole problem this replaces. See docs/features/terminals.md. */
export default function SessionsSidebar({
  tabs, selectedId, projects, recent, lastUsed, showSettings, showArchive,
  onNewSession, onSelect, onClose, onRename, onSetProject,
  onArchive, onTogglePin, onOpenDirectory, onOpenInVscode, onCreateTask, onOpenInWorkspace, onOpenPalette,
  onAddProject, onRemoveProject, onImportSession, onResumeRecent, onToggleArchive, onToggleSettings,
}: SessionsSidebarProps) {
  const settings = useSettings();
  const [query, setQuery] = useState('');
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Powers every age label. 30s is plenty — these are "how long", not a clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const order = useMemo(() => bySessionOrder(lastUsed), [lastUsed]);
  const sessions = useMemo(
    () => tabs.filter((t) => t.kind !== 'file' && matchesQuery(t, query)).sort(order),
    [tabs, query, order],
  );

  const live = sessions.filter((t) => !t.archived);
  const inbox = live.filter((t) => t.projectDir === null);
  const archived = sessions.filter((t) => t.archived);
  const filtering = query.trim() !== '';

  const rowProps = {
    projects, compact: settings.compactList, now,
    onSelect, onClose, onRename, onSetProject, onArchive, onTogglePin,
    onOpenDirectory, onOpenInVscode, onCreateTask, onOpenInWorkspace,
  };
  const ageOf = (tab: Tab) => (tab.resumeSessionId ? lastUsed.get(tab.resumeSessionId) : undefined);

  return (
    <div className="flex flex-col w-full h-full min-h-0 bg-card border-r border-border">
      {/* Search and New sit above every group because they're the two things
          you do without first knowing what's in the list. */}
      <div className="flex flex-col gap-1.5 px-2 pt-2 pb-1 shrink-0">
        <div className="flex items-center gap-1.5 h-[26px] px-2 rounded-sm border border-border focus-within:border-border-hover">
          <Search size={11} className="shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            placeholder="Search sessions…"
            aria-label="Search sessions"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') { e.preventDefault(); setQuery(''); searchRef.current?.blur(); }
            }}
            className="flex-1 min-w-0 bg-transparent border-none outline-none font-inherit text-[11.5px] text-foreground placeholder:text-muted-foreground"
          />
          {filtering ? (
            <button
              type="button"
              aria-label="Clear search"
              className="flex items-center justify-center w-4 h-4 rounded-sm shrink-0 border-none cursor-pointer bg-transparent text-muted-foreground hover:text-foreground"
              onClick={() => { setQuery(''); searchRef.current?.focus(); }}
            >
              <X size={10} />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Open command palette"
              title="Jump to a session"
              className="shrink-0 text-[9px] font-mono tabular-nums text-faint border-none bg-transparent cursor-pointer hover:text-foreground"
              onClick={onOpenPalette}
            >
              ⌘K
            </button>
          )}
        </div>

        {/* What to start is a choice, so the button asks. ⌘N skips the menu
            and starts Claude in a scratch directory, which keeps the common
            case one keystroke with no modal and no folder picker. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex items-center gap-1.5 w-full h-[26px] px-2 rounded-sm cursor-pointer font-inherit',
                'border border-border bg-transparent text-[11.5px] text-foreground',
                'hover:border-border-hover hover:bg-hover',
              )}
            >
              <Plus size={12} className="shrink-0 text-primary" />
              <span className="flex-1 text-left">New session</span>
              <span className="shrink-0 text-[9px] text-faint">⌘N</span>
              <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-52">
            {NEW_SESSION_KINDS.map((kind) => (
              <DropdownMenuItem key={kind} onSelect={() => onNewSession(null, kind)}>
                <Inbox size={13} /><span>{NEW_SESSION_LABEL[kind]}</span>
              </DropdownMenuItem>
            ))}
            {projects.length > 0 && <DropdownMenuSeparator />}
            {projects.map((dir) => (
              <DropdownMenuSub key={dir}>
                <DropdownMenuSubTrigger><Folder size={13} /><span>{folderName(dir)}</span></DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {NEW_SESSION_KINDS.map((kind) => (
                    <DropdownMenuItem key={kind} onSelect={() => onNewSession(dir, kind)}>
                      {NEW_SESSION_LABEL[kind]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onAddProject}>
              <FolderPlus size={13} /><span>Add project…</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-1 pb-2 scrollbar-thin">
        <GroupLabel count={inbox.length}>Inbox</GroupLabel>
        {inbox.length === 0 ? (
          <p className="px-3 py-1 text-[10.5px] leading-snug text-faint">
            {filtering ? 'Nothing here matches.' : 'Nothing loose. ⌘N starts a session without choosing anything.'}
          </p>
        ) : (
          inbox.map((tab) => (
            <SessionRow key={tab.id} tab={tab} selected={tab.id === selectedId} depth={0} lastUsedAt={ageOf(tab)} {...rowProps} />
          ))
        )}

        <GroupLabel>Projects</GroupLabel>
        {projects.length === 0 ? (
          <button
            type="button"
            className={cn(ACTION_ROW, 'gap-1.5 h-[26px] px-3 text-[11.5px]')}
            onClick={onAddProject}
          >
            <FolderPlus size={12} className="shrink-0" />
            <span>Add a project…</span>
          </button>
        ) : (
          projects.map((dir) => {
            const owned = live.filter((t) => t.projectDir === dir);
            // A search opens every group that has a hit, so a match can't hide
            // inside a folded one.
            const open = filtering ? owned.length > 0 : !folded.has(dir);
            return (
              <ProjectGroup
                key={dir}
                dir={dir}
                sessions={owned}
                open={open}
                onToggle={() => setFolded((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(dir)) next.add(dir);
                  return next;
                })}
                onNewSession={onNewSession}
                onOpenDirectory={onOpenDirectory}
                onImportSession={onImportSession}
                onRemoveProject={onRemoveProject}
              >
                {owned.length === 0 ? (
                  <p className="pl-7 pr-3 py-0.5 text-[10.5px] text-faint">No sessions</p>
                ) : (
                  owned.map((tab) => (
                    <SessionRow key={tab.id} tab={tab} selected={tab.id === selectedId} depth={1} lastUsedAt={ageOf(tab)} {...rowProps} />
                  ))
                )}
              </ProjectGroup>
            );
          })
        )}

        {recent.length > 0 && !filtering && (
          <>
            <GroupLabel>Recent</GroupLabel>
            {recent.slice(0, RECENT_LIMIT).map((r) => (
              <button
                key={`${r.dir}:${r.entry.sessionId}`}
                type="button"
                data-recent-row
                title={`${r.entry.preview || r.name}\n${r.dir}`}
                className="group flex items-center gap-2 w-full h-[26px] pl-3 pr-1.5 shrink-0 rounded-sm border-none cursor-pointer bg-transparent font-inherit text-left text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-hover"
                onClick={() => onResumeRecent(r)}
              >
                <Clock size={9} className="shrink-0 text-faint" />
                <span className="truncate flex-1">{r.name}</span>
                <span className="shrink-0 text-[9.5px] font-mono tabular-nums text-faint">
                  {compactAge(r.at, now)}
                </span>
              </button>
            ))}
          </>
        )}

        {/* Archived sessions are still in the workspace, so they get a group
            of their own rather than living behind the footer row — that row
            opens the browser for *past* sessions, which is a different thing.
            Folded by default: out of the list is what archiving meant. */}
        {archived.length > 0 && (
          <>
            <button
              type="button"
              aria-expanded={archiveOpen}
              className="group flex items-center gap-1.5 w-full h-6 px-2 mt-3 shrink-0 rounded-sm border-none cursor-pointer bg-transparent font-inherit text-left hover:bg-hover"
              onClick={() => setArchiveOpen((v) => !v)}
            >
              <ChevronRight size={10} className={cn('shrink-0 text-muted-foreground transition-transform duration-100', archiveOpen && 'rotate-90')} />
              <span className="flex-1 text-[9.5px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                Archived
              </span>
              <span className="text-[9.5px] font-mono tabular-nums text-muted-foreground">{archived.length}</span>
            </button>
            {archiveOpen && archived.map((tab) => (
              <SessionRow key={tab.id} tab={tab} selected={tab.id === selectedId} depth={1} lastUsedAt={ageOf(tab)} {...rowProps} />
            ))}
          </>
        )}
      </div>

      <div className="flex flex-col shrink-0 border-t border-border px-1 py-1">
        <FooterRow icon={Archive} label="Past sessions" active={showArchive} onClick={onToggleArchive} />
        <FooterRow icon={Settings} label="Settings" active={showSettings} onClick={onToggleSettings} />
      </div>
      <SidebarFooter />
    </div>
  );
}

function FooterRow({ icon: Icon, label, count, active, onClick }: {
  icon: typeof Archive;
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-active={active || undefined}
      className={cn(
        'flex items-center gap-2 w-full h-[26px] px-3 shrink-0 rounded-sm border-none cursor-pointer',
        'bg-transparent font-inherit text-left text-[11.5px]',
        active ? 'bg-selected text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-hover',
      )}
      onClick={onClick}
    >
      <Icon size={12} className="shrink-0" />
      <span className="flex-1">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-[9.5px] font-mono tabular-nums text-muted-foreground">{count}</span>
      )}
    </button>
  );
}
