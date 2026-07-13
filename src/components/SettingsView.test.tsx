import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import SettingsView from './SettingsView';

afterEach(cleanup);

describe('SettingsView', () => {
  it('shows the General tab by default', () => {
    render(<SettingsView />);
    expect(screen.getByText('No settings yet')).toBeInTheDocument();
  });

  it('switches to the Customize tab on click', async () => {
    render(<SettingsView />);
    await userEvent.click(screen.getByText('Customize'));
    expect(screen.getByText('Customization coming soon')).toBeInTheDocument();
    expect(screen.queryByText('No settings yet')).not.toBeInTheDocument();
  });
});
