export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function roundTo(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Timestamps are stored to the millisecond. Media elements expose much finer
 * values, so rounding to tenths here would visibly quantize scrubbing to 100ms.
 */
export const TIME_DECIMALS = 3;

export function roundTime(value: number): number {
  return roundTo(value, TIME_DECIMALS);
}

export function formatClock(seconds: number, showMs = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) return showMs ? '0:00.000' : '0:00';
  if (showMs) {
    const totalMs = Math.round(seconds * 1000);
    const whole = Math.floor(totalMs / 1000);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    const ms = totalMs % 1000;
    const base = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const withHours = hours > 0 ? `${hours}:${base}` : base;
    return `${withHours}.${String(ms).padStart(3, '0')}`;
  }
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const base = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${base}` : base;
}

export function parseClock(input: string): number | null {
  const value = input.trim();
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? Math.max(0, seconds) : null;
  }
  const parts = value.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((num) => !Number.isFinite(num) || num < 0)) return null;
  if (parts.length === 2) {
    const [minutes, seconds] = nums;
    if (seconds >= 60) return null;
    return minutes * 60 + seconds;
  }
  const [hours, minutes, seconds] = nums;
  if (minutes >= 60 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatPercent(ratio: number): string {
  return `${roundTo(ratio * 100, 1)}%`;
}

export function formatPoints(points: number): string {
  return roundTo(points, 1).toLocaleString(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  });
}
