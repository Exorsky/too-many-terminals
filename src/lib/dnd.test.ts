import { describe, expect, it } from 'vitest';
import { dropZone, isPaneDrag, zoneRect, FILE_MIME, TAB_MIME } from './dnd';

const rect = { left: 0, top: 0, width: 400, height: 200 };
const at = (x: number, y: number) => dropZone({ clientX: x, clientY: y }, rect);

describe('dropZone', () => {
  it('reads the middle as a move, not a split', () => {
    expect(at(200, 100)).toBe('center');
  });

  it('reads each edge', () => {
    expect(at(10, 100)).toBe('left');
    expect(at(390, 100)).toBe('right');
    expect(at(200, 5)).toBe('top');
    expect(at(200, 195)).toBe('bottom');
  });

  it('resolves corners to the nearer edge rather than the first tested', () => {
    // 400x200: at (8, 20) the left edge is 2% away and the top 10%.
    expect(at(8, 20)).toBe('left');
    // At (60, 4) the top is 2% away and the left 15%.
    expect(at(60, 4)).toBe('top');
  });

  it('honours the quarter threshold', () => {
    expect(at(99, 100)).toBe('left');   // 24.75%
    expect(at(101, 100)).toBe('center'); // 25.25%
  });

  it('still returns a real zone for a zero-sized rect', () => {
    // A pane mid-collapse can measure 0. The guard keeps the division from
    // producing NaN, which would sort unpredictably and pick a random edge.
    const zone = dropZone({ clientX: 0, clientY: 0 }, { left: 0, top: 0, width: 0, height: 0 });
    expect(['left', 'right', 'top', 'bottom', 'center']).toContain(zone);
  });

  it('is unaffected by the pane not sitting at the origin', () => {
    const offset = { left: 1000, top: 500, width: 400, height: 200 };
    expect(dropZone({ clientX: 1200, clientY: 600 }, offset)).toBe('center');
    expect(dropZone({ clientX: 1010, clientY: 600 }, offset)).toBe('left');
  });
});

describe('isPaneDrag', () => {
  it('accepts our own payloads and nothing else', () => {
    expect(isPaneDrag([TAB_MIME])).toBe(true);
    expect(isPaneDrag([FILE_MIME])).toBe(true);
    expect(isPaneDrag(['text/plain'])).toBe(false);
    expect(isPaneDrag([])).toBe(false);
  });
});

describe('zoneRect', () => {
  const both = { vertical: true, horizontal: true };

  it('covers half the pane for an edge', () => {
    expect(zoneRect('right', both)).toEqual({ right: 0, top: 0, bottom: 0, width: '50%' });
    expect(zoneRect('top', both)).toEqual({ top: 0, left: 0, right: 0, height: '50%' });
  });

  it('covers the whole pane for a move', () => {
    expect(zoneRect('center', both)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('shows the whole pane when that split has no room — a move is what happens', () => {
    const narrow = { vertical: false, horizontal: true };
    expect(zoneRect('right', narrow)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    // The axis that still has room is unaffected.
    expect(zoneRect('bottom', narrow)).toEqual({ bottom: 0, left: 0, right: 0, height: '50%' });
  });
});
