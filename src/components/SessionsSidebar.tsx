import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ChevronLeft, ChevronRight, Columns2, Folder, FolderInput, FolderOpen, FolderPlus, Inbox, Library,
  MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Settings, Code, Upload, X,
} from 'lucide-react';
import { TAB_MIME } from '@/lib/dnd';
import * as ipc from '@/lib/ipc';
import { useSettings } from '@/lib/settings-store';
import {
  bySessionOrder, compactAge, matchesQuery, recencyOf, sessionGroup, sessionState, STATE_DOT, STATE_LABEL,
  type SessionGroup,
} from '@/lib/sessions';
import { ACTION_ROW, cn, folderName } from '@/lib/utils';
import { projectHue, type SessionHistoryEntry, type SessionTool, type Tab } from '@/types';

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

/** A past Claude session that isn't open right now, picked to be resumed. */
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
  /** Transcript mtimes by Claude session id, for the age column. */
  lastUsed: Map<string, number>;
  showSettings: boolean;
  /** The Library (closed sessions) is the overlay currently up — the footer
   *  row's pressed state, not a switch for the Archived group below. */
  showArchive: boolean;
  /** What the list shows: `ALL`, `INBOX`, or a project's directory. Lives in
   *  App because ⌘N and the main area follow it too. */
  scope: string;
  onScopeChange: (scope: string) => void;
  /** What a new session starts as. `both` is a Claude session with its shell
   *  already open in a pane beside it. */
  onNewSession: (dir: string | null, kind: NewSessionKind) => void;
  /** Opens the New session dialog. */
  onOpenNewSession: () => void;
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

/** A group heading with its count: NOW 2, TODAY 6, PROJECTS. Not a button
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
  tab, selected, depth, showProject, projects, compact, now, lastUsedAt,
  onSelect, onClose, onRename, onSetProject, onArchive, onTogglePin, onOpenDirectory,
  onOpenInVscode, onCreateTask, onOpenInWorkspace,
}: {
  tab: Tab;
  selected: boolean;
  /** Sessions under a folded day sit one step in from that day's row. */
  depth: 0 | 1;
  /** The top level mixes every project, so a row says which one it's from —
   *  unless the list is already narrowed to a single project. */
  showProject: boolean;
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
  // One second line at most: what Claude is doing beats where it lives.
  const detail = (tab.status === 'working' ? tab.statusDetail : undefined)
    ?? (showProject && tab.projectDir ? folderName(tab.projectDir) : undefined);

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
        <div data-session-meta className="flex items-center gap-1 w-full pl-4 text-[9.5px] leading-tight text-muted-foreground truncate">
          {detail}
        </div>
      )}
    </div>
  );
}

/** What the sidebar is showing: every session, the Inbox, or one project
 *  (by its directory — absolute, so it can't collide with the two words). */
export const ALL = 'all';
export const INBOX = 'inbox';

export function inScope(tab: Tab, scope: string): boolean {
  if (scope === ALL) return true;
  return scope === INBOX ? tab.projectDir === null : tab.projectDir === scope;
}

/** A project's identity colour, the same hue the New session dialog and the
 *  Library use for it. The Inbox has none — it's drawn as a hollow ring. */
function hueStyle(projects: string[], dir: string | null): React.CSSProperties {
  if (dir === null) return { boxShadow: 'inset 0 0 0 1px var(--muted-foreground)' };
  return { background: `hsl(${projectHue(Math.max(0, projects.indexOf(dir)))} 60% 62%)` };
}

/** The loudest live state among some sessions, for a project row's dot:
 *  asking you beats working, and quiet shows nothing. */
function loudest(tabs: Tab[]): 'attention' | 'running' | null {
  const states = tabs.map(sessionState);
  if (states.includes('attention')) return 'attention';
  if (states.includes('running')) return 'running';
  return null;
}

/** One row per project at the top level. Clicking it goes *into* the project
 *  — the whole sidebar becomes that project, under a header in its colour —
 *  rather than filtering in place, which left you guessing whether a filter
 *  was on. */
