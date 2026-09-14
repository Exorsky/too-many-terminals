import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  CheckCircle2, ChevronDown, Circle, Code, File, Folder, FolderInput, FolderOpen, FolderPlus, KeyRound, Loader2,
  MessageCircle, History, Moon, PanelLeftClose, PanelLeftOpen, Pencil, Pin, PinOff, Plus, Search, Settings, Sparkles,
  TerminalSquare, Upload, X,
  type LucideIcon,
} from 'lucide-react';
import * as ipc from '@/lib/ipc';
import type { EnvReport, EnvSource } from '@/lib/ipc';
import { cn, folderName } from '@/lib/utils';
import { projectHue, type ShellOption, type Tab, type TabStatus } from '@/types';
import { useSettings } from '@/lib/settings-store';
import SidebarFooter, { formatDuration } from './SidebarFooter';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface SidebarProps {
  tabs: Tab[];
  activeTabId: string | null;
  shellOptions: ShellOption[];
  showHistory: boolean;
  showSettings: boolean;
  showHome: boolean;
  showFiles: boolean;
  projects: string[];
  collapsed: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenDirectory: (dir: string) => void;
  onOpenInVscode: (tabId: string) => void;
  onNewClaudeTab: (dir: string) => void;
  onNewShellTab: (dir: string, shellId: string) => void;
  onRenameTab: (tabId: string, name: string) => void;
  onTogglePin: (tabId: string) => void;
  onOpenSearch: () => void;
  onToggleHistory: () => void;
  onToggleSettings: () => void;
  onToggleFiles: () => void;
  onGoHome: () => void;
  onAddProject: () => void;
  onRemoveProject: (dir: string) => void;
  onImportSession: (dir: string) => void;
  onReorderProject: (sourceDir: string, targetDir: string, position: DropPos) => void;
  onToggleCollapse: () => void;
}

/** Which side of the hovered square the dragged folder will land on. Folders
 *  are the only thing left that carries a hand-made order — sessions now derive
 *  theirs from status (see `sortRank`), so there's nothing to drag them into. */
type DropPos = 'before' | 'after';

/** The rail runs down, not across, so the split is on Y. */
function dropSideY(e: { clientY: number; currentTarget: HTMLElement }): DropPos {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
}

/** The insertion line shown while dragging a folder square — a glowing accent
 *  bar in the gap the square will drop into. Horizontal, since the rail is
 *  vertical: an outline couldn't say *above* vs *below*. */
function DropLine({ pos }: { pos: DropPos }) {
  return (
    <span
      className={cn(
        'absolute z-10 left-0.5 right-0.5 h-0.5 rounded-full bg-primary pointer-events-none',
        'shadow-[0_0_6px_0_var(--primary)]',
        pos === 'before' ? '-top-px' : '-bottom-px',
      )}
    />
  );
}

/** Live status of a Claude tab, learned from Claude Code's own hooks. A
 *  dormant tab (restored-but-not-yet-shown, or auto-slept while idle) has no
 *  live process, so it reads as a quiet moon regardless of its last status. */
export function TabIndicator({ status, dormant, size = 12 }: { status: TabStatus; dormant?: boolean; size?: number }) {
  if (dormant) {
    return <Moon size={size} className="shrink-0 text-muted-foreground/50" />;
  }
  switch (status) {
    case 'working':
      return <Loader2 size={size} className="shrink-0 text-warning animate-spin" />;
    case 'idle':
      return <CheckCircle2 size={size} className="shrink-0 text-success" />;
    case 'requires_response':
      return <MessageCircle size={size} className="shrink-0 text-attention animate-pulse" />;
    case 'new':
      return <Circle size={size} className="shrink-0 text-muted-foreground/50" />;
  }
}

/** How long a `requires_response` tab has been waiting — the only status
 *  where elapsed time is the useful signal ("waiting 2h" vs. "waiting 10s"
 *  are different problems). Rendered on `RowMeta`'s second line, which it
 *  shares with the folder chip and the activity summary. */
function elapsedLabel(tab: Tab, now: number): string | null {
  if (tab.status !== 'requires_response' || !tab.statusChangedAt) return null;
  return formatDuration((now - tab.statusChangedAt) / 1000);
}

/** Splits a tool-summary string ("editing Sidebar.tsx") into a muted verb
 *  and the thing it's acting on, so the caption can highlight the target the
 *  way the mockup did — the target is what's worth a second glance, not the
 *  verb. Falls back to showing the whole string muted when there's no clean
 *  split (a bare tool/MCP name with no leading verb). */
function splitActivityDetail(detail: string): [verb: string, target: string | null] {
  const spaceAt = detail.indexOf(' ');
  return spaceAt === -1 ? [detail, null] : [detail.slice(0, spaceAt + 1), detail.slice(spaceAt + 1)];
}

/** Everything about a session that isn't its name: which folder it's in, what
 *  Claude is doing right now, how long it's been waiting. All of it goes on a
 *  second line under the name rather than competing with it — a folder chip
 *  taking 40% of a 260px row left names reading "Commit to ma…", which is no
 *  name at all. The line renders only when it has something to say, so with a
 *  single folder open and nothing happening, rows stay one line tall.
 *
 *  `warning` on the activity target is the color `working` already owns in the
 *  status vocabulary — not a new accent. */
function RowMeta({ tab, showFolder, hue, lastUsedAt, now }: {
  tab: Tab;
  showFolder?: boolean;
  hue?: number;
  /** When this session's transcript was last written, from `useLastUsed`. */
  lastUsedAt?: number;
  now: number;
}) {
  const detail = tab.status === 'working' ? tab.statusDetail : undefined;
  const elapsed = elapsedLabel(tab, now);

  // Whichever of the two clocks is fresher: a live status transition this run,
  // or the transcript's own mtime for a session restored from a past one.
  const seenAt = Math.max(tab.statusChangedAt ?? 0, lastUsedAt ?? 0);
  // A session mid-turn was last used *now* — the activity summary already says
  // so, and "0m ago" next to it reads like a glitch.
  const lastUsed = !elapsed && tab.status !== 'working' && seenAt > 0
    ? `${formatDuration((now - seenAt) / 1000)} ago`
    : null;

  if (!showFolder && !detail && !elapsed && !lastUsed) return null;

  const [verb, target] = detail ? splitActivityDetail(detail) : ['', null];

  return (
    <div data-testid="row-meta" className="flex items-center gap-1.5 w-full pl-5 pr-1 text-[9.5px] leading-tight text-muted-foreground/70">
      {showFolder && (
        <span className="flex items-center gap-1 min-w-0 shrink">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: `hsl(${hue ?? 0} 55% 50%)` }} />
          <span className="truncate">{folderName(tab.cwd)}</span>
        </span>
      )}
      {detail && (
        <span className="min-w-0 shrink truncate">
          {verb}
          {target && <span className="text-warning">{target}</span>}
        </span>
      )}
      {(elapsed || lastUsed) && (
        <span className="ml-auto shrink-0 tabular-nums" title={elapsed ? 'Waiting on you' : 'Last used'}>
          {elapsed ?? lastUsed}
        </span>
      )}
    </div>
  );
}

