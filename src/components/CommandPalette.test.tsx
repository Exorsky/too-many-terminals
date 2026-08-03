import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tab } from '@/types';
import CommandPalette from './CommandPalette';

function makeTab(id: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    kind: 'claude',
    name: id,
    shellId: null,
    cwd: 'C:\\Users\\x\\project',
    resumeSessionId: null,
    exited: false,
    status: 'idle',
    ...overrides,
  };
}

const TABS: Tab[] = [
  makeTab('Fix auth redirect', { cwd: 'C:\\Users\\x\\api-gateway', status: 'requires_response' }),
  makeTab('Migrate v2 schema', { cwd: 'C:\\Users\\x\\billing-svc', status: 'working' }),
  makeTab('PowerShell', { kind: 'shell', shellId: 'powershell', cwd: 'C:\\Users\\x\\web-app' }),
];

function renderPalette(overrides: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  const props = {
    open: true,
    tabs: TABS,
    onClose: vi.fn(),
    onSelectTab: vi.fn(),
    ...overrides,
  };
  render(<CommandPalette {...props} />);
  return props;
}

afterEach(cleanup);

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    renderPalette({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists every open tab when the query is empty', () => {
    renderPalette();
    expect(screen.getByText('Fix auth redirect')).toBeInTheDocument();
    expect(screen.getByText('Migrate v2 schema')).toBeInTheDocument();
    expect(screen.getByText('PowerShell')).toBeInTheDocument();
  });

  it('excludes file tabs — they live in their own strip, not this "jump to a terminal" list', () => {
    renderPalette({ tabs: [...TABS, makeTab('README.md', { kind: 'file', path: 'C:\\Users\\x\\project\\README.md' })] });
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();
  });

  it('fuzzy-filters by name', async () => {
    renderPalette();
    await userEvent.keyboard('mig');
    expect(screen.getByText('Migrate v2 schema')).toBeInTheDocument();
    expect(screen.queryByText('Fix auth redirect')).not.toBeInTheDocument();
  });

  it('filters by folder name', async () => {
    renderPalette();
    await userEvent.keyboard('gateway');
    expect(screen.getByText('Fix auth redirect')).toBeInTheDocument();
    expect(screen.queryByText('Migrate v2 schema')).not.toBeInTheDocument();
  });

  it('filters by status word so "needs" surfaces blocked sessions', async () => {
    renderPalette();
    await userEvent.keyboard('needs');
    expect(screen.getByText('Fix auth redirect')).toBeInTheDocument();
    expect(screen.queryByText('Migrate v2 schema')).not.toBeInTheDocument();
  });

  it('selects the top result on Enter and closes', async () => {
    const props = renderPalette();
    await userEvent.keyboard('gateway{Enter}');
    expect(props.onSelectTab).toHaveBeenCalledWith('Fix auth redirect');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('moves the selection with the arrow keys before choosing', async () => {
    const props = renderPalette();
    await userEvent.keyboard('{ArrowDown}{Enter}'); // second row
    expect(props.onSelectTab).toHaveBeenCalledWith('Migrate v2 schema');
  });

  it('closes on Escape without selecting', async () => {
    const props = renderPalette();
    await userEvent.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onSelectTab).not.toHaveBeenCalled();
  });

  it('shows an empty state when nothing matches', async () => {
    renderPalette();
    await userEvent.keyboard('zzzzz');
    expect(screen.getByText(/No open terminal matches/)).toBeInTheDocument();
  });
});