function ProjectRow({
  dir, label, hue, count, live, onEnter, menu,
}: {
  dir: string;
  label: string;
  hue: React.CSSProperties;
  count: number;
  live: 'attention' | 'running' | null;
  onEnter: () => void;
  menu?: React.ReactNode;
}) {
  const row = (
    <button
      type="button"
      // The Inbox shares the row's shape but isn't a project — no folder, no
      // menu — so it isn't marked as one.
      data-project-row={menu ? '' : undefined}
      data-inbox-row={menu ? undefined : ''}
      title={dir}
      className={cn(
        'group flex items-center gap-2 w-full h-[26px] px-3 shrink-0 rounded-sm',
        'border-none cursor-pointer font-inherit text-left text-[11.5px]',
        'bg-transparent text-dim hover:text-foreground hover:bg-hover',
      )}
      onClick={onEnter}
    >
      <span className="w-[7px] h-[7px] rounded-full shrink-0" style={hue} />
      <span className="truncate flex-1">{label}</span>
      <span className="shrink-0 text-[9.5px] font-mono tabular-nums text-muted-foreground">{count || ''}</span>
      <span className="flex justify-end w-3 shrink-0">
        {live && <span className={cn('w-1.5 h-1.5 rounded-full', STATE_DOT[live])} title={STATE_LABEL[live]} />}
      </span>
      <ChevronRight size={11} className="shrink-0 text-faint group-hover:text-muted-foreground" />
    </button>
  );
  if (!menu) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">{menu}</ContextMenuContent>
    </ContextMenu>
  );
}

/** A folding heading: an older day, or Archived. */
function FoldRow({ label, count, open, onToggle }: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      className="group flex items-center gap-1.5 w-full h-[26px] px-2 shrink-0 rounded-sm border-none cursor-pointer bg-transparent font-inherit text-left text-[11.5px] text-dim hover:text-foreground hover:bg-hover"
      onClick={onToggle}
    >
      <ChevronRight size={11} className={cn('shrink-0 text-muted-foreground transition-transform duration-100', open && 'rotate-90')} />
      <span className="flex-1 truncate">{label}</span>
      <span className="text-[9.5px] font-mono tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

/** Older days fold away; Now and Today never do. */
const FOLDED_GROUPS: { key: SessionGroup; label: string }[] = [
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: 'earlier', label: 'Earlier' },
];

/** A project this small reads as one list — folding three sessions away
 *  behind "Earlier" only adds clicks. */
const SMALL_SCOPE = 8;

/** The sidebar, and the only persistent list of sessions in the app.
 *
 *  Two levels. At the top: every session grouped by when — Now (live or
 *  pinned), Today, then older days folded — and the projects, each a row you
 *  go into. Inside a project: the same groups for that project alone, under a
 *  header in its colour with a way back. Closed sessions live in the Library,
 *  not here. See docs/features/terminals.md. */
