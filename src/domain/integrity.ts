import type { Workspace } from './schema';

const EPSILON = 1e-6;

export function validateWorkspaceIntegrity(workspace: Workspace): string[] {
  const errors: string[] = [];
  const postureIds = new Set<string>();
  for (const posture of workspace.settings.postures) {
    if (postureIds.has(posture.id)) errors.push(`Duplicate posture id "${posture.id}".`);
    postureIds.add(posture.id);
  }
  if (workspace.settings.postures.length === 0) {
    errors.push('At least one posture is required.');
  }

  const seenIds = new Set<string>();
  const claimId = (id: string, path: string) => {
    if (seenIds.has(id)) errors.push(`${path}: duplicate id "${id}".`);
    seenIds.add(id);
  };

  for (const group of workspace.groups) {
    claimId(group.id, `Group "${group.name || group.id}"`);
    const memberIds = new Set<string>();
    for (const member of group.members) {
      claimId(member.id, `Group "${group.name || group.id}" member "${member.name || member.id}"`);
      if (memberIds.has(member.id)) {
        errors.push(`Group "${group.name || group.id}": duplicate member id "${member.id}".`);
      }
      memberIds.add(member.id);
    }

    const songIds = new Set<string>();
    for (const song of group.songs) {
      claimId(song.id, `Song "${song.title || song.id}"`);
      if (songIds.has(song.id)) {
        errors.push(`Group "${group.name || group.id}": duplicate song id "${song.id}".`);
      }
      songIds.add(song.id);

      for (const line of song.lines) {
        claimId(line.id, `Song "${song.title || song.id}" line "${line.id}"`);
        const linePath = `Song "${song.title || song.id}" line "${line.id}"`;
        if (line.endSec <= line.startSec) {
          errors.push(`${linePath}: end time must be after start time.`);
        }
        if (line.startSec < 0 || line.endSec > 60 * 60 * 12) {
          errors.push(`${linePath}: times must stay within 12 hours.`);
        }
        if (line.memberIds.length === 0) {
          errors.push(`${linePath}: needs at least one member.`);
        }
        const lineMembers = new Set<string>();
        for (const memberId of line.memberIds) {
          if (lineMembers.has(memberId)) {
            errors.push(`${linePath}: member "${memberId}" is listed twice.`);
          }
          lineMembers.add(memberId);
          if (!memberIds.has(memberId)) {
            errors.push(`${linePath}: unknown member "${memberId}".`);
          }
        }
      }

      const allFormations: { start: number; end: number; label: string; formationId: string }[] = [];

      for (const section of song.sections) {
        claimId(section.id, `Song "${song.title || song.id}" section "${section.label || section.id}"`);
        const sectionPath = `Song "${song.title || song.id}" section "${section.label || section.id}"`;
        if (section.endSec <= section.startSec) {
          errors.push(`${sectionPath}: end time must be after start time.`);
        }
        for (const formation of section.formations) {
          claimId(formation.id, `${sectionPath} formation "${formation.id}"`);
          const formationPath = `${sectionPath} formation "${formation.id}"`;
          if (formation.endSec <= formation.startSec) {
            errors.push(`${formationPath}: end time must be after start time.`);
          }
          if (formation.startSec < section.startSec - EPSILON) {
            errors.push(`${formationPath}: starts before its section.`);
          }
          if (formation.endSec > section.endSec + EPSILON) {
            errors.push(`${formationPath}: ends after its section.`);
          }
          allFormations.push({
            start: formation.startSec,
            end: formation.endSec,
            label: formation.id,
            formationId: formation.id,
          });

          const placedMembers = new Set<string>();
          const cells = new Set<string>();
          for (const placement of formation.placements) {
            if (!memberIds.has(placement.memberId)) {
              errors.push(`${formationPath}: unknown member "${placement.memberId}".`);
            }
            if (!postureIds.has(placement.postureId)) {
              errors.push(`${formationPath}: unknown posture "${placement.postureId}".`);
            }
            if (placement.col < 0 || placement.col >= song.grid.cols) {
              errors.push(`${formationPath}: column ${placement.col} is outside the grid.`);
            }
            if (placement.row < 0 || placement.row >= song.grid.rows) {
              errors.push(`${formationPath}: row ${placement.row} is outside the grid.`);
            }
            if (placedMembers.has(placement.memberId)) {
              errors.push(`${formationPath}: member "${placement.memberId}" is placed twice.`);
            }
            placedMembers.add(placement.memberId);
            const cellKey = `${placement.col}:${placement.row}`;
            if (cells.has(cellKey)) {
              errors.push(`${formationPath}: multiple members in cell ${cellKey}.`);
            }
            cells.add(cellKey);
          }

          const anchorIds = new Set<string>();
          for (const anchorId of formation.anchors) {
            if (anchorIds.has(anchorId)) {
              errors.push(`${formationPath}: duplicate anchor "${anchorId}".`);
            }
            anchorIds.add(anchorId);
            if (!placedMembers.has(anchorId)) {
              errors.push(`${formationPath}: anchor "${anchorId}" is not placed.`);
            }
          }
        }
      }

      const sections = [...song.sections].sort((a, b) => a.startSec - b.startSec);
      for (let index = 1; index < sections.length; index += 1) {
        const previous = sections[index - 1];
        const current = sections[index];
        if (current.startSec < previous.endSec - EPSILON) {
          errors.push(
            `Song "${song.title || song.id}": sections "${previous.label || previous.id}" and "${
              current.label || current.id
            }" overlap.`,
          );
        }
      }

      const formations = allFormations.sort((a, b) => a.start - b.start);
      for (let index = 1; index < formations.length; index += 1) {
        const previous = formations[index - 1];
        const current = formations[index];
        if (current.start < previous.end - EPSILON) {
          errors.push(
            `Song "${song.title || song.id}": formations "${previous.label}" and "${current.label}" overlap.`,
          );
        }
      }
    }
  }

  return errors;
}
