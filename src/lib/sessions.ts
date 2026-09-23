/**
 * What a session *is*, as far as the UI is concerned: how it's filed, what
 * state it's in, and what order a list of them goes in.
 *
 * All of this used to live inside Sidebar.tsx alongside the markup. It's here
 * because three surfaces now need the same answers — the sidebar, the command
 * palette and the session header — and a status that reads one way in the list
 * and another way in the header is exactly the noise the redesign removes.
 * See docs/design.md, Status vocabulary.
 */
import type { Tab, SavedTab } from '@/types';

/** Placeholder every fresh Claude session starts with, until the auto-namer or
 *  the user gives it a real one. Not a name, so it never becomes a session's. */
export const UNNAMED_SESSION = 'Claude';

/** A session's live state, in the four words the UI actually distinguishes.
 *
 *  Deliberately fewer than `TabStatus`: the hooks report four Claude states
 *  and the app adds dormant/exited on top, but a list only has to answer "is
 *  this working, does it want me, or is it quiet". Collapsing them here is
 *  what stops the same session carrying three different colors in three
 *  different places.
 *
 *  - `running`   — Claude is working (green, and the only thing that moves)
 *  - `attention` — it's asking you something (yellow, a ring so it reads at a
 *                  glance in a list where most rows are quiet)
 *  - `idle`      — alive, nothing happening (a dim filled dot)
 *  - `asleep`    — restored or auto-slept; no process, resumes on click (hollow)
 *  - `muted`     — exited or archived (barely there)
 *
 *  Five, not four: a restored session and a dead one are different facts, and a
 *  workspace reopened with twenty sessions is *entirely* the first kind — which
 *  is how the first cut ended up showing twenty identical grey dots and no
 *  status at all.
 */
export type SessionState = 'running' | 'attention' | 'idle' | 'asleep' | 'muted';

export function sessionState(tab: Tab): SessionState {
  if (tab.exited || tab.archived) return 'muted';
  // A dormant session has no process behind it, so whatever status it last
  // reported is history — claiming it's "running" would be a lie the row's
  // own behaviour (nothing happens) immediately contradicts. It is still a
  // *session* though, so it reads as asleep rather than as nothing at all.
  if (tab.dormant) return 'asleep';
  if (tab.kind !== 'claude') return 'idle';
  switch (tab.status) {
    case 'working': return 'running';
    case 'requires_response': return 'attention';
    case 'idle': return 'idle';
    // A session that has started but not yet reported in. Not "asleep" — its
    // process is coming up — and not idle either.
    case 'new': return 'idle';
  }
}

/** How each state is drawn. One place, so the sidebar, the palette and the
 *  session header cannot drift apart.
 *
 *  Shape carries as much of the meaning as colour: filled vs. hollow separates
 *  "there is a process here" from "there isn't" without a second hue, and the
 *  ring on `attention` survives the 10% of readers who can't tell the green
 *  from the amber. Only `running` animates — one moving thing in a list is a
 *  signal, twenty is wallpaper. */
export const STATE_DOT: Record<SessionState, string> = {
  // Traffic-light semantics, and the mapping docs/design.md always described:
  // green is a session that is alive and has nothing to do, amber is one that
  // is busy, red-amber is one that has stopped to ask you something. Reading
  // it as a signal rather than a temperature is the point — you scan the list
  // for the colour that means "your turn", and that colour is the warmest.
  //
  // `attention` is its own token (warning mixed halfway to destructive), not
  // `warning` again: "working" and "asking" are the two states most likely to
  // be confused at a glance, so they get different hues as well as different
  // marks.
  idle: 'bg-success',
  running: 'bg-warning animate-pulse',
  attention: 'bg-attention ring-2 ring-attention/30',
  // A session with no live process behind it gets no colour at all — colour
  // here means "a process is doing something", and a hollow ring says there
  // is nothing to report. Drawn off `muted-foreground` rather than `border`:
  // border tokens sit a hair above the background by design, so a *dot* made
  // of one is invisible rather than quiet (asleep 2.4:1, closed 1.8:1).
  asleep: 'border border-muted-foreground/60 bg-transparent',
  muted: 'border border-muted-foreground/45 bg-transparent',
};

export const STATE_LABEL: Record<SessionState, string> = {
  running: 'running',
  attention: 'needs you',
  idle: 'idle',
  asleep: 'asleep — click to resume',
  muted: 'closed',
};

/** Sessions, as opposed to the file tabs that share the same array. */
export function isSession(tab: Tab): boolean {
  return tab.kind !== 'file';
}

/** In the Inbox: a session filed under no project. Not a fake project — the
 *  Inbox is the absence of one, which is why this is a null check and not a
 *  comparison against some reserved directory. */
export function isInbox(tab: Tab): boolean {
  return tab.projectDir === null;
}

