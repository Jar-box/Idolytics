import { describe, expect, it } from 'vitest';
import { formatClock, parseClock, roundTime } from './time';

describe('formatClock', () => {
  it('formats minutes and seconds', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(3665)).toBe('1:01:05');
    expect(formatClock(65.4, true)).toBe('01:05.400');
    expect(formatClock(65.05, true)).toBe('01:05.050');
    expect(formatClock(0.001, true)).toBe('00:00.001');
    expect(formatClock(3665.999, true)).toBe('1:01:05.999');
    expect(formatClock(59.9996, true)).toBe('01:00.000');
  });
});

describe('roundTime', () => {
  it('keeps millisecond precision instead of snapping to tenths', () => {
    expect(roundTime(0.1004)).toBe(0.1);
    expect(roundTime(0.1234)).toBe(0.123);
    expect(roundTime(65.98765)).toBe(65.988);
    expect(roundTime(65.9999)).toBe(66);
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
