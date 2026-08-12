import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionControls from './SessionControls';

function renderControls(overrides: Partial<React.ComponentProps<typeof SessionControls>> = {}) {
  const props = {
    mode: 'terminal' as const,
    splitDirection: 'right' as const,
    onSetMode: vi.fn(),
    onSetSplitDirection: vi.fn(),
    ...overrides,
  };
  render(<SessionControls {...props} />);
  return props;
}

const previewButton = () => screen.getByRole('button', { name: 'Markdown Preview' });
const splitButton = () => screen.getByRole('button', { name: 'Split view' });

afterEach(cleanup);

describe('SessionControls', () => {
  it('flips Preview on and back off', async () => {
    const props = renderControls();
    await userEvent.click(previewButton());
    expect(props.onSetMode).toHaveBeenCalledWith('markdown');
  });

  it('flips Preview back to terminal once it is on', async () => {
    const props = renderControls({ mode: 'markdown' });
    await userEvent.click(previewButton());
    expect(props.onSetMode).toHaveBeenCalledWith('terminal');
  });

  it('disables Preview while Split is active', () => {
    renderControls({ mode: 'split' });
    expect(previewButton()).toBeDisabled();
  });

  it('opens the layout menu and picks a direction', async () => {
    const props = renderControls();
    await userEvent.click(splitButton());
    await userEvent.click(await screen.findByText('Split right'));
    expect(props.onSetMode).toHaveBeenCalledWith('split');
    expect(props.onSetSplitDirection).toHaveBeenCalledWith('right');
  });

  it('splits down from the same menu', async () => {
    const props = renderControls();
    await userEvent.click(splitButton());
    await userEvent.click(await screen.findByText('Split down'));
    expect(props.onSetMode).toHaveBeenCalledWith('split');
    expect(props.onSetSplitDirection).toHaveBeenCalledWith('down');
  });

  it('hides Unsplit while not split', async () => {
    renderControls();
    await userEvent.click(splitButton());
    expect(screen.queryByText('Unsplit')).not.toBeInTheDocument();
  });

  it('unsplits back to terminal', async () => {
    const props = renderControls({ mode: 'split' });
    await userEvent.click(splitButton());
    await userEvent.click(await screen.findByText('Unsplit'));
    expect(props.onSetMode).toHaveBeenCalledWith('terminal');
  });
});
