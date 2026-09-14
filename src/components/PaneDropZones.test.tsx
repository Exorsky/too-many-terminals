import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tab } from '@/types';
import PaneDropZones from './PaneDropZones';
import TabBar from './TabBar';
import { isPaneDrag, FILE_MIME, TAB_MIME } from '@/lib/dnd';

afterEach(cleanup);

function makeTab(id: string): Tab {
  return {
    id, kind: 'shell', name: id, shellId: 'powershell', cwd: `/proj/${id}`,
    resumeSessionId: null, exited: false, status: 'new',
  };
}

/** A dataTransfer whose `types` grows as `setData` is called, like the real one. */
function fakeDataTransfer(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get types() { return [...store.keys()]; },
    setData: (type: string, value: string) => { store.set(type, value); },
    getData: (type: string) => store.get(type) ?? '',
    effectAllowed: '',
    dropEffect: '',
  };
}

describe('drag start propagation', () => {
  // The drop zones only mount while a drag is in flight, and App decides that
  // from a window listener reading `dataTransfer.types`. React attaches its
  // handlers at the root container, so the source only calls setData during the
  // BUBBLE phase — a capture-phase listener on window runs first and sees an
  // empty payload, which silently leaves every pane with no drop target at all.
  it('only sees the tab payload in bubble phase, never in capture', () => {
    const seen: { capture?: boolean; bubble?: boolean } = {};
    const dataTransfer = fakeDataTransfer();
    const onCapture = () => { seen.capture = isPaneDrag(dataTransfer.types); };
    const onBubble = () => { seen.bubble = isPaneDrag(dataTransfer.types); };
    window.addEventListener('dragstart', onCapture, true);
    window.addEventListener('dragstart', onBubble, false);

    render(
      <TabBar
        tabs={[makeTab('a')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTab={vi.fn()}
      />,
    );
    fireEvent.dragStart(screen.getByTitle('/proj/a'), { dataTransfer });

    window.removeEventListener('dragstart', onCapture, true);
    window.removeEventListener('dragstart', onBubble, false);

    expect(seen.capture).toBe(false);
    expect(seen.bubble).toBe(true);
  });
});

describe('PaneDropZones', () => {
  const canSplit = { vertical: true, horizontal: true };

  function setup(props: Partial<React.ComponentProps<typeof PaneDropZones>> = {}) {
    const onDropTab = vi.fn();
    const onDropFile = vi.fn();
    const { container } = render(
      <PaneDropZones canSplit={canSplit} onDropTab={onDropTab} onDropFile={onDropFile} {...props} />,
    );
    const zone = container.firstElementChild as HTMLElement;
    Object.defineProperty(zone, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 }),
    });
    return { zone, onDropTab, onDropFile, container };
  }

  const drag = (zone: HTMLElement, type: 'dragOver' | 'drop', x: number, y: number, dataTransfer: unknown) => {
    const event = createEvent[type](zone, { dataTransfer });
    Object.defineProperty(event, 'clientX', { value: x });
    Object.defineProperty(event, 'clientY', { value: y });
    fireEvent(zone, event);
  };

  it('splits on an edge drop and moves on a centre drop', () => {
    const { zone, onDropTab } = setup();
    const dataTransfer = fakeDataTransfer({ [TAB_MIME]: 'tab-7' });

    drag(zone, 'dragOver', 390, 100, dataTransfer);
    drag(zone, 'drop', 390, 100, dataTransfer);
    expect(onDropTab).toHaveBeenCalledWith('tab-7', 'right');

    onDropTab.mockClear();
    drag(zone, 'dragOver', 200, 100, dataTransfer);
    drag(zone, 'drop', 200, 100, dataTransfer);
    expect(onDropTab).toHaveBeenCalledWith('tab-7', 'center');
  });

  it('highlights the half the pane will become', () => {
    const { zone, container } = setup();
    drag(zone, 'dragOver', 200, 195, fakeDataTransfer({ [TAB_MIME]: 'tab-7' }));
    const hl = container.querySelector('.border-primary') as HTMLElement;
    expect(hl).not.toBeNull();
    expect(hl.style.height).toBe('50%');
    expect(hl.style.bottom).toBe('0px');
  });

  it('highlights the whole pane when that split has no room', () => {
    const { zone, container } = setup({ canSplit: { vertical: false, horizontal: true } });
    drag(zone, 'dragOver', 390, 100, fakeDataTransfer({ [TAB_MIME]: 'tab-7' }));
    const hl = container.querySelector('.border-primary') as HTMLElement;
    // A move is what will actually happen, so that is what it shows.
    expect(hl.style.height).toBe('');
    expect(hl.style.left).toBe('0px');
    expect(hl.style.right).toBe('0px');
  });

  it('opens a dropped file, carrying its project folder', () => {
    const { zone, onDropFile } = setup();
    const dataTransfer = fakeDataTransfer({
      [FILE_MIME]: JSON.stringify({ dir: '/proj', path: '/proj/src/App.tsx' }),
    });
    drag(zone, 'dragOver', 10, 100, dataTransfer);
    drag(zone, 'drop', 10, 100, dataTransfer);
    expect(onDropFile).toHaveBeenCalledWith({ dir: '/proj', path: '/proj/src/App.tsx' }, 'left');
  });

  it('ignores a malformed payload instead of throwing', () => {
    const { zone, onDropFile, onDropTab } = setup();
    const dataTransfer = fakeDataTransfer({ [FILE_MIME]: 'not json' });
    expect(() => drag(zone, 'drop', 200, 100, dataTransfer)).not.toThrow();
    expect(onDropFile).not.toHaveBeenCalled();
    expect(onDropTab).not.toHaveBeenCalled();
  });
});