/** When each resumable session last wrote to its transcript, keyed by session
 *  id. Tabs carry no such date of their own — one restored from a past run
 *  comes back with nothing but an id — so this reads the same file mtimes
 *  History reads (`listSessions`), once per open folder. */
function useLastUsed(projects: string[], sessionCount: number): Map<string, number> {
  const [map, setMap] = useState<Map<string, number>>(new Map());
  const key = projects.join(' ');

  useEffect(() => {
    let alive = true;
    Promise.all(projects.map((dir) => ipc.listSessions(dir).catch(() => [])))
      .then((lists) => {
        if (!alive) return;
        const next = new Map<string, number>();
        for (const entry of lists.flat()) {
          const ms = new Date(entry.lastUsedIso).getTime();
          if (!Number.isNaN(ms)) next.set(entry.sessionId, ms);
        }
        setMap(next);
      })
      .catch(() => {});
    return () => { alive = false; };
    // `key` stands in for `projects`, which is a fresh array on some renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sessionCount]);

  return map;
}

/** The four cross-cutting collections the ledger counts and filters by. Three
 *  of them (waiting / done / pinned) were each their own strip above the folder
 *  list once, which meant every session in one rendered *twice*. They're counts
 *  now. See docs/features/attention-inbox.md. */
export type Bucket = 'waiting' | 'working' | 'done' | 'pinned';

/** Which buckets a tab belongs to — the single definition, read by the ledger
 *  counts and the status filter. A tab can be in two at once (a pinned session
 *  that's also waiting on you).
 *
 *  `dormant` suppresses waiting/working the same way `TabIndicator` draws a
 *  moon over them: there's no live process behind the status, so counting it
 *  as running would contradict the row's own glyph. */
export function bucketsOf(tab: Tab): Bucket[] {
  if (tab.exited) return [];
  const out: Bucket[] = [];
  if (tab.kind === 'claude' && !tab.dormant) {
    if (tab.status === 'requires_response') out.push('waiting');
    else if (tab.status === 'working') out.push('working');
  }
  if (tab.kind === 'claude' && tab.justFinished) out.push('done');
  if (tab.pinned) out.push('pinned');
  return out;
}

/** A tab's live state as one value. This mirrors `TabIndicator`'s vocabulary
 *  exactly, and deliberately *isn't* derived from `bucketsOf`: buckets are a
 *  filter concept ("show me what just finished"), this is a status concept
 *  ("what is this session doing"). Deriving one from the other is what made an
 *  `idle` session sort as quiet — `done` needs `justFinished`, so a session
 *  sitting there finished-and-seen fell into no bucket at all and ranked with
 *  the sleepers despite its own row showing a green check. */
type Seg = 'waiting' | 'working' | 'idle' | 'quiet';

function segOf(tab: Tab): Seg {
  if (tab.exited || tab.kind !== 'claude' || tab.dormant) return 'quiet';
  switch (tab.status) {
    case 'requires_response': return 'waiting';
    case 'working': return 'working';
    case 'idle': return 'idle';
    case 'new': return 'quiet';
  }
}

/** The 2px bar down a row's left edge, drawn only for the two states worth
 *  finding by eye. Live states outrank "selected": the row you're looking at
 *  is already obvious from its background tint, whereas a session that needs
 *  you is exactly what the column of color exists to surface. */
function spineClass(tab: Tab, isActive: boolean): string | null {
  switch (segOf(tab)) {
    case 'waiting': return 'bg-attention';
    case 'working': return 'bg-warning';
    default: return isActive ? 'bg-primary' : null;
  }
}

/** How recently a session was touched, as epoch ms — the list's sort key.
 *
 *  Three clocks, whichever is freshest: when you opened it in this run, its
 *  last status change, and the mtime of its transcript for one restored from a
 *  previous run. A session you just started has only the first, a session
 *  working right now keeps bumping the second, and a restored one that has sat
 *  untouched for a week has only the third — so all three kinds land where you
 *  would expect without any of them needing a special case. */
export function recencyOf(tab: Tab, lastUsedAt?: number): number {
  return Math.max(tab.createdAt ?? 0, tab.statusChangedAt ?? 0, lastUsedAt ?? 0);
}

/** Order of the one flat list: newest first.
 *
 *  What you pinned still sits above everything — pinning is the one explicitly
 *  manual thing in a list that otherwise derives its own order, and a pin that
 *  scrolled away with age would mean nothing. Everything else is purely by
 *  recency, so a session you just opened, and one that is working right now,
 *  are both at the top without status needing its own ranking tier. */
function orderOf(tab: Tab, lastUsed: Map<string, number>): [pinned: number, recency: number] {
  return [
    tab.pinned && !tab.exited ? 0 : 1,
    recencyOf(tab, tab.resumeSessionId ? lastUsed.get(tab.resumeSessionId) : undefined),
  ];
}

/** Whether a session is worth one of the collapsed rail's squares.
 *
 *  Only **auto-slept** sessions are left out. At 44px a session is one status
 *  glyph and nothing else — no name, no folder, no time — so a column of them
 *  reads as a bar chart with no labels, and a dormant session is the one kind
 *  that is guaranteed to have nothing to report: its process is freed and it
 *  is waiting to be resumed.
 *
 *  Everything else keeps its square. Shells have no Claude status but can
 *  perfectly well be running a build. **Exited** sessions stay too: the
 *  process is gone but its scrollback isn't, and reading what a command
 *  printed before it died is a normal reason to click one.
 *
 *  The session you are looking at is always kept, asleep or not — dropping the
 *  square under the cursor would leave the rail without the one thing it is
 *  definitely about. */
export function railWorthy(tab: Tab, activeTabId: string | null): boolean {
  return tab.id === activeTabId || !tab.dormant;
}

/** Chip order in the ledger, and the status colors each one borrows. No new
 *  hues — every entry reuses the color its status already owns (see
 *  docs/design.md, Status vocabulary), including the spin/pulse treatment, so
 *  "someone is waiting on you" reads from the ledger alone. */
const LEDGER: { key: Bucket; label: string; icon: LucideIcon; icon_: string; on: string }[] = [
  { key: 'waiting', label: 'waiting on you', icon: MessageCircle, icon_: 'text-attention animate-pulse', on: 'bg-attention/15 text-attention' },
  { key: 'working', label: 'running',        icon: Loader2,       icon_: 'text-warning animate-spin',    on: 'bg-warning/15 text-warning' },
  { key: 'done',    label: 'just finished',  icon: CheckCircle2,  icon_: 'text-success',                 on: 'bg-success/15 text-success' },
  { key: 'pinned',  label: 'pinned',         icon: Pin,           icon_: 'text-primary',                 on: 'bg-primary/15 text-primary' },
];

/** What a folder pill is called. Just the folder name, until two open folders
 *  share one — then both grow their nearest ancestor, and only those two, so
 *  the row stays short. This replaces the old **Show folder paths** preference:
 *  the breadcrumb it gated lived on the folder-group header, which no longer
 *  exists, and telling two identically-named folders apart is correctness
 *  rather than taste — not something to leave off behind a toggle. */
export function pillLabel(dir: string, projects: string[]): string {
  const name = folderName(dir);
  const collides = projects.some((other) => other !== dir && folderName(other) === name);
  if (!collides) return name;
  const segments = dir.split(/[/\\]/).filter(Boolean);
  const parent = segments[segments.length - 2];
  return parent ? `${parent}/${name}` : name;
}

/** A pill's spoken name. The visible label and count sit in separate elements
 *  with only a flex gap between, so the computed name would run them together
 *  ("project2") without this. */
function pillAria(label: string, count: number): string {
  return `${label}, ${count} session${count === 1 ? '' : 's'}`;
}

/** The one character a 28px square has room for: the folder's own initial,
 *  not the disambiguating ancestor `pillLabel` may have prefixed — `one/api`
 *  and `two/api` are both "A", and it's the hue that tells them apart. */
export function squareInitial(label: string): string {
  const name = label.split('/').pop() ?? label;
  return (name[0] ?? '?').toUpperCase();
}

export function matchesQuery(tab: Tab, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return tab.name.toLowerCase().includes(q) || folderName(tab.cwd).toLowerCase().includes(q);
}

/** The search field: type to narrow the list. Its own band now, the full
 *  width of the column, because sharing 32px with four status chips left it
 *  92px wide — not enough for one word of a query.
 *
 *  Deliberately no keyboard shortcut of its own: a bare `/` would swallow
 *  keystrokes meant for the terminal, and Ctrl+Shift+P already opens the
 *  command palette (see docs/features/command-palette.md). This is for
 *  narrowing while you keep looking at the list, which a modal palette can't
 *  do. */
function SidebarSearch({ query, onQuery }: {
  query: string;
  onQuery: (query: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center h-[34px] px-2 shrink-0 border-b border-border">
      <div className="flex items-center gap-1.5 flex-1 min-w-0 h-[22px] px-1.5 rounded-sm border border-border">
        <Search size={11} className="shrink-0 text-muted-foreground/60" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="filter…"
          aria-label="Filter sessions"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); onQuery(''); inputRef.current?.blur(); }
          }}
          className={cn(
            'flex-1 min-w-8 bg-transparent border-none outline-none font-inherit',
            'text-[11px] text-foreground placeholder:text-muted-foreground/50',
          )}
        />
        {query !== '' && (
          <button
            type="button"
            aria-label="Clear filter"
            className="flex items-center justify-center w-4 h-4 rounded-sm shrink-0 border-none cursor-pointer bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/10"
            onClick={() => { onQuery(''); inputRef.current?.focus(); }}
          >
            <X size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

/** The live counts, one chip per non-empty bucket, clicking one filters the
 *  list. Their own 22px band under the search field; the whole band is gone
 *  when every count is zero, so a quiet workspace pays nothing for it. */
function LedgerStrip({ tabs, bucket, onBucket }: {
  tabs: Tab[];
  bucket: Bucket | null;
  onBucket: (bucket: Bucket | null) => void;
}) {
  const counts = new Map(LEDGER.map(({ key }) => [key, 0]));
  for (const tab of tabs) {
    for (const b of bucketsOf(tab)) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  if (LEDGER.every(({ key }) => (counts.get(key) ?? 0) === 0)) return null;

  return (
    <div className="flex items-center gap-1 h-[22px] px-2 shrink-0 border-b border-border">
      {LEDGER.map(({ key, label, icon: Icon, icon_, on }) => {
        const count = counts.get(key) ?? 0;
        if (count === 0) return null;
        const isOn = bucket === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={isOn}
            aria-label={`${label}: ${count}`}
            className={cn(
              'flex items-center gap-1 px-1.5 rounded-sm shrink-0 border-none cursor-pointer',
              'text-[10px] font-semibold tabular-nums font-inherit transition-colors duration-100',
              isOn ? on : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5',
            )}
            onClick={() => onBucket(isOn ? null : key)}
          >
            <Icon size={10} className={cn('shrink-0', isOn ? '' : icon_)} />
            {count}
          </button>
        );
      })}
    </div>
  );
}

/** What the ledger's chips say in 4px, for the compact list: one segment per
 *  live state, its width the share of sessions in it. It answers "how much of
 *  this is asleep" without a word or a number, which is the only question a
 *  4px band can answer — it is read-only on purpose, since a segment too thin
 *  to see is also too thin to click.
 *
 *  Partitioned by `segOf`, not `bucketsOf`: a proportion bar needs every
 *  session in exactly one segment, and a tab can sit in two buckets at once. */
const SPECTRUM: { seg: Seg; label: string; color: string }[] = [
  { seg: 'waiting', label: 'waiting on you', color: 'bg-attention' },
  { seg: 'working', label: 'running',        color: 'bg-warning' },
  { seg: 'idle',    label: 'idle',           color: 'bg-success' },
  { seg: 'quiet',   label: 'asleep',         color: 'bg-border-hover' },
];

function Spectrum({ tabs }: { tabs: Tab[] }) {
  if (tabs.length === 0) return null;
  const segments = SPECTRUM
    .map(({ seg, label, color }) => ({ label, color, count: tabs.filter((t) => segOf(t) === seg).length }))
    .filter((s) => s.count > 0);

  return (
    <div
      data-testid="spectrum"
      className="flex h-1 shrink-0"
      role="img"
      aria-label={segments.map((s) => `${s.count} ${s.label}`).join(', ')}
    >
      {segments.map(({ label, color, count }) => (
        <span key={label} className={color} style={{ width: `${(count / tabs.length) * 100}%` }} />
      ))}
    </div>
  );
}

/** One folder, as a 28px square in the rail. Carries everything the folder
 *  pill carried before it — the accent hue that identifies it, its session
 *  count, the credentials glyph, its whole context menu, drag-to-reorder — in
 *  a column instead of a wrapping row.
 *
 *  That's the whole reason for the shape. Pills wrapped, so the chrome above
 *  the list was 34px tall with three folders open and 90px with eight, and
 *  the list jumped every time you opened a project. A column of squares grows
 *  into space that was empty anyway, and the bands above the list stop moving. */
function FolderSquare({
  dir, index, label, count, selected, dimmed, hot, dragRef, shellOptions,
  onSelect, onHot, onNewClaudeTab, onNewShellTab, onOpenDirectory, onImportSession, onRemoveProject, onReorderProject,
}: {
  dir: string;
  index: number;
  label: string;
  count: number;
  selected: boolean;
  /** Some *other* folder is the filter, so this one is out of focus. Fades
   *  rather than hides: the rail still answers "which folders are open", it
   *  just stops competing with the one you picked. Hover brings it back, so
   *  reaching for another folder never means aiming at something greyed out. */
  dimmed: boolean;
  /** The name panel's matching row is under the cursor. Lighting both halves
   *  is the only thing that teaches which letter belongs to which name. */
  hot: boolean;
  dragRef: MutableRefObject<string | null>;
  shellOptions: ShellOption[];
  onSelect: () => void;
  onHot: (dir: string | null) => void;
  onNewClaudeTab: (dir: string) => void;
  onNewShellTab: (dir: string, shellId: string) => void;
  onOpenDirectory: (dir: string) => void;
  onImportSession: (dir: string) => void;
  onRemoveProject: (dir: string) => void;
  onReorderProject: (sourceDir: string, targetDir: string, position: DropPos) => void;
}) {
  const [dropPos, setDropPos] = useState<DropPos | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const hue = projectHue(index);

  // With enough folders open the rail scrolls, so the one you just picked can
  // sit below the fold — selecting a folder would narrow the list with the
  // reason for it out of sight.
  useEffect(() => {
    // Optional-called: jsdom doesn't implement scrollIntoView, and a throw
    // here would take the whole rail down with it.
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  // Which credentials this folder hands to sessions opened in it. Read here
  // rather than reported back from a spawn, so a folder you haven't opened a
  // tab in yet still shows the glyph. Re-read when the count changes — the
  // cheapest hook for "you were just working in here".
  const [envReport, setEnvReport] = useState<EnvReport | null>(null);
  useEffect(() => {
    let alive = true;
    ipc.envNames(dir).then((report) => { if (alive) setEnvReport(report); }).catch(() => {});
    return () => { alive = false; };
  }, [dir, count]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          ref={ref}
          type="button"
          aria-pressed={selected}
          aria-label={pillAria(label, count)}
          title={dir}
          data-dimmed={dimmed && !hot || undefined}
          className={cn(
            'relative flex items-center justify-center w-7 h-7 shrink-0 rounded-sm cursor-pointer font-inherit',
            'text-[11px] font-semibold border transition-[opacity,background-color,border-color] duration-100',
            !selected && 'hover:bg-white/5',
            hot && !selected && 'bg-white/5',
            dimmed && !hot && 'opacity-35 hover:opacity-100',
          )}
          onMouseEnter={() => onHot(dir)}
          onMouseLeave={() => onHot(null)}
          // Drawn in the folder's own hue — the color already spent on
          // identifying this folder everywhere else. A neutral tint said
          // nothing at all next to seven other squares carrying the same one.
          style={{
            borderColor: `hsl(${hue} 55% 52% / ${selected ? 1 : 0.3})`,
            backgroundColor: `hsl(${hue} 55% 50% / ${selected ? 0.28 : 0.1})`,
            color: `hsl(${hue} 60% ${selected ? 82 : 70}%)`,
          }}
          draggable
          onDragStart={(e) => {
            dragRef.current = dir;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', dir);
          }}
          onDragEnd={() => { dragRef.current = null; setDropPos(null); }}
          onDragOver={(e) => {
            if (!dragRef.current || dragRef.current === dir) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDropPos(dropSideY(e));
          }}
          onDragLeave={() => setDropPos(null)}
          onDrop={(e) => {
            const from = dragRef.current;
            if (from && from !== dir) { e.preventDefault(); onReorderProject(from, dir, dropSideY(e)); }
            setDropPos(null);
          }}
          onClick={onSelect}
        >
          {dropPos && <DropLine pos={dropPos} />}
          {/* The folder's initial. The hue does the identifying — this is what
              keeps two same-hued neighbours apart at a glance, and the name is
              a hover away in the title. */}
          <span aria-hidden="true">{squareInitial(label)}</span>
          {count > 0 && (
            <span className="absolute -top-1 -right-1 px-[3px] rounded-sm bg-card text-[8px] leading-[1.3] tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
          {envReport?.folderScoped && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn('absolute -bottom-0.5 -left-0.5 flex items-center text-muted-foreground', envReport.unreadable && 'opacity-50')}>
                  <KeyRound size={8} />
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">{envTooltip(dir, envReport)}</TooltipContent>
            </Tooltip>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-40">
        <ContextMenuItem onSelect={() => onNewClaudeTab(dir)}>
          <Sparkles size={13} />
          <span>New Claude session</span>
        </ContextMenuItem>
        {shellOptions.map((shell) => (
          <ContextMenuItem key={shell.id} onSelect={() => onNewShellTab(dir, shell.id)}>
            <TerminalSquare size={13} />
            <span>New {shell.label}</span>
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onOpenDirectory(dir)}>
          <FolderOpen size={13} />
          <span>Open directory</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onImportSession(dir)}>
          <FolderInput size={13} />
          <span>Import session…</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => onRemoveProject(dir)}>
          <X size={13} />
          <span>Remove folder</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A folder's label with its disambiguating ancestor muted, so `one/api` and
 *  `two/api` read as two APIs rather than two paths. */
function NameLabel({ label }: { label: string }) {
  const cut = label.lastIndexOf('/');
  if (cut === -1) return <>{label}</>;
  return (
    <>
      <span className="text-muted-foreground/60">{label.slice(0, cut + 1)}</span>
      {label.slice(cut + 1)}
    </>
  );
}

/** The rail's squares, spelled out. One letter identifies a folder right up
 *  until two folders share it — `clients/api` and `internal/api` are both "A",
 *  and the per-square tooltip is no help there because it shows one name at a
 *  time, which is exactly what makes them impossible to *compare*.
 *
 *  The panel doesn't move or widen the rail. It butts against its right edge,
 *  one row per square at the same 32px pitch, so row `i` sits beside square
 *  `i` and the square works as that row's icon — which is why no hue dot is
 *  repeated here, and no credentials glyph either: both are already on the
 *  square six pixels to the left, and saying it twice on one line is noise.
 *
 *  Rows are the same filter the squares are, so this is also how you pick a
 *  folder by name when you can't remember its letter.
 *
 *  ponytail: rows align to the rail's unscrolled position. The folder column
 *  only scrolls past ~12 open folders; if that ever becomes normal, mirror its
 *  scrollTop onto the panel. */
function FolderNames({
  projects, tabs, selected, hot, open, onSelect, onHot, onAddProject,
}: {
  projects: string[];
  tabs: Tab[];
  selected: string | null;
  hot: string | null;
  open: boolean;
  onSelect: (dir: string | null) => void;
  onHot: (dir: string | null) => void;
  onAddProject: () => void;
}) {
  const row = 'flex items-center gap-2 w-full h-7 px-2 shrink-0 rounded-sm border-none cursor-pointer'
    + ' bg-transparent font-inherit text-[11px] text-left transition-colors duration-100';

  return (
    <div
      data-testid="folder-names"
      role="group"
      aria-label="Open folders"
      aria-hidden={!open}
      // -top-1.5 cancels the rail's own padding so the first row lands on the
      // first square; left-full puts the panel flush against the rail, which
      // is what keeps the pointer from ever crossing a gap on its way over.
      className={cn(
        'absolute left-full -top-1.5 z-20 w-[196px] flex flex-col gap-1 px-1.5 py-[5px]',
        'bg-card border border-l-0 border-border rounded-r-sm shadow-[14px_0_28px_-14px_rgba(0,0,0,0.85)]',
        'transition-[opacity,transform] duration-100 motion-reduce:transition-none',
        open ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1.5 pointer-events-none',
      )}
    >
      <button
        type="button"
        tabIndex={open ? 0 : -1}
        className={cn(row, selected === null
          ? 'bg-white/8 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-white/5')}
        onClick={() => onSelect(null)}
      >
        <span className="flex-1 min-w-0 truncate">All folders</span>
        <span className="shrink-0 text-[9.5px] tabular-nums text-muted-foreground">{tabs.length}</span>
      </button>

      {projects.map((dir) => {
        const isSelected = selected === dir;
        return (
          <button
            key={dir}
            type="button"
            tabIndex={open ? 0 : -1}
            title={dir}
            className={cn(row,
              isSelected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              !isSelected && hot === dir && 'bg-white/5 text-foreground',
              !isSelected && 'hover:bg-white/5')}
            style={isSelected
              ? { backgroundColor: `hsl(${projectHue(projects.indexOf(dir))} 55% 50% / 0.16)` }
              : undefined}
            onClick={() => onSelect(isSelected ? null : dir)}
            onMouseEnter={() => onHot(dir)}
            onMouseLeave={() => onHot(null)}
          >
            <span className="flex-1 min-w-0 truncate">
              <NameLabel label={pillLabel(dir, projects)} />
            </span>
            <span className="shrink-0 text-[9.5px] tabular-nums text-muted-foreground">
              {tabs.filter((t) => t.cwd === dir).length}
            </span>
          </button>
        );
      })}

      <button
        type="button"
        tabIndex={open ? 0 : -1}
        className={cn(row, 'text-muted-foreground/70 hover:text-foreground hover:bg-white/5')}
        onClick={onAddProject}
      >
        <span className="flex-1 min-w-0 truncate">Add folder…</span>
      </button>
    </div>
  );
}

/** One always-visible navigation square in the rail. */
function RailButton({ icon: Icon, label, active, onClick }: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-active={active}
      aria-label={label}
      title={label}
      className={cn(
        'flex items-center justify-center w-7 h-7 shrink-0 rounded-sm border-none cursor-pointer bg-transparent',
        active ? 'text-foreground bg-white/8' : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
      )}
      onClick={onClick}
    >
      <Icon size={14} />
    </button>
  );
}

/** The rail: every folder as a square up top, every app-level destination as a
 *  square down bottom, one hairline between them.
 *
 *  Both halves are here for the same reason — neither is about *this list*.
 *  Which folder to look at and where to navigate are questions the list can't
 *  answer, so they leave the column and the column keeps only the three bands
 *  that do narrow it. That also fixes what the wrapping pill row broke: the
 *  rail grows downward into space that was empty, so opening a ninth folder
 *  no longer pushes the first session further down the screen. */
function SidebarRail({
  projects, tabs, selected, shellOptions, showHome, showHistory, showFiles, showSettings,
  onSelect, onNewClaudeTab, onNewShellTab, onOpenDirectory, onImportSession, onRemoveProject, onReorderProject,
  onAddProject, onGoHome, onOpenSearch, onToggleHistory, onToggleFiles, onToggleSettings, onToggleCollapse,
}: {
  projects: string[];
  tabs: Tab[];
  selected: string | null;
  shellOptions: ShellOption[];
  showHome: boolean;
  showHistory: boolean;
  showFiles: boolean;
  showSettings: boolean;
  onSelect: (dir: string | null) => void;
  onNewClaudeTab: (dir: string) => void;
  onNewShellTab: (dir: string, shellId: string) => void;
  onOpenDirectory: (dir: string) => void;
  onImportSession: (dir: string) => void;
  onRemoveProject: (dir: string) => void;
  onReorderProject: (sourceDir: string, targetDir: string, position: DropPos) => void;
  onAddProject: () => void;
  onGoHome: () => void;
  onOpenSearch: () => void;
  onToggleHistory: () => void;
  onToggleFiles: () => void;
  onToggleSettings: () => void;
  onToggleCollapse: () => void;
}) {
  const dragRef = useRef<string | null>(null);

  // Which folder the cursor is over, on either side of the pairing.
  const [hot, setHot] = useState<string | null>(null);
  const [namesOpen, setNamesOpen] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearTimers = () => {
    if (openTimer.current !== null) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  useEffect(() => clearTimers, []);

  /** Hover waits, focus doesn't. The rail sits on the way to the list, so a
   *  pointer crossing it hasn't asked for anything — 300ms is the floor
   *  Baymard measured for hover-opened content, below which the flicker
   *  starts. Moving focus onto a square is already deliberate, and making the
   *  keyboard wait for a pointer's grace period would just read as broken. */
  const openNames = (immediate = false) => {
    clearTimers();
    if (immediate) setNamesOpen(true);
    else openTimer.current = window.setTimeout(() => setNamesOpen(true), 300);
  };
  const closeNames = () => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => { setNamesOpen(false); setHot(null); }, 120);
  };

  return (
    <div data-testid="rail" className="relative z-10 flex flex-col items-center gap-1 w-11 shrink-0 py-1.5 bg-background border-r border-border">
      {/* The collapse toggle is the rail's first square in both states, so it
          sits at the same point on screen whichever way the sidebar is folded
          and clicking it never throws the button somewhere else. */}
      <RailButton icon={PanelLeftClose} label="Hide sidebar" onClick={onToggleCollapse} />
      <div className="w-5 border-t border-border shrink-0" />

      {/* Clicking a selected folder again clears the filter, but that's a
          thing you have to already know — this is the way back that's visible
          without guessing. */}
      {/* One region for the squares and their labels both. The panel is flush
          against the rail, so the pointer never crosses a gap between them and
          none of the usual safe-triangle machinery is needed. */}
      <div
        className="relative flex flex-col items-center gap-1 w-full min-h-0 flex-1"
        onMouseEnter={() => openNames()}
        onMouseLeave={closeNames}
        onFocus={() => openNames(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) closeNames(); }}
      >
      <button
        type="button"
        aria-pressed={selected === null}
        aria-label={pillAria('All folders', tabs.length)}
        title="All folders"
        className={cn(
          'flex items-center justify-center w-7 h-7 shrink-0 rounded-sm cursor-pointer font-inherit',
          'text-[11px] tabular-nums border transition-colors duration-100',
          selected === null
            ? 'border-border-hover bg-white/8 text-foreground'
            : 'border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5',
        )}
        onClick={() => onSelect(null)}
      >
        {tabs.length}
      </button>

      <div className="flex flex-col items-center gap-1 w-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
        {projects.map((dir, index) => (
          <FolderSquare
            key={dir}
            dir={dir}
            index={index}
            label={pillLabel(dir, projects)}
            count={tabs.filter((t) => t.cwd === dir).length}
            selected={selected === dir}
            dimmed={selected !== null && selected !== dir}
            hot={hot === dir}
            dragRef={dragRef}
            shellOptions={shellOptions}
            onSelect={() => onSelect(selected === dir ? null : dir)}
            onHot={setHot}
            onNewClaudeTab={onNewClaudeTab}
            onNewShellTab={onNewShellTab}
            onOpenDirectory={onOpenDirectory}
            onImportSession={onImportSession}
            onRemoveProject={onRemoveProject}
            onReorderProject={onReorderProject}
          />
        ))}
        {/* Adds a folder — not a session. The two "+"s never compete because
            each sits against the thing it creates: this one against the
            folders, the row above the list against the sessions. */}
        <button
          type="button"
          aria-label="Add folder"
          title="Add folder"
          className="flex items-center justify-center w-7 h-7 shrink-0 rounded-sm border border-dashed border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-border-hover cursor-pointer"
          onClick={onAddProject}
        >
          <Plus size={12} />
        </button>
      </div>

        <FolderNames
          projects={projects}
          tabs={tabs}
          selected={selected}
          hot={hot}
          open={namesOpen}
          onSelect={onSelect}
          onHot={setHot}
          onAddProject={onAddProject}
        />
      </div>

      <div className="w-5 border-t border-border shrink-0" />

      <RailButton icon={TerminalSquare} label="Home" active={showHome} onClick={onGoHome} />
      <RailButton icon={Search} label="Search sessions" onClick={onOpenSearch} />
      <RailButton icon={History} label="Browse past sessions" active={showHistory} onClick={onToggleHistory} />
      <RailButton icon={Folder} label="File explorer" active={showFiles} onClick={onToggleFiles} />
      <RailButton icon={Settings} label="Settings" active={showSettings} onClick={onToggleSettings} />
    </div>
  );
}

/** The row that starts anything: a session in the folder you're looking at,
 *  or — when you're looking at all of them — a session in whichever folder you
 *  pick, plus "Add folder…".
 *
 *  A row rather than an icon, sitting right on top of the list in the list's
 *  own rhythm, because this is the one control in the panel that *creates*
 *  instead of narrowing. It reads its destination out loud ("· api") so
 *  clicking it is never a guess about where the session lands.
 *
 *  This is not the per-folder "New session" row v0.21 removed: that one cost
 *  one row *per open folder*, forever. This is one row for the whole list. */
function NewMenu({ projects, scopedTo, shellOptions, onNewClaudeTab, onNewShellTab, onAddProject }: {
  projects: string[];
  /** The folder new sessions land in without asking, when there's an obvious
   *  one — the selected pill, or the only open folder. */
  scopedTo: string | null;
  shellOptions: ShellOption[];
  onNewClaudeTab: (dir: string) => void;
  onNewShellTab: (dir: string, shellId: string) => void;
  onAddProject: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="New session"
          title={scopedTo ? `New session in ${folderName(scopedTo)}` : 'New session'}
          className={cn(
            'flex items-center gap-1.5 shrink-0 w-[calc(100%-8px)] mx-1 my-0.5 h-[26px] px-2 rounded-sm',
            'border border-dashed border-border bg-transparent cursor-pointer font-inherit',
            'text-[10.5px] text-muted-foreground hover:text-foreground hover:border-border-hover',
          )}
        >
          <Plus size={12} className="shrink-0 text-primary" />
          <span className="shrink-0">New session</span>
          {scopedTo && <span className="min-w-0 truncate text-primary/70">· {folderName(scopedTo)}</span>}
          <ChevronDown size={9} className="ml-auto shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {scopedTo ? (
          <>
            <DropdownMenuItem onClick={() => onNewClaudeTab(scopedTo)}>
              <Sparkles size={13} />
              <span>Claude</span>
            </DropdownMenuItem>
            {shellOptions.map((shell) => (
              <DropdownMenuItem key={shell.id} onClick={() => onNewShellTab(scopedTo, shell.id)}>
                <TerminalSquare size={13} />
                <span>{shell.label}</span>
              </DropdownMenuItem>
            ))}
          </>
        ) : (
          projects.map((dir) => (
            <DropdownMenuSub key={dir}>
              <DropdownMenuSubTrigger>
                <Folder size={13} />
                <span>{folderName(dir)}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => onNewClaudeTab(dir)}>
                  <Sparkles size={13} />
                  <span>Claude</span>
                </DropdownMenuItem>
                {shellOptions.map((shell) => (
                  <DropdownMenuItem key={shell.id} onClick={() => onNewShellTab(dir, shell.id)}>
                    <TerminalSquare size={13} />
                    <span>{shell.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))
        )}
        {projects.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={onAddProject}>
          <FolderPlus size={13} />
          <span>Add folder…</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TabRow({
  tab, isActive, showFolder, hue, lastUsedAt, now,
  onSelectTab, onCloseTab, onRenameTab, onOpenDirectory, onOpenInVscode, onTogglePin,
}: {
  tab: Tab;
  isActive: boolean;
  /** Shows a trailing folder-name chip. On by default in the flat list, since
   *  a row no longer sits under a heading that says where it lives — dropped
   *  only when every visible row is from the same folder anyway. */
  showFolder?: boolean;
  /** The owning folder's accent hue; only read when `showFolder` is set. */
  hue?: number;
  /** When this session's transcript was last written, from `useLastUsed`. */
  lastUsedAt?: number;
  now: number;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRenameTab: (tabId: string, name: string) => void;
  onOpenDirectory: (dir: string) => void;
  onOpenInVscode: (tabId: string) => void;
  onTogglePin: (tabId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== tab.name) onRenameTab(tab.id, trimmed);
    setEditing(false);
  };

  const startRename = () => { setDraft(tab.name); setEditing(true); };

  const rowClass = cn(
    'group relative flex flex-col items-stretch gap-0.5 w-[calc(100%-8px)] mx-1 my-0.5 px-2 py-1.5 rounded-sm',
    'text-[11px] transition-colors duration-100',
    isActive
      ? 'bg-white/8 text-foreground'
      : 'text-muted-foreground hover:text-foreground hover:bg-white/4',
    tab.exited && 'opacity-50',
  );
  const spine = spineClass(tab, isActive);
  const icon = tab.kind === 'claude'
    ? <TabIndicator status={tab.status} dormant={tab.dormant} />
    : tab.kind === 'file'
    ? <File size={12} className="shrink-0" />
    : <TerminalSquare size={12} className="shrink-0" />;

  if (editing) {
    return (
      <div className={cn(rowClass, 'cursor-text')}>
        {spine && <span className={cn('absolute left-0 top-1 bottom-1 w-0.5 rounded-full', spine)} />}
        <div className="flex items-center gap-2 w-full">
          {icon}
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              else if (e.key === 'Escape') { e.preventDefault(); setDraft(tab.name); setEditing(false); }
              e.stopPropagation();
            }}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-[11px] text-foreground font-inherit"
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-session-row
            className={cn(rowClass, 'cursor-pointer')}
            onClick={() => onSelectTab(tab.id)}
            onDoubleClick={startRename}
            title={tab.cwd}
          >
            {spine && <span className={cn('absolute left-0 top-1 bottom-1 w-0.5 rounded-full', spine)} />}
            <div className="flex items-center gap-2 w-full">
              {icon}
              {/* The name gets the whole line. Everything else is below it. */}
              <span data-session-name className="truncate flex-1">{tab.name}</span>
              {tab.exited && <span className="shrink-0">(exited)</span>}
              {tab.pinned && <Pin size={10} className="shrink-0 text-primary" />}
              {tab.kind === 'file' && tab.dirty && (
                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-warning" title="Unsaved changes" />
              )}
              <button
                className={cn(
                  'flex items-center justify-center w-4 h-4 rounded-sm shrink-0 border-none cursor-pointer',
                  'bg-transparent text-muted-foreground/60 hover:text-foreground hover:bg-white/10',
                  'opacity-0 group-hover:opacity-100',
                )}
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                title="Close tab"
              >
                <X size={11} />
              </button>
            </div>
            <RowMeta tab={tab} showFolder={showFolder} hue={hue} lastUsedAt={lastUsedAt} now={now} />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-40">
          <ContextMenuItem onSelect={startRename}>
            <Pencil size={13} />
            <span>Rename</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onOpenDirectory(tab.cwd)}>
            <FolderOpen size={13} />
            <span>Open directory</span>
          </ContextMenuItem>
          {tab.kind === 'claude' && tab.resumeSessionId && (
            <>
              <ContextMenuItem onSelect={() => onOpenInVscode(tab.id)}>
                <Code size={13} />
                <span>Open in VS Code</span>
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => { ipc.exportSession(tab.cwd, tab.resumeSessionId!).catch(() => {}); }}>
                <Upload size={13} />
                <span>Export session…</span>
              </ContextMenuItem>
            </>
          )}
          <ContextMenuItem onSelect={() => onTogglePin(tab.id)}>
            {tab.pinned ? <PinOff size={13} /> : <Pin size={13} />}
            <span>{tab.pinned ? 'Unpin' : 'Pin session'}</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => onCloseTab(tab.id)}>
            <X size={13} />
            <span>Close</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
}

/** How each source is named in the tooltip, strongest first — the order Claude
 *  Code resolves them in, so the top line is the one that wins a clash. */
const ENV_SOURCE_LABELS: [EnvSource, string][] = [
  ['local', '.claude/settings.local.json'],
  ['project', '.claude/settings.json'],
  ['global', '~/.claude/settings.json'],
  ['dotenv', '.env'],
];

/** The folder pill's tooltip: what a session opened here will be handed,
 *  grouped by the file it comes from, plus anything the app refused. Names
 *  only — values never leave the backend (see docs/features/env-loading.md). */
export function envTooltip(dir: string, report: EnvReport): string {
  const lines: string[] = [];
  for (const [source, label] of ENV_SOURCE_LABELS) {
    const names = report.vars.filter((v) => v.source === source).map((v) => v.name);
    if (names.length === 0) continue;
    lines.push(`${label} — ${names.length}`);
    lines.push(`  ${names.join(' ')}`);
  }
  if (report.refused.length > 0) lines.push(`Refused (reserved): ${report.refused.join(' ')}`);
  if (report.unreadable) lines.push(".env is there but couldn't be read");
  lines.push(dir);
  return lines.join('\n');
}

/** The ledger for the icon rail: the same counts stacked vertically, since a
 *  44px column has no room for chips. Read-only — filtering needs a list to
 *  filter, and the rail doesn't have one. */
function CollapsedLedger({ tabs }: { tabs: Tab[] }) {
  const rows = LEDGER.map(({ key, label, icon, icon_ }) => {
    const count = tabs.filter((t) => bucketsOf(t).includes(key)).length;
    return { key, label, icon, icon_, count };
  }).filter((r) => r.count > 0);
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-1 w-full py-1.5 border-b border-border shrink-0">
      {rows.map(({ key, label, icon: Icon, icon_, count }) => (
        <div
          key={key}
          className="flex items-center gap-1 text-[9.5px] tabular-nums text-muted-foreground"
          title={`${count} ${label}`}
        >
          <Icon size={10} className={cn('shrink-0', icon_)} />
          {count}
        </div>
      ))}
    </div>
  );
}

export default function Sidebar({
  tabs, activeTabId, shellOptions, showHistory, showSettings, showHome, showFiles, projects, collapsed,
  onSelectTab, onCloseTab, onOpenDirectory, onOpenInVscode, onNewClaudeTab, onNewShellTab, onRenameTab, onTogglePin,
  onOpenSearch, onToggleHistory, onToggleSettings, onToggleFiles, onGoHome,
  onAddProject, onRemoveProject, onImportSession, onReorderProject, onToggleCollapse,
}: SidebarProps) {
  // Which folder pill, ledger chip and filter text are active. All three are
  // ephemeral on purpose — a filter is a momentary lens on the list, not a
  // workspace setting you'd want restored days later next to a stale count.
  const settings = useSettings();
  const [folder, setFolder] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [query, setQuery] = useState('');

  // Powers every elapsed-time label. A 30s tick is plenty — these are "how
  // long", not a live stopwatch.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // A folder that gets removed while it's the active filter would otherwise
  // leave the list permanently empty with no pill to click your way out of.
  useEffect(() => {
    if (folder !== null && !projects.includes(folder)) setFolder(null);
  }, [folder, projects]);

  const sessions = tabs.filter((t) => t.kind !== 'file');
  const lastUsed = useLastUsed(projects, sessions.length);
  const visible = sessions
    .filter((t) => (folder === null || t.cwd === folder))
    .filter((t) => (bucket === null || bucketsOf(t).includes(bucket)))
    .filter((t) => matchesQuery(t, query))
    .sort((a, b) => {
      const [pinA, seenA] = orderOf(a, lastUsed);
      const [pinB, seenB] = orderOf(b, lastUsed);
      // Stable sort, so sessions with no clock at all keep the order they were
      // opened in rather than shuffling on every render.
      return pinA - pinB || seenB - seenA;
    });

  // What you're looking at, spelled out. All three filters read into one line
  // above the list: picking a folder narrows the list just as hard as a status
  // chip does, and a pill that has scrolled out of its own wrapped row is no
  // answer at all to "which one did I click".
  const lensParts = [
    folder !== null ? folderName(folder) : null,
    bucket !== null ? LEDGER.find((b) => b.key === bucket)!.label : null,
    query.trim() !== '' ? `“${query.trim()}”` : null,
  ].filter((part): part is string => part !== null);
  const filtering = lensParts.length > 0;
  const lens = lensParts.join(' · ');
  const clearFilter = () => { setFolder(null); setBucket(null); setQuery(''); };

  // A row's folder chip earns its space only when the visible rows can
  // actually come from different folders.
  const showFolder = folder === null && projects.length > 1;

  // Compact drops the two bands that narrow the list — search and chips — and
  // keeps a 4px spectrum in their place. Same layout, two components simply
  // not rendered: not a second sidebar to maintain.
  const compact = settings.compactList;

  return (
    <div
      className={cn(
        'flex bg-card border-r border-border shrink-0 overflow-hidden',
        'transition-[width] duration-200 ease-out',
        collapsed ? 'w-11' : 'w-[280px]',
      )}
    >
      {collapsed ? (
        <div data-testid="rail" className="flex flex-col items-center gap-1 w-11 shrink-0 py-1.5">
          {/* Same first square, same 6px from the top, as the expanded rail. */}
          <RailButton icon={PanelLeftOpen} label="Show sidebar" onClick={onToggleCollapse} />
          <div className="w-5 border-t border-border shrink-0" />

          {/* Collapsing narrows the sidebar; it does not hand you a different
              one. The rail reads the same `visible` the expanded list reads —
              filtered by folder, status chip and query, ordered by `sortRank` —
              so folding the panel away no longer silently drops the filter you
              set and reshuffles what's left back into tab-open order. */}
          <CollapsedLedger tabs={visible} />

          <div className="flex-1 overflow-y-auto overflow-x-hidden w-full py-2 flex flex-col items-center gap-1.5 scrollbar-thin">
            {visible.filter((tab) => railWorthy(tab, activeTabId)).map((tab) => {
              const isActive = !showHistory && tab.id === activeTabId;
              const hue = projectHue(Math.max(0, projects.indexOf(tab.cwd)));
              return (
                <button
                  key={tab.id}
                  data-session-square
                  aria-label={`${tab.name}, ${folderName(tab.cwd)}`}
                  className={cn(
                    'relative flex items-center justify-center w-8 h-8 rounded-md border-none cursor-pointer',
                    'transition-colors duration-100',
                    isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                    tab.exited && 'opacity-50',
                  )}
                  // Two glyphs of the same status are otherwise identical here.
                  // The folder's hue is the channel already spent on telling
                  // sessions apart everywhere else, so it does that job here
                  // too — behind the glyph, which keeps saying the status.
                  style={{ backgroundColor: `hsl(${hue} 55% 50% / ${isActive ? 0.32 : 0.12})` }}
                  onClick={() => onSelectTab(tab.id)}
                  title={`${tab.name} · ${folderName(tab.cwd)}`}
                >
                  {isActive && <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />}
                  {tab.kind === 'claude'
                    ? <TabIndicator status={tab.status} dormant={tab.dormant} size={14} />
                    : <TerminalSquare size={14} className="shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* The collapsed rail keeps its own copy of the navigation: there is
              no expanded rail beside it to borrow one from. Same squares in the
              same order, so nothing shifts under the cursor when the sidebar
              folds. */}
          <div className="w-5 border-t border-border shrink-0" />

          <RailButton icon={TerminalSquare} label="Home" active={showHome} onClick={onGoHome} />
          <RailButton icon={Search} label="Search sessions" onClick={onOpenSearch} />
          <RailButton icon={History} label="Browse past sessions" active={showHistory} onClick={onToggleHistory} />
          <RailButton icon={Folder} label="File explorer" active={showFiles} onClick={onToggleFiles} />
          <RailButton icon={FolderPlus} label="Add folder" onClick={onAddProject} />
          <RailButton icon={Settings} label="Settings" active={showSettings} onClick={onToggleSettings} />
        </div>
      ) : (
        <>
          {/* Everything that isn't about *this list* — which folder to look at,
              where to navigate — lives in the rail, so the column beside it
              holds only bands that narrow the list, the list, and usage. */}
          <SidebarRail
            projects={projects}
            tabs={sessions}
            selected={folder}
            shellOptions={shellOptions}
            showHome={showHome}
            showHistory={showHistory}
            showFiles={showFiles}
            showSettings={showSettings}
            onSelect={setFolder}
            onNewClaudeTab={onNewClaudeTab}
            onNewShellTab={onNewShellTab}
            onOpenDirectory={onOpenDirectory}
            onImportSession={onImportSession}
            onRemoveProject={onRemoveProject}
            onReorderProject={onReorderProject}
            onAddProject={onAddProject}
            onGoHome={onGoHome}
            onOpenSearch={onOpenSearch}
            onToggleHistory={onToggleHistory}
            onToggleFiles={onToggleFiles}
            onToggleSettings={onToggleSettings}
            onToggleCollapse={onToggleCollapse}
          />

          <div className="flex flex-col flex-1 min-w-0">
            {compact ? (
              <Spectrum tabs={sessions} />
            ) : (
              <>
                <SidebarSearch query={query} onQuery={setQuery} />
                <LedgerStrip tabs={sessions} bucket={bucket} onBucket={setBucket} />
              </>
            )}

            {projects.length === 0 ? (
              <div className="flex-1 flex flex-col items-center gap-2 text-center px-4 py-8">
                <Folder size={18} className="text-[#33363f]" />
                <div className="text-[11px] text-muted-foreground">No folders open</div>
                <button
                  className="px-2.5 py-1 rounded-sm border border-border text-[10.5px] text-primary hover:border-border-hover bg-transparent cursor-pointer font-inherit"
                  onClick={onAddProject}
                >
                  Select folder…
                </button>
              </div>
            ) : (
              <>
                <NewMenu
                  projects={projects}
                  scopedTo={folder ?? (projects.length === 1 ? projects[0] : null)}
                  shellOptions={shellOptions}
                  onNewClaudeTab={onNewClaudeTab}
                  onNewShellTab={onNewShellTab}
                  onAddProject={onAddProject}
                />

                {visible.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center gap-2 text-center px-4 py-8">
                    <div className="text-[11px] text-muted-foreground">
                      {filtering ? <>No sessions match {lens}.</> : 'No sessions here yet'}
                    </div>
                    {filtering && (
                      <button
                        className="px-2.5 py-1 rounded-sm border border-border text-[10.5px] text-primary hover:border-border-hover bg-transparent cursor-pointer font-inherit"
                        onClick={clearFilter}
                      >
                        Show all sessions
                      </button>
                    )}
                  </div>
                ) : (
                  <div data-testid="session-list" className="flex-1 overflow-y-auto overflow-x-hidden py-1 scrollbar-thin">
                    {filtering && (
                      <div data-testid="lens" className="px-3 pt-1 pb-1 text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/70">
                        {lens} · {visible.length}
                      </div>
                    )}
                    {visible.map((tab) => (
                      <TabRow
                        key={tab.id}
                        tab={tab}
                        isActive={!showHistory && tab.id === activeTabId}
                        showFolder={showFolder}
                        hue={projectHue(Math.max(0, projects.indexOf(tab.cwd)))}
                        lastUsedAt={tab.resumeSessionId ? lastUsed.get(tab.resumeSessionId) : undefined}
                        now={now}
                        onSelectTab={onSelectTab}
                        onCloseTab={onCloseTab}
                        onRenameTab={onRenameTab}
                        onOpenDirectory={onOpenDirectory}
                        onOpenInVscode={onOpenInVscode}
                        onTogglePin={onTogglePin}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            <SidebarFooter />
          </div>
        </>
      )}
    </div>
  );
}
