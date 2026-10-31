import { describe, expect, it } from 'vitest';
import { buildLineDistribution, sortDistributionRows } from './lineDistribution';
import type { Member, Song, VocalLine } from './schema';

function member(id: string): Member {
  return { id, name: id, face: null, color: '#d7ff3f' };
}

function line(
  id: string,
  startSec: number,
  endSec: number,
  memberIds: string[],
  kind: 'sung' | 'adlib' = 'sung',
  extra: Pick<VocalLine, 'lyric' | 'note'> = {},
): VocalLine {
  return { id, startSec, endSec, memberIds, kind, ...extra };
}

function song(lines: VocalLine[], durationSec = 180): Song {
  return {
    id: 'song',
    title: 'Song',
    durationSec,
    videoFileName: null,
    grid: { cols: 9, rows: 5 },
    sections: [],
    lines,
  };
}

describe('buildLineDistribution', () => {
  it('gives every member on a shared line the full duration', () => {
    const members = [member('a'), member('b')];
    const distribution = buildLineDistribution(
      song([line('l1', 10, 20, ['a', 'b'])]),
      members,
    );

    expect(distribution.rows[0].totalSeconds).toBe(10);
    expect(distribution.rows[1].totalSeconds).toBe(10);
    expect(distribution.rows[0].share).toBe(0.5);
    expect(distribution.rows[1].share).toBe(0.5);
    expect(distribution.totalUniqueSeconds).toBe(10);
    expect(distribution.totalMemberSeconds).toBe(20);
  });

  it('places the average at the time-weighted center of the member lines', () => {
    const distribution = buildLineDistribution(
      song([
        line('l1', 10, 20, ['a']),
        line('l2', 40, 60, ['a']),
      ]),
      [member('a')],
    );

    expect(distribution.rows[0].totalSeconds).toBe(30);
    expect(distribution.rows[0].averageSec).toBeCloseTo((15 * 10 + 50 * 20) / 30, 6);
    expect(distribution.rows[0].firstSec).toBe(10);
    expect(distribution.rows[0].lastSec).toBe(60);
  });

  it('counts ad-libs like lines and stacks overlapping blocks into lanes', () => {
    const distribution = buildLineDistribution(
      song([
        line('l1', 10, 20, ['a']),
        line('l2', 12, 18, ['a'], 'adlib', { lyric: 'hey!' }),
      ]),
      [member('a')],
    );

    expect(distribution.rows[0].totalSeconds).toBe(16);
    expect(distribution.rows[0].lineCount).toBe(2);
    expect(distribution.rows[0].adlibCount).toBe(1);
    expect(distribution.rows[0].laneCount).toBe(2);
    expect(distribution.rows[0].segments.map((segment) => segment.lane)).toEqual([0, 1]);
    expect(distribution.adlibCount).toBe(1);
  });

  it('reuses a lane for non-overlapping blocks', () => {
    const distribution = buildLineDistribution(
      song([
        line('l1', 10, 20, ['a']),
        line('l2', 20, 30, ['a']),
        line('l3', 25, 35, ['a']),
      ]),
      [member('a')],
    );

    expect(distribution.rows[0].laneCount).toBe(2);
    expect(distribution.rows[0].segments.map((segment) => segment.lane)).toEqual([0, 0, 1]);
  });

  it('keeps members with no lines as empty rows', () => {
    const distribution = buildLineDistribution(
      song([line('l1', 10, 20, ['a'])]),
      [member('a'), member('b')],
    );

    expect(distribution.rows).toHaveLength(2);
    expect(distribution.rows[1].totalSeconds).toBe(0);
    expect(distribution.rows[1].averageSec).toBeNull();
    expect(distribution.rows[1].share).toBe(0);
    expect(distribution.rows[1].laneCount).toBe(0);
  });

  it('extends the chart span when a line runs past the song length', () => {
    const distribution = buildLineDistribution(
      song([line('l1', 170, 190, ['a'])], 180),
      [member('a')],
    );

    expect(distribution.spanSec).toBe(190);
    expect(distribution.totalUniqueSeconds).toBe(20);
  });

  it('does not double-count a member listed twice on the same line', () => {
    const distribution = buildLineDistribution(
      song([line('l1', 10, 20, ['a', 'a'])]),
      [member('a')],
    );

    expect(distribution.rows[0].totalSeconds).toBe(10);
    expect(distribution.rows[0].lineCount).toBe(1);
    expect(distribution.rows[0].segments).toHaveLength(1);
  });

  it('keeps roster order in the returned rows', () => {
    const distribution = buildLineDistribution(
      song([
        line('l1', 10, 20, ['b']),
        line('l2', 20, 40, ['a']),
      ]),
      [member('a'), member('b'), member('c')],
    );

    expect(distribution.rows.map((row) => row.memberId)).toEqual(['a', 'b', 'c']);
  });
});

describe('sortDistributionRows', () => {
  const members = [member('a'), member('b'), member('c')];
  const distribution = buildLineDistribution(
    song([
      line('l1', 10, 20, ['a']),
      line('l2', 30, 60, ['b']),
      line('l3', 90, 95, ['c']),
      line('l4', 120, 125, ['a']),
    ]),
    members,
  );

  it('sorts by total time', () => {
    expect(
      sortDistributionRows(distribution.rows, members, 'time').map((row) => row.memberId),
    ).toEqual(['b', 'a', 'c']);
  });

  it('sorts by average position', () => {
    expect(
      sortDistributionRows(distribution.rows, members, 'average').map((row) => row.memberId),
    ).toEqual(['b', 'a', 'c']);
  });

  it('keeps roster order when asked', () => {
    expect(
      sortDistributionRows(distribution.rows, members, 'roster').map((row) => row.memberId),
    ).toEqual(['a', 'b', 'c']);
  });
});
