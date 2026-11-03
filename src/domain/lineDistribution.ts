import {
  LINE_KINDS,
  type LineKind,
  type Member,
  type Song,
  type VocalLine,
} from './schema';

const EPSILON = 1e-6;

export type LineKindCounts = Record<LineKind, number>;

function emptyKindCounts(): LineKindCounts {
  const counts = {} as LineKindCounts;
  for (const kind of LINE_KINDS) counts[kind] = 0;
  return counts;
}

export interface DistributionSegment {
  line: VocalLine;
  lane: number;
}

export interface MemberDistribution {
  memberId: string;
  totalSeconds: number;
  share: number;
  lineCount: number;
  kindCounts: LineKindCounts;
  firstSec: number | null;
  lastSec: number | null;
  averageSec: number | null;
  laneCount: number;
  segments: DistributionSegment[];
}

export interface LineDistribution {
  rows: MemberDistribution[];
  sortedLines: VocalLine[];
  spanSec: number;
  totalUniqueSeconds: number;
  totalMemberSeconds: number;
  lineCount: number;
  kindCounts: LineKindCounts;
}

export function lineDuration(line: VocalLine): number {
  return Math.max(0, line.endSec - line.startSec);
}

/**
 * Returns every line that is active at `timeSec`. Starts are inclusive and
 * ends are exclusive, so overlapping ad-libs are all reported and a line
 * never lingers past its end.
 */
export function linesAtTime(lines: VocalLine[], timeSec: number): VocalLine[] {
  return lines.filter(
    (line) =>
      timeSec >= line.startSec - EPSILON && timeSec < line.endSec - EPSILON,
  );
}

function sortLines(lines: VocalLine[]): VocalLine[] {
  return [...lines].sort(
    (a, b) => a.startSec - b.startSec || a.endSec - b.endSec || a.id.localeCompare(b.id),
  );
}

/**
 * Builds the per-member line distribution for a song.
 *
 * Every member credited on a line receives the full duration of that line —
 * shared lines are not split. Ad-libs count exactly like sung lines. Members
 * without any lines are still included so the chart can show an empty row.
 */
export function buildLineDistribution(song: Song, members: Member[]): LineDistribution {
  const rowByMember = new Map<string, MemberDistribution>();
  const rosterOrder = new Map<string, number>();

  members.forEach((member, index) => {
    if (rowByMember.has(member.id)) return;
    rosterOrder.set(member.id, index);
    rowByMember.set(member.id, {
      memberId: member.id,
      totalSeconds: 0,
      share: 0,
      lineCount: 0,
      kindCounts: emptyKindCounts(),
      firstSec: null,
      lastSec: null,
      averageSec: null,
      laneCount: 0,
      segments: [],
    });
  });

  const sortedLines = sortLines(song.lines);
  const kindCounts = emptyKindCounts();
  let totalUniqueSeconds = 0;

  for (const line of sortedLines) {
    kindCounts[line.kind] += 1;
    const duration = lineDuration(line);
    if (duration <= 0) continue;
    totalUniqueSeconds += duration;

    const credited = new Set<string>();
    for (const memberId of line.memberIds) {
      if (credited.has(memberId)) continue;
      credited.add(memberId);
      const row = rowByMember.get(memberId);
      if (!row) continue;
      row.segments.push({ line, lane: 0 });
      row.totalSeconds += duration;
      row.lineCount += 1;
      row.kindCounts[line.kind] += 1;
      row.firstSec =
        row.firstSec === null ? line.startSec : Math.min(row.firstSec, line.startSec);
      row.lastSec = row.lastSec === null ? line.endSec : Math.max(row.lastSec, line.endSec);
    }
  }

  let totalMemberSeconds = 0;
  const rows = [...rowByMember.values()];

  for (const row of rows) {
    totalMemberSeconds += row.totalSeconds;

    row.segments.sort(
      (a, b) =>
        a.line.startSec - b.line.startSec ||
        a.line.endSec - b.line.endSec ||
        a.line.id.localeCompare(b.line.id),
    );

    const laneEnds: number[] = [];
    for (const segment of row.segments) {
      let lane = laneEnds.findIndex((end) => end <= segment.line.startSec + EPSILON);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(segment.line.endSec);
      } else {
        laneEnds[lane] = segment.line.endSec;
      }
      segment.lane = lane;
    }
    row.laneCount = laneEnds.length;

    if (row.totalSeconds > 0) {
      let weightedMidpoint = 0;
      for (const segment of row.segments) {
        const duration = lineDuration(segment.line);
        weightedMidpoint += ((segment.line.startSec + segment.line.endSec) / 2) * duration;
      }
      row.averageSec = weightedMidpoint / row.totalSeconds;
    }
  }

  for (const row of rows) {
    row.share = totalMemberSeconds > 0 ? row.totalSeconds / totalMemberSeconds : 0;
  }

  rows.sort(
    (a, b) => (rosterOrder.get(a.memberId) ?? 0) - (rosterOrder.get(b.memberId) ?? 0),
  );

  const latestLineEnd = sortedLines.reduce((latest, line) => Math.max(latest, line.endSec), 0);
  const spanSec = Math.max(song.durationSec, latestLineEnd, 1);

  return {
    rows,
    sortedLines,
    spanSec,
    totalUniqueSeconds,
    totalMemberSeconds,
    lineCount: sortedLines.length,
    kindCounts,
  };
}

export function sortDistributionRows(
  rows: MemberDistribution[],
  members: Member[],
  mode: 'time' | 'roster' | 'average',
): MemberDistribution[] {
  const rosterOrder = new Map(members.map((member, index) => [member.id, index]));
  const sorted = [...rows];
  if (mode === 'roster') {
    sorted.sort(
      (a, b) => (rosterOrder.get(a.memberId) ?? 0) - (rosterOrder.get(b.memberId) ?? 0),
    );
    return sorted;
  }
  if (mode === 'average') {
    sorted.sort((a, b) => {
      if (a.averageSec === null && b.averageSec === null) {
        return (rosterOrder.get(a.memberId) ?? 0) - (rosterOrder.get(b.memberId) ?? 0);
      }
      if (a.averageSec === null) return 1;
      if (b.averageSec === null) return -1;
      return (
        a.averageSec - b.averageSec ||
        (rosterOrder.get(a.memberId) ?? 0) - (rosterOrder.get(b.memberId) ?? 0)
      );
    });
    return sorted;
  }
  sorted.sort(
    (a, b) =>
      b.totalSeconds - a.totalSeconds ||
      (rosterOrder.get(a.memberId) ?? 0) - (rosterOrder.get(b.memberId) ?? 0),
  );
  return sorted;
}
