import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import GitBranch from './GitBranch';

const base = { root: '/r', head: 'abc1234', upstream: 'origin/x', ahead: 0, behind: 0, files: [] };

describe('GitBranch', () => {
  it('shows the branch, a dot when dirty, and ahead/behind only when non-zero', () => {
    render(<GitBranch status={{ ...base, branch: 'feat/x', ahead: 2, files: [{ path: 'a', code: 'M' }] }} />);
    expect(screen.getByText('feat/x')).toBeInTheDocument();
    expect(screen.getByLabelText('uncommitted changes')).toBeInTheDocument();
    expect(screen.getByText('↑2')).toBeInTheDocument();
    expect(screen.queryByText(/↓/)).toBeNull();
  });

  it('names a detached HEAD by its commit', () => {
    render(<GitBranch status={{ ...base, branch: null }} />);
    expect(screen.getByText('detached abc1234')).toBeInTheDocument();
  });
});
