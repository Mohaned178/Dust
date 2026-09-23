import { describe, expect, it } from 'vitest';
import { formatBytes, formatCount, formatDuration, formatRelativeTime } from '../../renderer/src/format';

describe('formatBytes', () => {
  it('uses binary units with two significant digits', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(512 * 1024 * 1024)).toBe('512 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });

  it('renders missing values as a dash', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('formatCount', () => {
  it('groups thousands with a comma', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(1_000_000)).toBe('1,000,000');
  });
});

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(65_000)).toBe('1m 05s');
    expect(formatDuration(3_600_000)).toBe('1h 00m');
    expect(formatDuration(7_500_000)).toBe('2h 05m');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 0, 10, 12, 0, 0);

  it('formats recent and old timestamps', () => {
    expect(formatRelativeTime(now, now)).toBe('just now');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 m ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(formatRelativeTime(now - 86_400_000, now)).toBe('1 d ago');
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2 d ago');
    expect(formatRelativeTime(null, now)).toBe('never');
  });
});
