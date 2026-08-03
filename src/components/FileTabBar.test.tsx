import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tab } from '@/types';
import FileTabBar from './FileTabBar';

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

describe('FileTabBar', () => {
  it('renders nothing when there are no open file tabs', () => {
    const { container } = render(<FileTabBar tabs={[]} activeTabId={null} onSelectTab={vi.fn()} onCloseTab={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('selects a tab on click and closes it via the close button', () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    const tabs = [makeTab('a'), makeTab('b')];

    render(<FileTabBar tabs={tabs} activeTabId="a" onSelectTab={onSelectTab} onCloseTab={onCloseTab} />);

    fireEvent.click(screen.getByText('b'));
    expect(onSelectTab).toHaveBeenCalledWith('b');

    fireEvent.click(within(screen.getByTitle('/proj/a')).getByTitle('Close'));
    expect(onCloseTab).toHaveBeenCalledWith('a');
    // Closing shouldn't also select the tab underneath it.
    expect(onSelectTab).toHaveBeenCalledTimes(1);
  });

  it('shows an unsaved indicator for a dirty tab', () => {
    render(<FileTabBar tabs={[makeTab('a', { dirty: true })]} activeTabId="a" onSelectTab={vi.fn()} onCloseTab={vi.fn()} />);
    expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument();
  });
});
