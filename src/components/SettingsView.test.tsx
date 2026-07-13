import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ipc from '@/lib/ipc';
import SettingsView from './SettingsView';

vi.mock('@/lib/ipc');

beforeEach(() => {
  vi.mocked(ipc.loadSettings).mockResolvedValue({ selectedThemeId: 'default', customThemes: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SettingsView', () => {
  it('shows the General tab by default', () => {
    render(<SettingsView />);
    expect(screen.getByText('No settings yet')).toBeInTheDocument();
  });

  it('switches to the Customize tab on click', async () => {
    render(<SettingsView />);
    await userEvent.click(screen.getByText('Customize'));
    expect(await screen.findByText('Theme')).toBeInTheDocument();
    expect(screen.queryByText('No settings yet')).not.toBeInTheDocument();
  });
});
