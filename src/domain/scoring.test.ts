import { describe, expect, it } from 'vitest';
import {
  buildGroupLeaderboard,
  scoreFormation,
  scoreSong,
  type FormationScore,
} from './scoring';
import {
  defaultPostures,
  type Formation,
  type Group,
  type Placement,
  type Section,
  type Song,
} from './schema';

function placement(memberId: string, col: number, row: number, postureId = 'standing'): Placement {
  return { memberId, col, row, postureId };
}

function formation(
  id: string,
  startSec: number,
  endSec: number,
  anchors: string[],
  placements: Placement[],
): Formation {
  return { id, startSec, endSec, anchors, placements };
}

function scoreById(score: FormationScore, memberId: string) {
  const member = score.memberScores.find((entry) => entry.memberId === memberId);
  if (!member) throw new Error(`Missing ${memberId}`);
  return member;
}

function section(id: string, startSec: number, endSec: number, formations: Formation[]): Section {
  return { id, label: id, startSec, endSec, formations };
}

function song(id: string, sections: Section[]): Song {
  return {
    id,
    title: id,
    durationSec: 300,
    videoFileName: null,
    audioFileName: null,
    sourceUrl: null,
    grid: { cols: 9, rows: 5 },
    sections,
    lines: [],
  };
}

describe('scoreFormation', () => {
  it('scores a horizontal line around the center anchor', () => {
    const testFormation = formation(
      'f1',
      0,
      10,
      ['m3'],
      [
        placement('m1', 0, 0),
        placement('m2', 1, 0),
        placement('m3', 2, 0),
        placement('m4', 3, 0),
        placement('m5', 4, 0),
      ],
    );
    const score = scoreFormation(testFormation, defaultPostures);
    expect(score.memberCount).toBe(5);
    expect(scoreById(score, 'm1').ratio).toBe(3 / 5);
    expect(scoreById(score, 'm2').ratio).toBe(4 / 5);
    expect(scoreById(score, 'm3').ratio).toBe(1);
    expect(scoreById(score, 'm4').ratio).toBe(4 / 5);
    expect(scoreById(score, 'm5').ratio).toBe(3 / 5);
    expect(scoreById(score, 'm3').points).toBe(10);
  });

  it('scores a line around an edge anchor', () => {
    const testFormation = formation(
      'f1',
      0,
      10,
      ['m5'],
      [
        placement('m1', 0, 0),
        placement('m2', 1, 0),
        placement('m3', 2, 0),
        placement('m4', 3, 0),
        placement('m5', 4, 0),
      ],
    );
    const score = scoreFormation(testFormation, defaultPostures);
    expect(scoreById(score, 'm1').ratio).toBe(1 / 5);
    expect(scoreById(score, 'm2').ratio).toBe(2 / 5);
    expect(scoreById(score, 'm3').ratio).toBe(3 / 5);
    expect(scoreById(score, 'm4').ratio).toBe(4 / 5);
    expect(scoreById(score, 'm5').ratio).toBe(1);
  });

  it('matches the posture/blocking column example', () => {
    const testFormation = formation(
      'f1',
      0,
      8,
      ['m2'],
      [
        placement('m1', 4, 3, 'standing'),
        placement('m2', 4, 2, 'standing'),
        placement('m3', 4, 1, 'half'),
        placement('m4', 4, 0, 'sitting'),
      ],
    );
    const score = scoreFormation(testFormation, defaultPostures);
    expect(score.memberCount).toBe(4);
    expect(scoreById(score, 'm1').hidden).toBe(true);
    expect(scoreById(score, 'm1').blockedBy).toBe('m2');
    expect(scoreById(score, 'm1').ratio).toBe(0);
    expect(scoreById(score, 'm1').points).toBe(0);
    expect(scoreById(score, 'm2').ratio).toBe(1);
    expect(scoreById(score, 'm3').ratio).toBe(3 / 4);
    expect(scoreById(score, 'm4').ratio).toBe(2 / 4);
    expect(scoreById(score, 'm2').points).toBe(8);
    expect(scoreById(score, 'm3').points).toBe(6);
    expect(scoreById(score, 'm4').points).toBe(4);
  });

  it('does not hide a taller member behind a shorter member', () => {
    const testFormation = formation(
      'f1',
      0,
      10,
      ['m1'],
      [placement('m1', 2, 1, 'standing'), placement('m2', 2, 0, 'sitting')],
    );
    const score = scoreFormation(testFormation, defaultPostures);
    expect(scoreById(score, 'm1').hidden).toBe(false);
  });

  it('hides an equal-height member directly behind', () => {
    const testFormation = formation(
      'f1',
      0,
      10,
      ['m2'],
      [placement('m2', 3, 0, 'standing'), placement('m1', 3, 1, 'standing')],
    );
    const score = scoreFormation(testFormation, defaultPostures);
    expect(scoreById(score, 'm1').hidden).toBe(true);
    expect(scoreById(score, 'm1').blockedBy).toBe('m2');
  });

  it('uses any taller/equal member in front, not only the immediate one', () => {
    const testFormation = formation(
      'f1',
      0,
      10,
      ['m3'],
      [
        placement('m1', 2, 2, 'standing'),
        placement('m2', 2, 1, 'half'),
        placement('m3', 2, 0, 'standing'),
      ],
    );
    const score = scoreFormation(testFormation, defaultPostures);
    expect(scoreById(score, 'm1').hidden).toBe(true);
    expect(scoreById(score, 'm1').blockedBy).toBe('m3');
    expect(scoreById(score, 'm2').hidden).toBe(true);
    expect(scoreById(score, 'm2').blockedBy).toBe('m3');
  });

  it('returns zero scores when no placed anchor exists', () => {
    const testFormation = formation(
      'f1',
      0,
      10,
      ['missing'],
      [placement('m1', 0, 0), placement('m2', 1, 0)],
    );
    const score = scoreFormation(testFormation, defaultPostures);
    expect(score.hasAnchor).toBe(false);
    expect(score.memberScores.every((entry) => entry.ratio === 0)).toBe(true);
  });

  it('gives co-anchors full marks', () => {
    const testFormation = formation(
      'f1',
      0,
      10,
      ['m2', 'm3'],
      [
        placement('m1', 0, 0),
        placement('m2', 1, 0),
        placement('m3', 2, 0),
        placement('m4', 3, 0),
      ],
    );
    const score = scoreFormation(testFormation, defaultPostures);
    expect(scoreById(score, 'm2').ratio).toBe(1);
    expect(scoreById(score, 'm3').ratio).toBe(1);
    expect(scoreById(score, 'm1').ratio).toBe(3 / 4);
    expect(scoreById(score, 'm4').ratio).toBe(3 / 4);
  });

  it('collapses empty grid gaps when ranking distances', () => {
    const testFormation = formation(
      'f1',
      0,
      10,
      ['m1'],
      [placement('m1', 0, 0), placement('m2', 2, 0), placement('m3', 5, 0)],
    );
    const score = scoreFormation(testFormation, defaultPostures);
    expect(scoreById(score, 'm1').ratio).toBe(1);
    expect(scoreById(score, 'm2').ratio).toBe(2 / 3);
    expect(scoreById(score, 'm3').ratio).toBe(1 / 3);
  });

  it('uses straight-line distance for diagonal ranks', () => {
    const testFormation = formation(
      'f1',
      0,
      10,
      ['m1'],
      [
        placement('m1', 0, 0),
        placement('m2', 1, 0),
        placement('m3', 1, 1),
        placement('m4', 2, 0),
        placement('m5', 2, 1),
      ],
    );
    const score = scoreFormation(testFormation, defaultPostures);
    expect(scoreById(score, 'm2').rank).toBe(1);
    expect(scoreById(score, 'm3').rank).toBe(2);
    expect(scoreById(score, 'm4').rank).toBe(3);
    expect(scoreById(score, 'm5').rank).toBe(4);
    expect(scoreById(score, 'm2').distance).toBe(1);
    expect(scoreById(score, 'm3').distance).toBeCloseTo(Math.SQRT2);
  });

  it('handles an empty formation', () => {
    const score = scoreFormation(formation('f1', 0, 10, [], []), defaultPostures);
    expect(score.memberCount).toBe(0);
    expect(score.memberScores).toEqual([]);
  });
});

