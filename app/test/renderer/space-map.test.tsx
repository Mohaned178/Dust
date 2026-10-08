import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpaceMap, squarify } from '../../renderer/src/components/SpaceMap';
import type { ResultRow } from '../../src/shared/ipc';
import { makeApi, makeResultsRows } from './fakes';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EPS = 1e-6;
const area = (rect: Rect) => rect.w * rect.h;

describe('squarify', () => {
  const frame = { x: 10, y: 20, w: 600, h: 400 };

  it('gives every value an area proportional to its share of the frame', () => {
    const values = [60, 30, 20, 10, 10, 5, 5];
    const total = values.reduce((sum, value) => sum + value, 0);
    const rects = squarify(values, frame);

    expect(rects).toHaveLength(values.length);
    values.forEach((value, position) => {
      expect(area(rects[position]!)).toBeCloseTo((value / total) * frame.w * frame.h, 3);
    });
    expect(rects.reduce((sum, rect) => sum + area(rect), 0)).toBeCloseTo(frame.w * frame.h, 3);
  });

  it('keeps every rectangle inside the frame', () => {
    const rects = squarify([50, 40, 30, 20, 10, 9, 8, 1], frame);
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(frame.x - EPS);
      expect(rect.y).toBeGreaterThanOrEqual(frame.y - EPS);
      expect(rect.x + rect.w).toBeLessThanOrEqual(frame.x + frame.w + EPS);
      expect(rect.y + rect.h).toBeLessThanOrEqual(frame.y + frame.h + EPS);
    }
  });

  it('does not overlap rectangles', () => {
    const rects = squarify([50, 40, 30, 20, 10], frame);
    for (let a = 0; a < rects.length; a += 1) {
      for (let b = a + 1; b < rects.length; b += 1) {
        const first = rects[a]!;
        const second = rects[b]!;
        const overlapW = Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x);
        const overlapH = Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y);
        expect(overlapW <= EPS || overlapH <= EPS).toBe(true);
      }
    }
  });

  it('fills the frame for a single value', () => {
    const [only] = squarify([7], frame);
    expect(only!.x).toBeCloseTo(frame.x, 6);
    expect(only!.y).toBeCloseTo(frame.y, 6);
    expect(only!.w).toBeCloseTo(frame.w, 6);
    expect(only!.h).toBeCloseTo(frame.h, 6);
  });

  it('returns nothing for empty input', () => {
    expect(squarify([], frame)).toEqual([]);
  });

  it('returns zero-sized rectangles for zero totals or an empty frame', () => {
    for (const rect of squarify([0, 0], frame)) expect(area(rect)).toBe(0);
    for (const rect of squarify([5, 3], { x: 0, y: 0, w: 0, h: 100 })) expect(area(rect)).toBe(0);
  });
});

describe('SpaceMap', () => {
  const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

  // jsdom has no layout; give the treemap a frame to carve up.
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 460 });
  });

  afterEach(() => {
    if (originalWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalWidth);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    if (originalHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalHeight);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
  });

  function renderMap(rows: ResultRow[] | null, extra: { failed?: boolean } = {}) {
    return render(<SpaceMap api={makeApi()} root={'C:\\'} rows={rows} {...extra} />);
  }

  it('renders tiles as buttons inside a list, with a shading key', () => {
    renderMap(makeResultsRows());

    const list = screen.getByRole('list', { name: 'Space map' });
    const tiles = within(list).getAllByRole('listitem');
    expect(tiles.length).toBeGreaterThanOrEqual(3);
    for (const tile of tiles) expect(within(tile).getByRole('button')).toBeInTheDocument();

    expect(within(list).getByRole('button', { name: /^Temp, 256 KB, \d+ percent, 256 KB safe to clean/ })).toBeInTheDocument();
    const key = screen.getByRole('list', { name: 'Shading key' });
    expect(key).toHaveTextContent('All safe');
    expect(key).toHaveTextContent('Nothing safe to clean');
  });

  it('opens a tile with subfolders and walks back through the breadcrumb', () => {
    renderMap(makeResultsRows());
    const crumbs = screen.getByRole('navigation', { name: 'Folder path' });
    expect(within(crumbs).getAllByRole('button')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /^Users, 512 KB.*open$/ }));

    expect(within(crumbs).getAllByRole('button').map((button) => button.textContent)).toEqual(['C:\\', 'Users']);
    expect(within(crumbs).getByRole('button', { name: 'Users' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^x, 128 KB/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Temp, / })).toBeNull();

    fireEvent.click(within(crumbs).getByRole('button', { name: 'C:\\' }));
    expect(within(crumbs).getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Temp, / })).toBeInTheDocument();
  });

  it('does not drill into a tile that has no subfolders and says so', () => {
    renderMap(makeResultsRows());

    fireEvent.click(screen.getByRole('button', { name: /^Windows, / }));

    expect(screen.getByText('Windows has no subfolders, only files.')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Folder path' })).getAllByRole('button')).toHaveLength(1);
  });

  it('explains the depth limit for a folder with subfolders that were not saved', () => {
    const rows = makeResultsRows().map((row) => (row.path === 'C:\\Windows' ? { ...row, childCount: 4 } : row));
    renderMap(rows);

    const tile = screen.getByRole('button', { name: /^Windows, / });
    expect(tile).toHaveAccessibleName(/Folders deeper than this weren.t saved/);
    expect(screen.getByText(/Some blocks here can.t be opened/)).toBeInTheDocument();

    fireEvent.click(tile);
    expect(screen.getByRole('status')).toHaveTextContent(/Windows: Folders deeper than this weren.t saved/);
    expect(within(screen.getByRole('navigation', { name: 'Folder path' })).getAllByRole('button')).toHaveLength(1);
  });

  it('does not show the depth-limit note when every folder is accounted for', () => {
    renderMap(makeResultsRows());
    expect(screen.queryByText(/Folders deeper than this weren.t saved/)).toBeNull();
  });

  it('shows a skeleton while loading and an alert when the load failed', () => {
    const { container, unmount } = renderMap(null);
    expect(screen.queryByRole('list', { name: 'Space map' })).toBeNull();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    unmount();

    renderMap(null, { failed: true });
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load the space map');
  });

  it('reveals the current folder in Explorer', () => {
    const revealPath = vi.fn(async () => {});
    render(<SpaceMap api={makeApi({ revealPath })} root={'C:\\'} rows={makeResultsRows()} />);

    fireEvent.click(screen.getByRole('button', { name: /^Users, 512 KB.*open$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in Explorer' }));
    expect(revealPath).toHaveBeenCalledWith('C:\\Users');
  });
});
