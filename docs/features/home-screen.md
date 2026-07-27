# Home screen

What fills the terminal pane when no tab is open. Instead of a line of grey text,
the pane draws a night skyline built from your own session history: **each open
folder is a tower, each past Claude session is a lit window**, newest on the top
floor. Point at a window and the bar below shows the prompt that started that
session; click it and the session resumes.

So the empty state isn't a placeholder — it's the session picker, laid out in
space instead of a list, and it grows a floor every time you work.

## What draws what

| In the scene | Comes from | Reads as |
| --- | --- | --- |
| Tower | an entry in `projects` | one folder |
| Tower height | session count + 2 dark floors | how much work lives here |
| Window | a `SessionHistoryEntry` | one resumable session |
| Window brightness | elapsed time since `lastUsedIso` | how warm the session still is |
| Window colour | `projectHue(index)` — the folder's sidebar accent | which folder you're looking at |
| Top lit floor | most recent session | where you left off |
| Beacon | the leftmost tower | the folder you worked in last |
| Name plate | folder name + session count | a button that starts a fresh session there |
| Tower order | running folders first, then last activity | where things are happening |
| Steady bright window + ring | a session open right now | this one is already running |
| Amber breathing window | tab status `working` | Claude is busy here |
| Orange blinking window | tab status `requires_response` | this one is blocked on you |

Towers with a running session sort first; the rest fall back to their newest
session's `lastUsedIso`, so the folder you touched last is leftmost and carries
the beacon.

Live state comes from the open tabs, not from disk: a Claude tab that hasn't
exited is matched to its window by `resumeSessionId`. Clicking a live window
selects that tab instead of resuming a second copy of the session. A session
started moments ago has no history entry yet — no resolved id, or its transcript
wasn't on disk when Home read it — so it gets a window of its own above the
recorded ones, labelled with the tab name. Working and waiting borrow the
sidebar's own `--warning` and `--attention` colours and are told apart by rhythm:
a slow breath versus a sharp double-blink.

## How far back it goes

There is no time cutoff, and adding one would be the wrong lever: the backend
already caps `list_sessions` at 50 entries per folder, which is what actually
bounds both the read and the tower height. A "last 30 days" filter would cut
nothing until a folder exceeds 50 sessions inside the window, and at that point
the cap has already done the job.

Age is expressed in **brightness instead of deletion**. `warmth()` maps elapsed
time to 1 (minutes ago) → 0 (cold), log-scaled over `COLD_AFTER_DAYS` = 60 so the
first week carries most of the range, and drives both the window's alpha
(0.95 → 0.35) and its lightness (72% → 58%). Rank in the list would have been
wrong here: it would light the newest session of a folder abandoned in March
exactly as brightly as one from this morning. A dormant folder now reads as a
genuinely dark tower, which is the thing a cutoff was reaching for.

## Typography

Two faces, split by who is speaking. Mono (the app's own stack) for everything
the *system* says — labels, counts, folder names. A serif (`Iowan Old
Style`/`Palatino`/`Georgia`) for everything *you* wrote: session previews and the
prose lines. Reading a preview in a different face is the cue that those are your
own words coming back.

## Getting there

**Every launch opens on Home**, restored workspace or not — you land on the city
and pick where to go, instead of on whichever tab happened to be active last.
Restored tabs stay dormant while Home is up, so nothing spawns a process until
you actually open it.

Home is also implicit whenever no tab is open. To reach it with sessions running,
click the **Too Many Terminals** wordmark at the top of the sidebar — it toggles,
so clicking it again drops you back on the active tab. In the collapsed rail the
same thing lives as the app's own terminal-square icon above History.

Anything that puts you into a session — opening a tab, resuming from a window,
picking a tab in the sidebar or the command palette — leaves Home automatically.

## States

- **No folders open** — a dashed empty lot and "Open a folder to start your first
  session", with the Open folder action.
- **Folders open, no sessions yet** — towers stand as dark outlines with a `0`
  plate; clicking a plate starts the first session there.
- **History present** — the full skyline.

The bottom bar always carries the three actions: **New session** (in the most
recent folder), **Open folder**, **All sessions** (opens the history panel).

## Motion

One orchestrated moment on mount, then near-silence:

1. Towers rise from the horizon, staggered 95 ms apart (`home-rise`).
2. Windows light one by one, 26 ms apart within a tower (`home-lit`).
3. After that: the beacon pulses, live windows breathe or blink, and one random
   *past* window flickers every 4.2 s — live windows are excluded so their state
   animation is never interrupted.

Delays are CSS `animation-delay` values computed at render, not timers — the only
JS interval is the flicker, and it returns early when `document.hidden` or the
window isn't focused, so a Home screen left open in the background does no work.
`prefers-reduced-motion` disables all four animations.

## Cost

The scene is ~30 DOM nodes per folder and nothing recomputes after mount. The
real cost is the one `listSessions` call per open folder on mount — the same read
the history panel already does, and `read_preview` stops scanning each session
file at the first real user message, so it is tens of milliseconds for a typical
workspace.

Sessions load once per `projects` change. Windows are real `<button>`s, so hover,
focus rings and screen-reader labels come free; arrow keys walk the floors of the
focused tower while Tab moves between towers (roving `tabIndex`).

## Deliberately left out

- **Shell tabs.** Only Claude sessions get windows; a shell has no session to
  resume and no status to show.
- **Live-updating history.** Sessions load once when Home opens. Since Home
  unmounts the moment you enter a session, every visit already reads fresh — but
  a session finishing *while you watch* won't add a window until you leave and
  come back. Live status does update, because it comes from the tab state.
- **Greeting copy and stat tiles.** The rail carries the two counts that matter.
- **Canvas rendering.** DOM buttons keep the whole thing accessible for free.

## Files

- `src/components/HomeScreen.tsx` — the component.
- `src/components/HomeScreen.test.tsx` — window-per-session, tower ordering,
  resume/new-session wiring, hover preview, empty states, arrow-key focus.
- `src/globals.css` — `.home-*` scene styles and the four keyframes.
- `src/App.tsx` — `showHome` state; renders Home when `showHome || state.tabs.length === 0`
  and no overlay is up.
- `src/components/Sidebar.tsx` — the wordmark/rail button (`onGoHome`, `showHome`).
