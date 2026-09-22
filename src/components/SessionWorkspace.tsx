import { useEffect, useMemo, useRef, useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import { shellPtyId } from '@/lib/sessions';
import { transcriptToMarkdown } from '@/lib/transcript';
import { useDragValue } from '@/lib/use-drag-value';
import { useTranscript } from '@/lib/use-transcript';
import { cn, hasSelectionIn } from '@/lib/utils';
import type { SessionMode, SessionTool, Tab } from '@/types';
import FileExplorerPanel from './FileExplorerPanel';
import FileViewer from './FileViewer';
import MarkdownPane from './MarkdownPane';
import Seam from './Seam';
import { type MarkdownView, type SplitDirection } from './SessionControls';
import Terminal from './Terminal';

/** How often an on-screen transcript re-reads while its session is live, so
 *  new turns show up as Claude answers. */
const LIVE_FOLLOW_MS = 1200;

export interface SessionWorkspaceProps {
  session: Tab;
  tool: SessionTool;
  /** The session is on screen and should hold a live pty. False while an
   *  overlay (Settings, the archive browser, To-Do) covers it. */
  active: boolean;
  /** This pane has the keyboard. With four terminals on screen, knowing which
   *  one takes your next keystroke matters more than anything else the chrome
   *  could say — so an unfocused pane dims and gives up the accent rule. */
  paneFocused?: boolean;
  /** Per-session terminal/markdown/split, owned by App so it survives a
   *  switch away and back. */
  mode: SessionMode;
  splitDirection: SplitDirection;
  mdView: MarkdownView;
  onSetMdView: (view: MarkdownView) => void;
  showMarkdownToggle: boolean;
  onInterrupt: () => void;
  /** Spawns this session's shell pty on first use of the Shell tool. */
  onNeedShell: () => void;
}

/** Claude / Shell / Files, and nothing else. These are the session's *tools*,
 *  not a list of sessions — the distinction the whole layout turns on. A shell
 *  session has no Claude tool; there's no process to show.
 *
 *  A pane shows exactly one of them. There is no strip to switch between them
 *  in place: switching in place and arranging on the grid were two answers to
 *  the same question, and the grid is the one you can lay out. */
function toolsFor(session: Tab): SessionTool[] {
  return session.kind === 'claude' ? ['claude', 'shell', 'files'] : ['shell', 'files'];
}

/** One of a session's tools, filling a pane.
 *
 *  Deliberately chrome-less: no header, no strip of its own. The pane's tab
 *  says which session and which tool this is, and the pane's controls sit at
 *  the strip's trailing edge — so a four-pane grid spends one 32px row per
 *  pane on chrome instead of three.
 *  See docs/features/session-workspace.md. */
export default function SessionWorkspace({
  session, tool, active, paneFocused = true, mode, splitDirection,
  mdView, onSetMdView, showMarkdownToggle, onInterrupt, onNeedShell,
}: SessionWorkspaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(0.5);
  const [mdReload, setMdReload] = useState(0);
  /** The file the Files tool currently has open, as a synthetic file tab —
   *  `FileViewer` wants a `Tab`, and this is the one place a file is ever one.
   *  Local to the workspace on purpose: an open file is a view of a session,
   *  not a session, so it neither persists nor appears anywhere in the list. */
  const [openFile, setOpenFile] = useState<Tab | null>(null);
  const [filesTreeWidth, setFilesTreeWidth] = useState(240);
  /** Which session we've already asked for a shell for. Keyed by session, not
   *  a bare boolean: this component is reused across session switches, and a
   *  boolean would leave every session after the first without a shell. */
  const shellStarted = useRef<string | null>(null);

  const tools = toolsFor(session);
  // A shell session has no Claude tool; landing on one would show an empty box.
  const current = tools.includes(tool) ? tool : tools[0];

  const canRead = showMarkdownToggle && session.kind === 'claude' && !!session.resumeSessionId;
  const effectiveMode: SessionMode = canRead ? mode : 'terminal';
  const mdReading = effectiveMode === 'markdown' || effectiveMode === 'split';
  const mdFull = effectiveMode === 'markdown';
  const splitActive = effectiveMode === 'split';
  const onClaude = current === 'claude';

  useEffect(() => {
    if (current !== 'shell' || shellStarted.current === session.id) return;
    shellStarted.current = session.id;
    onNeedShell();
  }, [current, session.id, onNeedShell]);

  const [draggingSeam, startSeam] = useDragValue(
    (e) => {
      const row = rowRef.current;
      if (!row) return null;
      const r = row.getBoundingClientRect();
      return splitDirection === 'right'
        ? (e.clientX - r.left) / r.width
        : (e.clientY - r.top) / r.height;
    },
    (v) => setRatio(Math.min(0.75, Math.max(0.25, v))),
  );

  const [draggingTree, startTreeSeam] = useDragValue(
    (e) => {
      const row = rowRef.current;
      if (!row) return null;
      return e.clientX - row.getBoundingClientRect().left;
    },
    (w) => setFilesTreeWidth(Math.min(460, Math.max(180, w))),
  );

  const reading = onClaude && mdReading && active;
  const { turns, error } = useTranscript(
    reading ? session.cwd : null,
    reading ? session.resumeSessionId : null,
    mdReload,
  );
  const fullMarkdown = useMemo(() => (turns ? transcriptToMarkdown(turns) : ''), [turns]);

  // Live-follow: while a transcript is on screen, re-read it on a steady tick
  // so new turns appear as Claude answers — including plain-text replies,
  // which never flip the session to `working`.
  useEffect(() => {
    if (!reading || session.exited) return;
    const timer = setInterval(() => {
      // Never re-read out from under someone who is selecting text: WebKit
      // drops the selection the moment the nodes under it are replaced.
      if (hasSelectionIn(rootRef.current)) return;
      setMdReload((k) => k + 1);
    }, LIVE_FOLLOW_MS);
    return () => clearInterval(timer);
  }, [reading, session.id, session.exited]);

  // A file left open in the Files tool belongs to the session it was opened
  // from; switching sessions must not carry it across.
  useEffect(() => { setOpenFile(null); }, [session.id]);

  const shellId = shellPtyId(session.id);
  // A pane only takes keystrokes when it has focus; without this every pane
  // calls `term.focus()` on attach and the last one to render steals them.
  const live = active && paneFocused;

  const openFileAt = (dir: string, path: string) => {
    setOpenFile({
      id: `${session.id}::file`,
      kind: 'file',
      name: path.split(/[/\\]/).pop() || path,
      shellId: null,
      cwd: dir,
      projectDir: session.projectDir,
      resumeSessionId: null,
      exited: false,
      status: 'new',
      path,
    });
  };

  return (
    <div ref={rootRef} className="relative flex flex-col flex-1 min-w-0 min-h-0 bg-background">
      {/* One pane renders ONE tool. It used to render all three and hide two,
          which was cheaper on tool switches but made "Claude here, its shell
          next door" impossible: both panes would mount a <Terminal> for the
          same pty and one of them would paint nothing. The buffer survives the
          switch anyway — an xterm instance lives in `terminalCache`, outside
          React, and is re-attached on the way back. */}
      <div ref={rowRef} className="relative flex-1 min-h-0">
        {onClaude && (
        <div
          className={cn(
            'absolute inset-0 flex',
            splitActive && splitDirection === 'down' && 'flex-col',
          )}
        >
          <div
            className={cn('relative flex flex-col min-w-0', mdFull ? 'hidden' : splitActive ? 'shrink-0' : 'flex-1')}
            style={splitActive
              ? (splitDirection === 'right' ? { width: `${ratio * 100}%` } : { height: `${ratio * 100}%` })
              : undefined}
          >
            {splitActive && (
              <div className="flex items-center gap-1.5 h-7 px-3 shrink-0 border-b border-border bg-card">
                <SquareTerminal size={11} className="text-muted-foreground shrink-0" />
                <span className="text-[10px] tracking-[0.12em] uppercase text-muted-foreground">Terminal</span>
              </div>
            )}
            <div className="relative flex-1 min-h-0">
              {session.kind === 'claude' && (
                <Terminal
                  tabId={session.id}
                  isVisible={active && onClaude && !mdFull}
                  focused={live && onClaude}
                  onInterrupt={onInterrupt}
                />
              )}
            </div>
          </div>

          {splitActive && (
            <Seam
              orientation={splitDirection === 'right' ? 'vertical' : 'horizontal'}
              dragging={draggingSeam}
              onStart={startSeam}
              shadow
              className="relative shrink-0"
            />
          )}

          {mdReading && (
            <MarkdownPane
              turns={turns}
              error={error}
              view={mdView}
              onSetView={onSetMdView}
              onRefresh={() => setMdReload((k) => k + 1)}
              turnsCount={turns ? turns.length : null}
              markdownText={fullMarkdown}
              label={splitActive ? 'Transcript' : undefined}
              fill={splitActive}
              className={splitActive ? 'flex-1 bg-card' : 'flex-1'}
            />
          )}
          {draggingSeam && (
            <div className={cn('fixed inset-0 z-50', splitDirection === 'right' ? 'cursor-col-resize' : 'cursor-row-resize')} />
          )}
        </div>
        )}

        {/* Shell — a second pty in the same directory. Spawned on first visit,
            then kept, so switching back lands on the same scrollback. */}
        {current === 'shell' && (
        <div className="absolute inset-0">
          {/* A shell-kind session *is* its shell; a Claude session gets a
              derived one. Either way, one terminal. */}
          <Terminal
            tabId={session.kind === 'shell' ? session.id : shellId}
            isVisible={active}
            focused={live}
          />
        </div>
        )}

        {/* Files — the session's own directory, tree beside editor. Scoped to
            this session's cwd, not to every open project: the explorer is part
            of the session now, not a panel docked to the window. */}
        {current === 'files' && (
        <div className="absolute inset-0 flex">
          <div style={{ width: filesTreeWidth }} className="shrink-0 min-w-0 border-r border-border">
            <FileExplorerPanel
              projects={[session.cwd]}
              activePath={openFile?.path ?? null}
              onOpenFile={openFileAt}
            />
          </div>
          <Seam
            orientation="vertical"
            dragging={draggingTree}
            onStart={startTreeSeam}
            className="relative shrink-0"
          />
          <div className="relative flex-1 min-w-0">
            {openFile ? (
              <FileViewer
                key={openFile.path}
                tab={openFile}
                isVisible={active}
                onDirtyChange={() => {}}
                onOpenFile={openFileAt}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
                Pick a file to read or edit.
              </div>
            )}
          </div>
          {draggingTree && <div className="fixed inset-0 z-50 cursor-col-resize" />}
        </div>
        )}
      </div>
    </div>
  );
}
