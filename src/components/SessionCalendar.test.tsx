import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarMonths, type CalendarMark } from '@/lib/stats';
import SessionCalendar, { density } from './SessionCalendar';

const NOW = new Date(2026, 7, 13, 20).getTime();
const at = (date: number, over: Partial<CalendarMark> = {}): CalendarMark => ({
  iso: new Date(2026, 7, date, 12).toISOString(),
  hue: 210, projectName: 'too-many-terminals', ...over,
});

const months = (marks: CalendarMark[]) => calendarMonths(marks, NOW, 1);

afterEach(cleanup);

describe('density', () => {
  it('steps up with the session count and stops at the top', () => {
    expect([0, 1, 3, 5, 9].map(density)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('SessionCalendar', () => {
  it('makes a busy day a button and reports its count', () => {
    render(<SessionCalendar months={months([at(11), at(11)])} now={NOW} onSelectDay={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Aug 2026 11 — 2 sessions' })).toBeInTheDocument();
  });

  it('leaves an empty day unclickable', () => {
    render(<SessionCalendar months={months([at(11)])} now={NOW} onSelectDay={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Aug 2026 12/ })).not.toBeInTheDocument();
  });

  it('picks a day, and shows it as pressed', async () => {
    const onSelectDay = vi.fn();
    const { rerender } = render(
      <SessionCalendar months={months([at(11)])} now={NOW} onSelectDay={onSelectDay} />,
    );
    const day = screen.getByRole('button', { name: /Aug 2026 11/ });
    await userEvent.click(day);
    expect(onSelectDay).toHaveBeenCalledWith('2026-7-11');

    rerender(<SessionCalendar months={months([at(11)])} now={NOW} selected="2026-7-11" onSelectDay={onSelectDay} />);
    expect(screen.getByRole('button', { name: /Aug 2026 11/ })).toHaveAttribute('aria-pressed', 'true');
  });

  // Home's grid is a readout — the same rule the cadence strip it replaced
  // followed. Resuming a session lives in History and the sidebar.
  it('has no click targets at all without onSelectDay', () => {
    render(<SessionCalendar months={months([at(11), at(12)])} now={NOW} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('img', { name: '2 sessions by day' })).toBeInTheDocument();
  });

  it('reads out the day\'s totals on hover', async () => {
    render(<SessionCalendar
      months={months([at(11, { tokens: 900_000 }), at(11, { tokens: 300_000 }), at(11, { hue: 140, projectName: 'ledger-api' })])}
      now={NOW}
    />);
    expect(screen.getByText(/Point at a day/)).toBeInTheDocument();

    await userEvent.hover(screen.getByTitle('Aug 2026 11 — 3 sessions'));
    expect(await screen.findByText('Aug 11')).toBeInTheDocument();
    expect(screen.getByText('3 sessions')).toBeInTheDocument();
    expect(screen.getByText('1.2M tokens')).toBeInTheDocument();
    expect(screen.getByText('too-many-terminals')).toBeInTheDocument();
    expect(screen.getByText('ledger-api')).toBeInTheDocument();
  });

  it('leaves the token figure out when nothing counted any', async () => {
    render(<SessionCalendar months={months([at(11)])} now={NOW} />);
    await userEvent.hover(screen.getByTitle('Aug 2026 11 — 1 session'));
    expect(await screen.findByText('1 session')).toBeInTheDocument();
    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument();
  });
});
