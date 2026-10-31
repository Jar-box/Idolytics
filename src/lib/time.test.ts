import { describe, expect, it } from 'vitest';
import { formatClock, parseClock } from './time';

describe('formatClock', () => {
  it('formats minutes and seconds', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(3665)).toBe('1:01:05');
    expect(formatClock(65.4, true)).toBe('01:05.4');
  });
});

describe('parseClock', () => {
  it('parses clocks and raw seconds', () => {
    expect(parseClock('1:05')).toBe(65);
    expect(parseClock('1:01:05')).toBe(3665);
    expect(parseClock('65')).toBe(65);
    expect(parseClock('1:05.5')).toBe(65.5);
    expect(parseClock('')).toBeNull();
    expect(parseClock('1:75')).toBeNull();
    expect(parseClock('nope')).toBeNull();
  });
});
