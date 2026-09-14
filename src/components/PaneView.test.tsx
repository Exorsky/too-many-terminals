import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PaneView from './PaneView';
import type { Pane } from '@/lib/panes';
import type { Tab } from '@/types';

// xterm needs a real canvas; the pane only cares that it mounts one per tab
// with the right visibility.
vi.mock('./Terminal', () => ({
  default: ({ tabId, isVisible, focused }: { tabId: string; isVisible: boolean; focused?: boolean }) => (
    <div data-testid={`term-${tabId}`} data-visible={String(isVisible)} data-focused={String(!!focused)} />
  ),
}));
vi.mock('./FileViewer', () => ({
  default: ({ tab, isVisible }: { tab: Tab; isVisible: boolean }) => (
    <div data-testid={`file-${tab.id}`} data-visible={String(isVisible)} />
  ),
}));

afterEach(cleanup);

function claudeTab(id: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id, kind: 'claude', name: id, shellId: null, cwd: '/p',
    resumeSessionId: `s-${id}`, exited: false, status: 'idle', ...overrides,
  };
}

function renderPane(pane: Pane, tabs: Tab[], visible: Set<string>, extra = {}) {
  return render(
    <PaneView
      pane={pane}
      tabs={tabs}
      focused
      visible={visible}
      showMarkdownToggle={false}
      mdTabs={new Map()}
      splitDirection="right"
      mdView="rendered"
      onSetMdView={vi.fn()}
      onSetMode={vi.fn()}
      onSetSplitDirection={vi.fn()}
      onSelectTab={vi.fn()}
      onCloseBarTab={vi.fn()}
      onReorderTab={vi.fn()}
      onFocus={vi.fn()}
      onInterrupt={vi.fn()}
      onDirtyChange={vi.fn()}
      onOpenFile={vi.fn()}
      onSplitTab={vi.fn()}
      canSplit={{ vertical: true, horizontal: true }}
      onDropTab={vi.fn()}
      onDropFile={vi.fn()}
      dragging={false}
      {...extra}
    />,
  );
}

describe('PaneView', () => {
  it('shows the pane active tab and mounts the others hidden', () => {
    const pane: Pane = { id: 'p1', tabIds: ['a', 'b'], activeTabId: 'b' };
    renderPane(pane, [claudeTab('a'), claudeTab('b')], new Set(['b']));

    expect(screen.getByTestId('term-b').dataset.visible).toBe('true');
    expect(screen.getByTestId('term-a').dataset.visible).toBe('false');
    // Both strips entries are there to switch between.
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });

  it('renders a tab the pane was just given, even when it came from elsewhere', () => {
    // The move case: a pane created by a drop holds exactly the dragged tab,
    // and the whole tab list still lives in App.
    const pane: Pane = { id: 'p2', tabIds: ['moved'], activeTabId: 'moved' };
    const allTabs = [claudeTab('other'), claudeTab('moved')];
    renderPane(pane, allTabs, new Set(['moved']));

    expect(screen.getByTestId('term-moved').dataset.visible).toBe('true');
    expect(screen.queryByTestId('term-other')).toBeNull(); // belongs to another pane
  });

  it('shows nothing but stays intact when App says the tab is not on screen', () => {
    const pane: Pane = { id: 'p1', tabIds: ['a'], activeTabId: 'a' };
    renderPane(pane, [claudeTab('a')], new Set());
    expect(screen.getByTestId('term-a').dataset.visible).toBe('false');
  });

  it('gives the keyboard only to the focused pane active tab', () => {
    const pane: Pane = { id: 'p1', tabIds: ['a', 'b'], activeTabId: 'b' };
    const { rerender } = renderPane(pane, [claudeTab('a'), claudeTab('b')], new Set(['b']));
    expect(screen.getByTestId('term-b').dataset.focused).toBe('true');
    expect(screen.getByTestId('term-a').dataset.focused).toBe('false');
    rerender(<div />);
  });

  it('mounts a file tab through FileViewer, not Terminal', () => {
    const pane: Pane = { id: 'p1', tabIds: ['f'], activeTabId: 'f' };
    const file: Tab = { ...claudeTab('f'), kind: 'file', path: '/p/a.md' };
    renderPane(pane, [file], new Set(['f']));
    expect(screen.getByTestId('file-f').dataset.visible).toBe('true');
    expect(screen.queryByTestId('term-f')).toBeNull();
  });
});