export default function SessionsSidebar({
  tabs, selectedId, projects, lastUsed, showSettings, showArchive, scope, onScopeChange,
  onNewSession, onOpenNewSession, onSelect, onClose, onRename, onSetProject,
  onArchive, onTogglePin, onOpenDirectory, onOpenInVscode, onCreateTask, onOpenInWorkspace, onOpenPalette,
  onAddProject, onRemoveProject, onImportSession, onToggleArchive, onToggleSettings,
}: SessionsSidebarProps) {
  const settings = useSettings();
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Powers every age label and the day groups. 30s is plenty — these are
  // "how long", not a clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // A fresh scope starts with its older days folded and no query.
  useEffect(() => { setOpenGroups(new Set()); setQuery(''); }, [scope]);

  const order = useMemo(() => bySessionOrder(lastUsed), [lastUsed]);
  const ageOf = (tab: Tab) => (tab.resumeSessionId ? lastUsed.get(tab.resumeSessionId) : undefined);

  const all = tabs.filter((t) => t.kind !== 'file');
  const open = all.filter((t) => !t.archived);
  const scoped = all.filter((t) => inScope(t, scope));
  const sessions = scoped.filter((t) => matchesQuery(t, query)).sort(order);
  const live = sessions.filter((t) => !t.archived);
  const archived = sessions.filter((t) => t.archived);
  const filtering = query.trim() !== '';
  const groupOf = (t: Tab) => sessionGroup(t, ageOf(t), now);
  const inGroup = (key: SessionGroup) => live.filter((t) => groupOf(t) === key);
  const small = scope !== ALL && scoped.filter((t) => !t.archived).length <= SMALL_SCOPE;

  const scopeName = scope === ALL ? null : scope === INBOX ? 'Inbox' : folderName(scope);
  const scopeDir = scope === ALL || scope === INBOX ? null : scope;
  // Inside a project, the one thing you mustn't miss is a session elsewhere
  // that's waiting on you.
  const waitingElsewhere = scope === ALL ? [] : open.filter((t) => !inScope(t, scope) && sessionState(t) === 'attention');

  const rowProps = {
    projects, compact: settings.compactList, now, showProject: scope === ALL,
    onSelect, onClose, onRename, onSetProject, onArchive, onTogglePin,
    onOpenDirectory, onOpenInVscode, onCreateTask, onOpenInWorkspace,
  };
  const rows = (list: Tab[], depth: 0 | 1) => list.map((tab) => (
    <SessionRow key={tab.id} tab={tab} selected={tab.id === selectedId} depth={depth} lastUsedAt={ageOf(tab)} {...rowProps} />
  ));

  const newKinds = (dir: string | null, Item: typeof DropdownMenuItem | typeof ContextMenuItem) => NEW_SESSION_KINDS.map((kind) => (
    <Item key={kind} onSelect={() => onNewSession(dir, kind)}>
      <Plus size={13} /><span>New {NEW_SESSION_LABEL[kind]}</span>
    </Item>
  ));
  const projectMenu = (dir: string, Item: typeof DropdownMenuItem | typeof ContextMenuItem, Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator) => (
    <>
      {newKinds(dir, Item)}
      <Separator />
      <Item onSelect={() => onOpenDirectory(dir)}><FolderOpen size={13} /><span>Open directory</span></Item>
      <Item onSelect={() => onImportSession(dir)}><FolderInput size={13} /><span>Import session…</span></Item>
      <Separator />
      <Item variant="destructive" onSelect={() => onRemoveProject(dir)}><X size={13} /><span>Remove project</span></Item>
    </>
  );

  const nowRows = inGroup('now');
  const todayRows = inGroup('today');

  return (
    <div
      className="flex flex-col w-full h-full min-h-0 bg-card border-r border-border"
      // The project's colour along the top edge: the one mark that says
      // "you're inside something" before you read a word.
      style={scope !== ALL ? { boxShadow: `inset 0 2px 0 ${scopeDir ? hueStyle(projects, scopeDir).background : 'var(--muted-foreground)'}` } : undefined}
    >
      {scopeName && (
        <div
          data-scope-header
          className="flex items-center gap-1.5 h-10 px-2 shrink-0 border-b border-border"
          style={scopeDir ? { background: `hsl(${projectHue(Math.max(0, projects.indexOf(scopeDir)))} 60% 62% / 0.08)` } : undefined}
        >
          <button
            type="button"
            aria-label="Back to all projects"
            className="flex items-center gap-0.5 h-6 pl-1 pr-2 rounded-sm border border-border bg-transparent text-[11px] text-dim cursor-pointer font-inherit hover:text-foreground hover:bg-hover"
            onClick={() => onScopeChange(ALL)}
          >
            <ChevronLeft size={12} />All
          </button>
          <span className="w-2 h-2 rounded-full shrink-0 ml-1.5" style={hueStyle(projects, scopeDir)} />
          <span className="truncate text-[13px] font-semibold text-foreground" title={scopeDir ?? undefined}>{scopeName}</span>
          <span className="shrink-0 text-[10px] font-mono tabular-nums text-muted-foreground">{scoped.filter((t) => !t.archived).length}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Actions for ${scopeName}`}
                className="ml-auto flex items-center justify-center w-6 h-6 shrink-0 rounded-sm border-none bg-transparent text-muted-foreground cursor-pointer hover:text-foreground hover:bg-hover"
              >
                <MoreHorizontal size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {scopeDir ? projectMenu(scopeDir, DropdownMenuItem, DropdownMenuSeparator) : newKinds(null, DropdownMenuItem)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {waitingElsewhere.length > 0 && (
        <button
          type="button"
          className="flex items-center gap-1.5 h-6 mx-2 mt-1.5 px-2 shrink-0 rounded-sm border border-attention/30 bg-attention/10 text-[10.5px] text-dim cursor-pointer font-inherit text-left hover:text-foreground"
          onClick={() => { onScopeChange(ALL); onSelect(waitingElsewhere[0].id); }}
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-attention" />
          <span className="flex-1 truncate">
            {waitingElsewhere.length} waiting in {waitingElsewhere[0].projectDir ? folderName(waitingElsewhere[0].projectDir) : 'Inbox'}
            {waitingElsewhere.length > 1 && ' and elsewhere'}
          </span>
          <ChevronRight size={11} className="shrink-0 text-muted-foreground" />
        </button>
      )}

      {/* Search and New sit above every group because they're the two things
          you do without first knowing what's in the list. Inside a project
          both say so. */}
      <div className="flex flex-col gap-1.5 px-2 pt-2 pb-1 shrink-0">
        <div className="flex items-center gap-1.5 h-[26px] px-2 rounded-sm border border-border focus-within:border-border-hover">
          <Search size={11} className="shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            placeholder={scopeName ? `Search ${scopeName}…` : 'Search sessions…'}
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

        {/* What to start is a choice, so the button asks — in a dialog, where
            there's room for where, what and a name. ⌘N opens the same one,
            already pointed at the project you're in. */}
        <button
          type="button"
          className={cn(
            'flex items-center gap-1.5 w-full h-[26px] px-2 rounded-sm cursor-pointer font-inherit',
            'border border-border bg-transparent text-[11.5px] text-foreground',
            'hover:border-border-hover hover:bg-hover',
          )}
          onClick={onOpenNewSession}
        >
          <Plus size={12} className="shrink-0 text-primary" />
          <span className="flex-1 text-left truncate">{scopeName ? `New session in ${scopeName}` : 'New session'}</span>
          <span className="shrink-0 text-[9px] text-faint">⌘N</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-1 pb-2 scrollbar-thin">
        {scopeDir && <div className="px-3 pt-1 font-mono text-[10px] text-faint truncate" title={scopeDir}>{scopeDir}</div>}

        {nowRows.length > 0 && (
          <>
            <GroupLabel count={nowRows.length}>Now</GroupLabel>
            {rows(nowRows, 0)}
          </>
        )}

        <GroupLabel count={todayRows.length}>Today</GroupLabel>
        {todayRows.length === 0 ? (
          <p className="px-3 py-1 text-[10.5px] leading-snug text-faint">
            {filtering
              ? 'Nothing from today matches.'
              : scopeName ? `Nothing in ${scopeName} today.` : 'Nothing yet today. ⌘N starts a session.'}
          </p>
        ) : rows(todayRows, 0)}

        {FOLDED_GROUPS.map(({ key, label }) => {
          const list = inGroup(key);
          if (list.length === 0) return null;
          // Open when asked, when searching (a match can't hide in a folded
          // day), when it holds the session you're looking at, or when the
          // whole project is small enough to read as one list.
          const isOpen = openGroups.has(key) || filtering || small || list.some((t) => t.id === selectedId);
          return (
            <div key={key} className="mt-1">
              <FoldRow
                label={label}
                count={list.length}
                open={isOpen}
                onToggle={() => setOpenGroups((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(key)) next.add(key);
                  return next;
                })}
              />
              {isOpen && rows(list, 1)}
            </div>
          );
        })}

        {scope === ALL && (
          <>
            <GroupLabel>Projects</GroupLabel>
            <ProjectRow
              dir="Sessions filed under no project"
              label="Inbox"
              hue={hueStyle(projects, null)}
              count={open.filter((t) => t.projectDir === null).length}
              live={loudest(open.filter((t) => t.projectDir === null))}
              onEnter={() => onScopeChange(INBOX)}
            />
            {projects.map((dir) => {
              const owned = open.filter((t) => t.projectDir === dir);
              return (
                <ProjectRow
                  key={dir}
                  dir={dir}
                  label={folderName(dir)}
                  hue={hueStyle(projects, dir)}
                  count={owned.length}
                  live={loudest(owned)}
                  onEnter={() => onScopeChange(dir)}
                  menu={projectMenu(dir, ContextMenuItem, ContextMenuSeparator)}
                />
              );
            })}
            <button
              type="button"
              className={cn(ACTION_ROW, 'gap-1.5 h-[26px] px-3 text-[11.5px]')}
              onClick={onAddProject}
            >
              <FolderPlus size={12} className="shrink-0" />
              <span>Add a project folder…</span>
            </button>
          </>
        )}

        {/* Archived sessions are still in the workspace, so they get a group
            of their own rather than living in the Library — that holds
            *closed* sessions, which is a different thing. */}
        {archived.length > 0 && (
          <div className="mt-3">
            <FoldRow label="Archived" count={archived.length} open={archiveOpen} onToggle={() => setArchiveOpen((v) => !v)} />
            {archiveOpen && rows(archived, 1)}
          </div>
        )}
      </div>

      <div className="flex flex-col shrink-0 border-t border-border px-1 py-1">
        <FooterRow icon={Library} label="Library" active={showArchive} onClick={onToggleArchive} />
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
