import type { Formation, Group, Posture, Song, Workspace } from './schema';

export interface FormationMemberScore {
  memberId: string;
  ratio: number;
  points: number;
  rank: number;
  distance: number;
  distanceSquared: number;
  isAnchor: boolean;
  hidden: boolean;
  blockedBy: string | null;
}

export interface FormationScore {
  formationId: string;
  durationSec: number;
  memberCount: number;
  hasAnchor: boolean;
  memberScores: FormationMemberScore[];
}

export interface SongScoreRow {
  memberId: string;
  points: number;
  seconds: number;
  percentage: number;
  anchorSeconds: number;
  hiddenSeconds: number;
  placementCount: number;
}

export interface SongScore {
  songId: string;
  durationSec: number;
  formationCount: number;
  formationScores: FormationScore[];
  rows: SongScoreRow[];
}

export interface LeaderboardRow {
  memberId: string;
  memberName: string;
  groupId: string;
  groupName: string;
  color: string;
  face: string | null;
  points: number;
  seconds: number;
  percentage: number;
  anchorSeconds: number;
  hiddenSeconds: number;
  songs: number;
}

export function formationDuration(formation: Formation): number {
  return Math.max(0, formation.endSec - formation.startSec);
}

function postureHeights(postures: Posture[]): Map<string, number> {
  return new Map(postures.map((posture) => [posture.id, posture.height]));
}

export function scoreFormation(formation: Formation, postures: Posture[]): FormationScore {
  const placements = formation.placements;
  const durationSec = formationDuration(formation);
  const memberCount = placements.length;
  const heights = postureHeights(postures);
  const placedIds = new Set(placements.map((placement) => placement.memberId));
  const validAnchors = formation.anchors.filter((anchorId) => placedIds.has(anchorId));
  const hasAnchor = validAnchors.length > 0;

  const blockerByMember = new Map<string, string | null>();
  for (const placement of placements) {
    const ownHeight = heights.get(placement.postureId) ?? 0;
    let blocker: string | null = null;
    let blockerRow = -Infinity;
    for (const other of placements) {
      if (other.memberId === placement.memberId) continue;
      if (other.col !== placement.col) continue;
      if (other.row >= placement.row) continue;
      const otherHeight = heights.get(other.postureId) ?? 0;
      if (otherHeight < ownHeight) continue;
      if (other.row > blockerRow) {
        blockerRow = other.row;
        blocker = other.memberId;
      }
    }
    blockerByMember.set(placement.memberId, blocker);
  }

  const anchorDistance = new Map<string, number>();
  if (hasAnchor) {
    for (const placement of placements) {
      let best = Number.POSITIVE_INFINITY;
      for (const anchorId of validAnchors) {
        const anchor = placements.find((candidate) => candidate.memberId === anchorId);
        if (!anchor) continue;
        const dCol = placement.col - anchor.col;
        const dRow = placement.row - anchor.row;
        const distanceSquared = dCol * dCol + dRow * dRow;
        if (distanceSquared < best) best = distanceSquared;
      }
      anchorDistance.set(placement.memberId, best);
    }
  }

  const uniqueDistances = Array.from(new Set(anchorDistance.values())).sort((a, b) => a - b);
  const rankByDistance = new Map<number, number>();
  uniqueDistances.forEach((distance, index) => rankByDistance.set(distance, index));

  const memberScores: FormationMemberScore[] = placements.map((placement) => {
    const distanceSquared = anchorDistance.get(placement.memberId) ?? 0;
    const rank = hasAnchor ? (rankByDistance.get(distanceSquared) ?? 0) : 0;
    const blockedBy = blockerByMember.get(placement.memberId) ?? null;
    const hidden = blockedBy !== null;
    const baseRatio = hasAnchor && memberCount > 0 ? Math.max(0, (memberCount - rank) / memberCount) : 0;
    const ratio = hidden ? 0 : baseRatio;
    return {
      memberId: placement.memberId,
      ratio,
      points: ratio * durationSec,
      rank,
      distance: Math.sqrt(distanceSquared),
      distanceSquared,
      isAnchor: validAnchors.includes(placement.memberId),
      hidden,
      blockedBy,
    };
  });

  return {
    formationId: formation.id,
    durationSec,
    memberCount,
    hasAnchor,
    memberScores,
  };
}