/** How recently a session was touched, as epoch ms — the list's sort key.
 *
 *  Three clocks, whichever is freshest: when you opened it in this run, its
 *  last status change, and the mtime of its transcript for one restored from a
 *  previous run. A session you just started has only the first, one working
 *  right now keeps bumping the second, and one that has sat untouched for a
 *  week has only the third. */
export function recencyOf(tab: Tab, lastUsedAt?: number): number {
  return Math.max(tab.createdAt ?? 0, tab.statusChangedAt ?? 0, lastUsedAt ?? 0);
}

/** Newest first, with anything pinned held above it. Pinning is the one
 *  explicitly manual thing in a list that otherwise orders itself, and a pin
 *  that scrolled away with age would mean nothing. */
export function bySessionOrder(lastUsed: Map<string, number>) {
  const key = (tab: Tab): [number, number] => [
    tab.pinned ? 0 : 1,
    recencyOf(tab, tab.resumeSessionId ? lastUsed.get(tab.resumeSessionId) : undefined),
  ];
  return (a: Tab, b: Tab): number => {
    const [pinA, seenA] = key(a);
    const [pinB, seenB] = key(b);
    return pinA - pinB || seenB - seenA;
  };
}

/** Matches the sidebar's own filter field — name, project folder, or working
 *  directory. Substring, not fuzzy: this narrows a list you're looking at,
 *  where a fuzzy match that pulls in three unrelated rows reads as a bug. The
 *  command palette is the fuzzy one. */
export function matchesQuery(tab: Tab, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return `${tab.name} ${tab.projectDir ?? 'inbox'} ${tab.cwd}`.toLowerCase().includes(q);
}

/** Rebuilds a session from the workspace file.
 *
 *  `projectDir` is taken at face value: the backend migrates older files before
 *  they get here (`workspace::migrate`), so a null genuinely means the Inbox.
 *  Deriving it here as well was the bug — serde fills a missing
 *  `Option<String>` with `None` and hands over `null`, which is indistinguishable
 *  from an explicit Inbox once it has crossed the IPC boundary. Only the side
 *  that can see the raw file can tell those apart, so only that side decides.
 *
 *  An id is still minted when one is missing — harmless, and it's the frontend
 *  that owns id generation.
 *
 *  Restored sessions come back **dormant**: no pty until one is actually
 *  shown, so reopening with twenty sessions doesn't launch twenty processes.
 */
export function restoreTab(saved: SavedTab): Tab {
  return {
    id: saved.id || crypto.randomUUID(),
    kind: saved.kind,
    name: saved.name,
    shellId: saved.shellId,
    cwd: saved.cwd,
    projectDir: saved.projectDir ?? null,
    archived: saved.archived,
    resumeSessionId: saved.resumeSessionId,
    exited: false,
    status: 'new',
    dormant: true,
    pinned: saved.pinned,
  };
}

/** The inverse. File tabs aren't persisted — they belong to a session's Files
 *  tool, which reopens from the tree rather than being restored. */
export function toSavedTab(tab: Tab): SavedTab {
  return {
    id: tab.id,
    kind: tab.kind,
    name: tab.name,
    shellId: tab.shellId,
    resumeSessionId: tab.resumeSessionId,
    cwd: tab.cwd,
    projectDir: tab.projectDir,
    archived: tab.archived,
    pinned: tab.pinned,
  };
}

/** The pty id of a session's shell tool.
 *
 *  A session's shell is not a session — it has no row, no status, no history,
 *  and nothing to restore. Deriving its pty id from the session's own means
 *  there is no second record to keep in sync, and killing the session kills a
 *  shell that can be named without looking anything up. */
export function shellPtyId(sessionId: string): string {
  return `${sessionId}::shell`;
}

/** Folds the names currently on sessions into the persisted session-id → name
 *  map. Kept separate from the session list because it has to outlive the
 *  session: History and a later resume both read it long after it's closed.
 *  Returns `prev` unchanged when nothing is new. */
export function learnSessionNames(
  prev: Record<string, string>,
  tabs: Tab[],
): Record<string, string> {
  let next = prev;
  for (const tab of tabs) {
    const id = tab.resumeSessionId;
    if (tab.kind !== 'claude' || !id || tab.name === UNNAMED_SESSION) continue;
    if (prev[id] === tab.name) continue;
    if (next === prev) next = { ...prev };
    next[id] = tab.name;
  }
  return next;
}

/** "2m", "27m", "2h", "3d" — the age column in the session list.
 *
 *  No "ago": the column header is implicit and the word costs a third of the
 *  width in a 40px gutter. Empty for anything with no clock at all, so a row
 *  never shows a confident "0m" it can't back up. */
export function compactAge(at: number | undefined, now: number): string {
  if (!at) return '';
  const seconds = Math.max(0, (now - at) / 1000);
  if (seconds < 60) return 'now';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}
