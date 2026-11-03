import { describe, expect, it } from 'vitest';
import { formatClock, parseClock } from './time';

describe('formatClock', () => {
  it('formats minutes and seconds', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(3665)).toBe('1:01:05');
    expect(formatClock(65.4, true)).toBe('01:05.400');
    expect(formatClock(65.05, true)).toBe('01:05.050');
    expect(formatClock(0.001, true)).toBe('00:00.001');
    expect(formatClock(3665.999, true)).toBe('1:01:05.999');
  });
});

describe('parseClock', () => {
  it('parses clocks and raw seconds', () => {
    expect(parseClock('1:05')).toBe(65);
    expect(parseClock('1:01:05')).toBe(3665);
    expect(parseClock('65')).toBe(65);
    expect(parseClock('1:05.5')).toBe(65.5);
    expect(parseClock('1:05.400')).toBe(65.4);
    expect(parseClock('00:00.001')).toBe(0.001);
    expect(parseClock('1:01:05.999')).toBe(3665.999);
    expect(parseClock('')).toBeNull();
    expect(parseClock('1:75')).toBeNull();
    expect(parseClock('nope')).toBeNull();
  });
});