export function scoreSong(song: Song, postures: Posture[]): SongScore {
  const formationScores = song.sections.flatMap((section) =>
    section.formations.map((formation) => scoreFormation(formation, postures)),
  );
  const durationSec = formationScores.reduce((total, formation) => total + formation.durationSec, 0);
  const participantIds = new Set<string>();
  for (const section of song.sections) {
    for (const formation of section.formations) {
      for (const placement of formation.placements) participantIds.add(placement.memberId);
    }
  }

  const rows: SongScoreRow[] = [];
  for (const memberId of participantIds) {
    let points = 0;
    let anchorSeconds = 0;
    let hiddenSeconds = 0;
    let placementCount = 0;
    for (const formationScore of formationScores) {
      const member = formationScore.memberScores.find((score) => score.memberId === memberId);
      if (!member) continue;
      placementCount += 1;
      points += member.points;
      if (member.isAnchor) anchorSeconds += formationScore.durationSec;
      if (member.hidden) hiddenSeconds += formationScore.durationSec;
    }
    rows.push({
      memberId,
      points,
      seconds: durationSec,
      percentage: durationSec > 0 ? (points / durationSec) * 100 : 0,
      anchorSeconds,
      hiddenSeconds,
      placementCount,
    });
  }

  rows.sort(
    (a, b) => b.percentage - a.percentage || b.points - a.points || a.memberId.localeCompare(b.memberId),
  );

  return {
    songId: song.id,
    durationSec,
    formationCount: formationScores.length,
    formationScores,
    rows,
  };
}

export function buildGroupLeaderboard(group: Group, postures: Posture[]): LeaderboardRow[] {
  const memberById = new Map(group.members.map((member) => [member.id, member]));
  const accumulator = new Map<string, LeaderboardRow>();

  for (const song of group.songs) {
    if (song.sections.length === 0) continue;
    const score = scoreSong(song, postures);
    if (score.durationSec === 0) continue;
    for (const row of score.rows) {
      const member = memberById.get(row.memberId);
      if (!member) continue;
      const existing = accumulator.get(row.memberId) ?? {
        memberId: member.id,
        memberName: member.name || 'Unnamed member',
        groupId: group.id,
        groupName: group.name || 'Unnamed group',
        color: member.color,
        face: member.face,
        points: 0,
        seconds: 0,
        percentage: 0,
        anchorSeconds: 0,
        hiddenSeconds: 0,
        songs: 0,
      };
      existing.points += row.points;
      existing.seconds += row.seconds;
      existing.anchorSeconds += row.anchorSeconds;
      existing.hiddenSeconds += row.hiddenSeconds;
      existing.songs += 1;
      accumulator.set(row.memberId, existing);
    }
  }

  return Array.from(accumulator.values())
    .map((row) => ({
      ...row,
      percentage: row.seconds > 0 ? (row.points / row.seconds) * 100 : 0,
    }))
    .sort(
      (a, b) =>
        b.percentage - a.percentage ||
        b.points - a.points ||
        a.memberName.localeCompare(b.memberName),
    );
}

export function buildGlobalLeaderboard(workspace: Workspace): LeaderboardRow[] {
  const accumulator = new Map<string, LeaderboardRow>();
  for (const group of workspace.groups) {
    for (const row of buildGroupLeaderboard(group, workspace.settings.postures)) {
      const existing = accumulator.get(row.memberId);
      if (!existing) {
        accumulator.set(row.memberId, { ...row });
        continue;
      }
      existing.points += row.points;
      existing.seconds += row.seconds;
      existing.anchorSeconds += row.anchorSeconds;
      existing.hiddenSeconds += row.hiddenSeconds;
      existing.songs += row.songs;
    }
  }

  return Array.from(accumulator.values())
    .map((row) => ({
      ...row,
      percentage: row.seconds > 0 ? (row.points / row.seconds) * 100 : 0,
    }))
    .sort(
      (a, b) =>
        b.percentage - a.percentage ||
        b.points - a.points ||
        a.memberName.localeCompare(b.memberName),
    );
}
