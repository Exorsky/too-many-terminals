import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { SquareTerminal } from 'lucide-react';
import FileViewer from './FileViewer';
import MarkdownPane from './MarkdownPane';
import Seam from './Seam';
import SessionControls, { type MarkdownView, type SessionMode, type SplitDirection } from './SessionControls';
import TabBar from './TabBar';
import Terminal from './Terminal';
import { tabBarTabs } from '@/lib/tabs';
import { transcriptToMarkdown } from '@/lib/transcript';
import { useDragValue } from '@/lib/use-drag-value';
import { useTranscript } from '@/lib/use-transcript';
import { cn } from '@/lib/utils';
import type { Edge, Pane } from '@/lib/panes';
import type { Tab } from '@/types';

// How often an on-screen transcript re-reads while its session is live, so new
// turns show up as Claude answers.
const LIVE_FOLLOW_MS = 1200;

interface PaneViewProps {
  pane: Pane;
  /** Every tab in the app; the pane picks its own out by id. */
  tabs: Tab[];
  focused: boolean;
  /** Tabs on screen anywhere — one per pane. */
  visible: Set<string>;
  showMarkdownToggle: boolean;
  mdTabs: Map<string, SessionMode>;
  splitDirection: SplitDirection;
  mdView: MarkdownView;
  onSetMdView: (view: MarkdownView) => void;
  onSetMode: (tabId: string, mode: SessionMode) => void;
  onSetSplitDirection: (direction: SplitDirection) => void;
  onSelectTab: (tabId: string) => void;
  onCloseBarTab: (tabId: string) => void;
  onReorderTab: (tabId: string, targetId: string, position: 'before' | 'after') => void;
  onFocus: () => void;
  onInterrupt: (tabId: string) => void;
  onDirtyChange: (tabId: string, dirty: boolean) => void;
  onOpenFile: (dir: string, path: string) => void;
  onSplitTab: (tabId: string, edge: Edge) => void;
  /** Which ways this pane still has room to split. */
  canSplit: { vertical: boolean; horizontal: boolean };
  /** Grid placement, from `paneRect`. */
  style?: CSSProperties;
}

/** One pane of the grid: its own tab strip, its own terminals, and — when its
 *  active tab is being read — its own transcript.
 *
 *  Extracted from App.tsx when the single content area became a grid. Owning the
 *  transcript per pane rather than app-wide is what lets two sessions be read at
 *  once, and it means a transcript live-follows whenever *its* tab is working,
 *  not only when that tab happens to be the focused one. */
export default function PaneView({
  pane, tabs, focused, visible, showMarkdownToggle, mdTabs, splitDirection,
  mdView, onSetMdView, onSetMode, onSetSplitDirection, onSelectTab, onCloseBarTab,
  onReorderTab, onFocus, onInterrupt, onDirtyChange, onOpenFile, onSplitTab, canSplit, style,
}: PaneViewProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  // The terminal|transcript seam is this pane's own, unlike the grid seams.
  const [ratio, setRatio] = useState(0.5);
  const [mdReload, setMdReload] = useState(0);

  const paneTabs = useMemo(() => tabBarTabs(tabs, pane.tabIds), [tabs, pane.tabIds]);
  const activeTab = paneTabs.find((t) => t.id === pane.activeTabId) ?? null;

  const readable = !!activeTab && activeTab.kind === 'claude' && !!activeTab.resumeSessionId;
  const fileUp = activeTab?.kind === 'file';
  const canRead = showMarkdownToggle && readable && !fileUp;
  const mode: SessionMode = (canRead && activeTab && mdTabs.get(activeTab.id)) || 'terminal';
  const mdReading = mode === 'markdown' || mode === 'split';
  const mdFull = mode === 'markdown';
  const splitActive = mode === 'split';

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

  const { turns, error } = useTranscript(
    mdReading && activeTab ? activeTab.cwd : null,
    mdReading && activeTab ? activeTab.resumeSessionId : null,
    mdReload,
  );
  const fullMarkdown = useMemo(() => (turns ? transcriptToMarkdown(turns) : ''), [turns]);

  // Live-follow: while this pane's transcript is on screen, re-read it on a
  // steady tick so new turns appear as Claude answers — including plain-text
  // replies, which never flip the tab to `working`. Per pane, so two transcripts
  // can follow at once; `useTranscript` skips identical content, so a quiet
  // session costs a read and no re-render.
  useEffect(() => {
    if (!mdReading || !activeTab || activeTab.exited) return;
    const timer = setInterval(() => setMdReload((k) => k + 1), LIVE_FOLLOW_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mdReading, activeTab?.id, activeTab?.exited]);

  return (
    <div
      style={style}
      className="relative flex flex-col min-w-0 min-h-0 overflow-hidden border-r border-b border-border"
      onMouseDownCapture={onFocus}
      data-pane={pane.id}
    >
      <TabBar
        tabs={paneTabs}
        activeTabId={pane.activeTabId}
        paneFocused={focused}
        onSplitTab={onSplitTab}
        canSplit={canSplit}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseBarTab}
        onReorderTab={onReorderTab}
        trailing={canRead && activeTab ? (
          <SessionControls
            mode={mode}
            splitDirection={splitDirection}
            onSetMode={(m) => onSetMode(activeTab.id, m)}
            onSetSplitDirection={onSetSplitDirection}
          />
        ) : undefined}
      />

      <div className="relative flex-1 min-h-0">
        <div ref={rowRef} className={cn('absolute inset-0 flex', splitActive && splitDirection === 'down' && 'flex-col')}>
          <div
            className={cn('relative flex flex-col min-w-0', mdFull ? 'hidden' : splitActive ? 'shrink-0' : 'flex-1')}
            style={splitActive
              ? (splitDirection === 'right' ? { width: `${ratio * 100}%` } : { height: `${ratio * 100}%` })
              : undefined}
          >
            {splitActive && (
              <div className="flex items-center gap-1.5 h-7 px-3 shrink-0 border-b border-border bg-card">
                <SquareTerminal size={11} className="text-muted-foreground shrink-0" />
                <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground">Terminal</span>
              </div>
            )}
            <div className="relative flex-1 min-h-0">
              {paneTabs.filter((tab) => tab.kind !== 'file').map((tab) => (
                <Terminal
                  key={tab.id}
                  tabId={tab.id}
                  isVisible={visible.has(tab.id) && !mdFull}
                  focused={focused && tab.id === pane.activeTabId}
                  onInterrupt={() => onInterrupt(tab.id)}
                />
              ))}
              {paneTabs.filter((tab) => tab.kind === 'file').map((tab) => (
                <FileViewer
                  key={tab.id}
                  tab={tab}
                  isVisible={visible.has(tab.id)}
                  onDirtyChange={onDirtyChange}
                  onOpenFile={onOpenFile}
                />
              ))}
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
      </div>
    </div>
  );
}
