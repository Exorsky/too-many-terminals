import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tab } from '@/types';
import TabBar from './TabBar';
import { TAB_MIME } from '@/lib/dnd';

afterEach(cleanup);

function makeTab(id: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    kind: 'file',
    name: id,
    shellId: null,
    cwd: '/proj',
    resumeSessionId: null,
    exited: false,
    status: 'new',
    path: `/proj/${id}`,
    ...overrides,
  };
}

describe('TabBar', () => {
  it('renders nothing when there are no open tabs', () => {
    const { container } = render(<TabBar tabs={[]} activeTabId={null} onSelectTab={vi.fn()} onCloseTab={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows every open tab regardless of kind', () => {
    const tabs = [
      makeTab('README.md', { kind: 'file' }),
      makeTab('Claude', { kind: 'claude', path: undefined }),
      makeTab('PowerShell', { kind: 'shell', shellId: 'powershell', path: undefined }),
    ];
    render(<TabBar tabs={tabs} activeTabId={null} onSelectTab={vi.fn()} onCloseTab={vi.fn()} />);

    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('PowerShell')).toBeInTheDocument();
  });

  it('selects a tab on click and closes it via the close button', () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    const tabs = [makeTab('a'), makeTab('b')];

    render(<TabBar tabs={tabs} activeTabId="a" onSelectTab={onSelectTab} onCloseTab={onCloseTab} />);

    fireEvent.click(screen.getByText('b'));
    expect(onSelectTab).toHaveBeenCalledWith('b');

    fireEvent.click(within(screen.getByTitle('/proj/a')).getByTitle('Close'));
    expect(onCloseTab).toHaveBeenCalledWith('a');
    // Closing shouldn't also select the tab underneath it.
    expect(onSelectTab).toHaveBeenCalledTimes(1);
  });

  it('closes a tab on middle-click without selecting it', () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    render(<TabBar tabs={[makeTab('a')]} activeTabId={null} onSelectTab={onSelectTab} onCloseTab={onCloseTab} />);

    fireEvent.mouseDown(screen.getByTitle('/proj/a'), { button: 1 });
    expect(onCloseTab).toHaveBeenCalledWith('a');
    expect(onSelectTab).not.toHaveBeenCalled();
  });

  it('drag-reorders onto the side of the target the cursor is on', () => {
    const onReorderTab = vi.fn();
    render(
      <TabBar
        tabs={[makeTab('a'), makeTab('b')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTab={onReorderTab}
      />,
    );
    const target = screen.getByTitle('/proj/b');
    // jsdom has no layout, so the target's box is stated outright.
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 100 } as DOMRect);
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    // jsdom has no DragEvent, so RTL falls back to a plain Event and drops
    // clientX from the init — it has to be defined on the event by hand.
    const drag = (type: 'dragOver' | 'drop', clientX: number) => {
      const event = createEvent[type](target, { dataTransfer });
      Object.defineProperty(event, 'clientX', { value: clientX });
      fireEvent(target, event);
    };

    fireEvent.dragStart(screen.getByTitle('/proj/a'), { dataTransfer });
    drag('dragOver', 120); // left of the midpoint (100 + 100/2)
    drag('drop', 120);

    expect(onReorderTab).toHaveBeenCalledWith('a', 'b', 'before');
  });

  it('accepts a tab dragged in from another pane, with no local drag of its own', () => {
    // The strip used to bail on any drag it didn't start itself, because the
    // payload was bare text/plain and indistinguishable from a text selection.
    // A typed payload is what lets a tab cross panes.
    const onReorderTab = vi.fn();
    render(
      <TabBar
        tabs={[makeTab('a'), makeTab('b')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTab={onReorderTab}
      />,
    );
    const target = screen.getByTitle('/proj/b');
    Object.defineProperty(target, 'getBoundingClientRect', {
      value: () => ({ left: 100, width: 100, right: 200, top: 0, bottom: 32, height: 32 }),
    });

    const dataTransfer = {
      types: [TAB_MIME],
      getData: (type: string) => (type === TAB_MIME ? 'foreign' : ''),
      setData: vi.fn(),
      effectAllowed: '',
      dropEffect: '',
    };
    const drag = (type: 'dragOver' | 'drop', clientX: number) => {
      const event = createEvent[type](target, { dataTransfer });
      Object.defineProperty(event, 'clientX', { value: clientX });
      fireEvent(target, event);
    };

    // No dragStart here: the drag began in a different pane's strip.
    drag('dragOver', 120);
    drag('drop', 120);

    expect(onReorderTab).toHaveBeenCalledWith('foreign', 'b', 'before');
  });

  it('ignores a drag that is not ours', () => {
    const onReorderTab = vi.fn();
    render(
      <TabBar
        tabs={[makeTab('a'), makeTab('b')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTab={onReorderTab}
      />,
    );
    const target = screen.getByTitle('/proj/b');
    // A plain text drag: no tab payload, so getData for our type is empty.
    const dataTransfer = {
      types: ['text/plain'],
      getData: (type: string) => (type === TAB_MIME ? '' : 'some dragged text'),
      setData: vi.fn(),
      effectAllowed: '',
      dropEffect: '',
    };
    const over = createEvent.dragOver(target, { dataTransfer });
    fireEvent(target, over);
    // Never accepted, so a real browser would not deliver a drop here at all.
    expect(over.defaultPrevented).toBe(false);

    fireEvent(target, createEvent.drop(target, { dataTransfer }));
    expect(onReorderTab).not.toHaveBeenCalled();
  });

  it('hands the cyan active rule to the focused pane only', () => {
    const { container, rerender } = render(
      <TabBar tabs={[makeTab('a')]} activeTabId="a" onSelectTab={vi.fn()} onCloseTab={vi.fn()} />,
    );
    expect(container.querySelector('.bg-\\[\\#6fd4c9\\]')).not.toBeNull();

    rerender(
      <TabBar tabs={[makeTab('a')]} activeTabId="a" paneFocused={false} onSelectTab={vi.fn()} onCloseTab={vi.fn()} />,
    );
    // The notch stays — you can still read what that pane is showing — but the
    // accent is gone, so only one strip on screen wears cyan.
    expect(container.querySelector('.bg-\\[\\#6fd4c9\\]')).toBeNull();
    expect(screen.getByText('a')).toBeInTheDocument();
  });

  it("offers Split right / Split down from a tab context menu", async () => {
    const onSplitTab = vi.fn();
    render(
      <TabBar
        tabs={[makeTab('a')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onSplitTab={onSplitTab}
        canSplit={{ vertical: true, horizontal: true }}
      />,
    );
    fireEvent.contextMenu(screen.getByTitle('/proj/a'));
    fireEvent.click(await screen.findByText('Split right'));
    expect(onSplitTab).toHaveBeenCalledWith('a', 'right');
  });

  it('hides a split the pane has no room for', async () => {
    render(
      <TabBar
        tabs={[makeTab('a')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onSplitTab={vi.fn()}
        canSplit={{ vertical: false, horizontal: true }}
      />,
    );
    fireEvent.contextMenu(screen.getByTitle('/proj/a'));
    expect(await screen.findByText('Split down')).toBeInTheDocument();
    expect(screen.queryByText('Split right')).toBeNull();
  });

  it('shows an unsaved indicator for a dirty tab', () => {
    render(<TabBar tabs={[makeTab('a', { dirty: true })]} activeTabId="a" onSelectTab={vi.fn()} onCloseTab={vi.fn()} />);
    expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument();
  });

  it('marks an exited tab', () => {
    render(<TabBar tabs={[makeTab('a', { exited: true })]} activeTabId="a" onSelectTab={vi.fn()} onCloseTab={vi.fn()} />);
    expect(screen.getByText('a (exited)')).toBeInTheDocument();
  });

  it('renders trailing controls docked to the row even with no open tabs', () => {
    const { container } = render(
      <TabBar tabs={[]} activeTabId={null} onSelectTab={vi.fn()} onCloseTab={vi.fn()} trailing={<button>Preview</button>} />,
    );
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });
});
