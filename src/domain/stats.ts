import type { Group, Song, Workspace } from './schema';

export interface ChoreoCounts {
  sections: number;
  formations: number;
  seconds: number;
}

export interface WorkspaceStats {
  groups: number;
  members: number;
  songs: number;
  sections: number;
  formations: number;
  choreoSeconds: number;
}

export function choreoCounts(song: Song): ChoreoCounts {
  let formations = 0;
  let seconds = 0;
  for (const section of song.sections) {
    for (const formation of section.formations) {
      formations += 1;
      seconds += Math.max(0, formation.endSec - formation.startSec);
    }
  }
  return { sections: song.sections.length, formations, seconds };
}

export function groupStats(group: Group): WorkspaceStats {
  let sections = 0;
  let formations = 0;
  let choreoSeconds = 0;
  for (const song of group.songs) {
    const counts = choreoCounts(song);
    sections += counts.sections;
    formations += counts.formations;
    choreoSeconds += counts.seconds;
  }
  return {
    groups: 1,
    members: group.members.length,
    songs: group.songs.length,
    sections,
    formations,
    choreoSeconds,
  };
}

export function workspaceStats(workspace: Workspace): WorkspaceStats {
  return workspace.groups.reduce<WorkspaceStats>(
    (total, group) => {
      const stats = groupStats(group);
      return {
        groups: total.groups + 1,
        members: total.members + stats.members,
        songs: total.songs + stats.songs,
        sections: total.sections + stats.sections,
        formations: total.formations + stats.formations,
        choreoSeconds: total.choreoSeconds + stats.choreoSeconds,
      };
    },
    { groups: 0, members: 0, songs: 0, sections: 0, formations: 0, choreoSeconds: 0 },
  );
}
