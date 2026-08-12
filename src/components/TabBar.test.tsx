import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tab } from '@/types';
import TabBar from './TabBar';

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