describe('scoreSong', () => {
  it('uses total choreo time as the denominator for every participant', () => {
    const testSong = song('s1', [
      section('sec1', 0, 15, [
        formation('f1', 0, 5, ['m1'], [placement('m1', 2, 0), placement('m2', 3, 0)]),
        formation('f2', 5, 15, ['m3'], [
          placement('m3', 2, 0),
          placement('m2', 3, 0),
          placement('m1', 4, 0),
        ]),
      ]),
    ]);
    const score = scoreSong(testSong, defaultPostures);
    expect(score.durationSec).toBe(15);
    const m1 = score.rows.find((row) => row.memberId === 'm1');
    const m2 = score.rows.find((row) => row.memberId === 'm2');
    const m3 = score.rows.find((row) => row.memberId === 'm3');
    if (!m1 || !m2 || !m3) throw new Error('Missing row');
    expect(m1.seconds).toBe(15);
    expect(m2.seconds).toBe(15);
    expect(m3.seconds).toBe(15);
    expect(m1.anchorSeconds).toBe(5);
    expect(m3.anchorSeconds).toBe(10);
    expect(m1.points).toBe(5 + (1 / 3) * 10);
    expect(m1.percentage).toBeCloseTo(((5 + 10 / 3) / 15) * 100);
  });
});

describe('buildGroupLeaderboard', () => {
  it('aggregates and sorts members by normalized score', () => {
    const group: Group = {
      id: 'g1',
      name: 'Test Group',
      members: [
        { id: 'm1', name: 'Mina', face: null, color: '#d7ff3f' },
        { id: 'm2', name: 'Jia', face: null, color: '#ff4d9d' },
      ],
      songs: [
        song('s1', [
          section('sec1', 0, 10, [
            formation('f1', 0, 10, ['m1'], [placement('m1', 2, 0), placement('m2', 3, 0)]),
          ]),
        ]),
        song('s2', [
          section('sec1', 0, 10, [
            formation('f1', 0, 10, ['m2'], [placement('m1', 2, 0), placement('m2', 3, 0)]),
          ]),
        ]),
      ],
    };
    const leaderboard = buildGroupLeaderboard(group, defaultPostures);
    expect(leaderboard).toHaveLength(2);
    const m1Row = leaderboard.find((row) => row.memberId === 'm1');
    const m2Row = leaderboard.find((row) => row.memberId === 'm2');
    expect(m1Row?.percentage).toBe(75);
    expect(m2Row?.percentage).toBe(75);
    expect(m1Row?.songs).toBe(2);
    expect(m2Row?.songs).toBe(2);
  });
});
