import { create } from 'zustand';
import { get, set } from 'idb-keyval';
import {
  workspaceSchema,
  createEmptyWorkspace,
  type Group,
  type LineKind,
  type Workspace,
} from '../domain/schema';
import { validateWorkspaceIntegrity } from '../domain/integrity';
import { migrateLegacyMemberColors } from '../domain/migrations';
import { assignRandomMemberColors, randomUnusedMemberColor } from '../domain/colors';
import {
  createFormation,
  createGroup,
  createLine,
  createMember,
  createSection,
  createSong,
} from '../domain/factories';
import { newId } from '../lib/id';

export const STORAGE_KEY = 'idolytics.workspace.v1';
export const CORRUPT_BACKUP_KEY = 'idolytics.corrupt-backup.v1';
const HISTORY_LIMIT = 80;
const COALESCE_MS = 800;
const EPSILON = 1e-6;
const MAX_TIME = 60 * 60 * 12;
const MAX_LINE_TEXT = 300;
const MAX_MEMBERS = 60;
const MAX_MEMBER_NAME = 80;

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface LineInput {
  startSec: number;
  endSec: number;
  memberIds: string[];
  kind: LineKind;
  lyric?: string;
  note?: string;
}

function cleanLineInput(group: Group, input: LineInput): LineInput | null {
  const { startSec, endSec } = input;
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return null;
  if (startSec < 0 || endSec > MAX_TIME || endSec <= startSec) return null;
  if (input.kind !== 'sung' && input.kind !== 'adlib') return null;

  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) return null;
  const knownMembers = new Set(group.members.map((member) => member.id));
  if (memberIds.some((memberId) => !knownMembers.has(memberId))) return null;

  const lyric = typeof input.lyric === 'string' ? input.lyric.trim().slice(0, MAX_LINE_TEXT) : '';
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, MAX_LINE_TEXT) : '';

  return {
    startSec,
    endSec,
    memberIds,
    kind: input.kind,
    ...(lyric ? { lyric } : {}),
    ...(note ? { note } : {}),
  };
}

interface WorkspaceState {
  workspace: Workspace;
  hydrated: boolean;
  hydrationError: string | null;
  saveStatus: SaveStatus;
  past: Workspace[];
  future: Workspace[];
  lastAction: { label: string; at: number } | null;
  hydrate: () => Promise<void>;
  setSaveStatus: (status: SaveStatus) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  replaceWorkspace: (workspace: Workspace) => void;
  resetWorkspace: () => void;
  createGroup: (name: string) => string;
  updateGroup: (groupId: string, patch: { name?: string }) => void;
  deleteGroup: (groupId: string) => void;
  createMember: (
    groupId: string,
    name: string,
    face: string | null,
    color?: string,
  ) => string | null;
  createMembers: (
    groupId: string,
    entries: Array<{ name: string; face?: string | null }>,
  ) => string[];
  updateMember: (
    groupId: string,
    memberId: string,
    patch: { name?: string; face?: string | null; color?: string },
  ) => void;
  deleteMember: (groupId: string, memberId: string) => void;
  createSong: (
    groupId: string,
    title: string,
    durationSec: number,
    sourceUrl?: string | null,
  ) => string | null;
  updateSong: (
    groupId: string,
    songId: string,
    patch: {
      title?: string;
      durationSec?: number;
      videoFileName?: string | null;
      audioFileName?: string | null;
      sourceUrl?: string | null;
    },
  ) => void;
  deleteSong: (groupId: string, songId: string) => void;
  addLine: (groupId: string, songId: string, input: LineInput) => string | null;
  updateLine: (
    groupId: string,
    songId: string,
    lineId: string,
    patch: Partial<LineInput>,
  ) => boolean;
  deleteLine: (groupId: string, songId: string, lineId: string) => void;
  setGrid: (groupId: string, songId: string, cols: number, rows: number) => number;
  addSection: (
    groupId: string,
    songId: string,
    label: string,
    startSec: number,
    endSec: number,
  ) => string | null;
  updateSection: (
    groupId: string,
    songId: string,
    sectionId: string,
    patch: { label?: string; startSec?: number; endSec?: number },
  ) => boolean;
  deleteSection: (groupId: string, songId: string, sectionId: string) => void;
  addFormation: (groupId: string, songId: string, sectionId: string) => string | null;
  duplicateFormation: (
    groupId: string,
    songId: string,
    sectionId: string,
    formationId: string,
  ) => string | null;
  updateFormationTimes: (
    groupId: string,
    songId: string,
    sectionId: string,
    formationId: string,
    startSec: number,
    endSec: number,
  ) => boolean;
  deleteFormation: (
    groupId: string,
    songId: string,
    sectionId: string,
    formationId: string,
  ) => void;
  placeMember: (
    groupId: string,
    songId: string,
    sectionId: string,
    formationId: string,
    memberId: string,
    col: number,
    row: number,
  ) => boolean;
  removePlacement: (
    groupId: string,
    songId: string,
    sectionId: string,
    formationId: string,
    memberId: string,
  ) => void;
  setPosture: (
    groupId: string,
    songId: string,
    sectionId: string,
    formationId: string,
    memberId: string,
    postureId: string,
  ) => void;
  toggleAnchor: (
    groupId: string,
    songId: string,
    sectionId: string,
    formationId: string,
    memberId: string,
  ) => void;
  addPosture: (label: string, height: number) => string;
  updatePosture: (postureId: string, patch: { label?: string; height?: number }) => void;
  deletePosture: (postureId: string) => boolean;
}

function mergeSavedAt(workspace: Workspace): Workspace {
  return { ...workspace, savedAt: new Date().toISOString() };
}

export function serializeWorkspace(workspace: Workspace): string {
  return JSON.stringify(mergeSavedAt(workspace), null, 2);
}

export const useWorkspaceStore = create<WorkspaceState>((setState, getState) => {
  const commit = (label: string, updater: (draft: Workspace) => void) => {
    const previous = getState().workspace;
    const draft = structuredClone(previous) as Workspace;
    updater(draft);
    const now = Date.now();
    const lastAction = getState().lastAction;
    const coalesce =
      lastAction !== null && lastAction.label === label && now - lastAction.at < COALESCE_MS;
    setState((state) => ({
      workspace: draft,
      past: coalesce ? state.past : [...state.past, previous].slice(-HISTORY_LIMIT),
      future: [],
      lastAction: { label, at: now },
    }));
  };

  const getGroup = (draft: Workspace, groupId: string) =>
    draft.groups.find((group) => group.id === groupId) ?? null;

  return {
    workspace: createEmptyWorkspace(),
    hydrated: false,
    hydrationError: null,
    saveStatus: 'idle',
    past: [],
    future: [],
    lastAction: null,

    hydrate: async () => {
      try {
        const raw = await get<unknown>(STORAGE_KEY);
        if (!raw) {
          setState({ hydrated: true, saveStatus: 'saved' });
          return;
        }
        const parsed = workspaceSchema.safeParse(raw);
        if (!parsed.success) {
          await set(CORRUPT_BACKUP_KEY, raw);
          setState({
            hydrated: true,
            hydrationError: 'Saved data could not be read. A backup was kept in this browser.',
            saveStatus: 'error',
          });
          return;
        }
        const integrityErrors = validateWorkspaceIntegrity(parsed.data);
        if (integrityErrors.length > 0) {
          await set(CORRUPT_BACKUP_KEY, raw);
          setState({
            hydrated: true,
            hydrationError: `Saved data is inconsistent: ${integrityErrors[0]}`,
            saveStatus: 'error',
          });
          return;
        }
        setState({
          workspace: migrateLegacyMemberColors(parsed.data),
          hydrated: true,
          saveStatus: 'saved',
        });
      } catch (error) {
        setState({
          hydrated: true,
          hydrationError: error instanceof Error ? error.message : 'Could not load saved data.',
          saveStatus: 'error',
        });
      }
    },

    setSaveStatus: (status) => setState({ saveStatus: status }),

    undo: () => {
      const { past, future, workspace } = getState();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      setState({
        workspace: previous,
        past: past.slice(0, -1),
        future: [workspace, ...future].slice(0, HISTORY_LIMIT),
        lastAction: null,
      });
    },

    redo: () => {
      const { past, future, workspace } = getState();
      if (future.length === 0) return;
      const next = future[0];
      setState({
        workspace: next,
        past: [...past, workspace].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        lastAction: null,
      });
    },

    canUndo: () => getState().past.length > 0,
    canRedo: () => getState().future.length > 0,

    replaceWorkspace: (workspace) => {
      setState({
        workspace: structuredClone(migrateLegacyMemberColors(workspace)),
        past: [],
        future: [],
        hydrated: true,
        hydrationError: null,
        saveStatus: 'saved',
      });
    },

    resetWorkspace: () => {
      setState({
        workspace: createEmptyWorkspace(),
        past: [],
        future: [],
        hydrated: true,
        hydrationError: null,
        saveStatus: 'saved',
      });
    },

    createGroup: (name) => {
      const group = createGroup(name);
      commit('create-group', (draft) => {
        draft.groups.push(group);
      });
      return group.id;
    },

    updateGroup: (groupId, patch) => {
      commit(`update-group:${groupId}`, (draft) => {
        const group = getGroup(draft, groupId);
        if (!group) return;
        if (patch.name !== undefined) group.name = patch.name;
      });
    },

    deleteGroup: (groupId) => {
      commit(`delete-group:${groupId}`, (draft) => {
        draft.groups = draft.groups.filter((group) => group.id !== groupId);
      });
    },

    createMember: (groupId, name, face, color) => {
      const group = getGroup(getState().workspace, groupId);
      if (!group) return null;
      if (group.members.length >= MAX_MEMBERS) return null;
      const member = createMember(name, 0);
      member.face = face;
      member.color = color || randomUnusedMemberColor(group.members);
      commit('create-member', (draft) => {
        getGroup(draft, groupId)?.members.push(member);
      });
      return member.id;
    },

    createMembers: (groupId, entries) => {
      const group = getGroup(getState().workspace, groupId);
      if (!group) return [];
      const remainingSlots = Math.max(0, MAX_MEMBERS - group.members.length);
      const cleaned = entries
        .map((entry) => ({
          name: entry.name.trim().slice(0, MAX_MEMBER_NAME),
          face: entry.face ?? null,
        }))
        .filter((entry) => entry.name.length > 0)
        .slice(0, remainingSlots);
      if (cleaned.length === 0) return [];

      const colors = assignRandomMemberColors(group.members, cleaned.length);
      const members = cleaned.map((entry, index) => {
        const member = createMember(entry.name, 0);
        member.face = entry.face;
        member.color = colors[index];
        return member;
      });
      commit('create-members', (draft) => {
        getGroup(draft, groupId)?.members.push(...members);
      });
      return members.map((member) => member.id);
    },

    updateMember: (groupId, memberId, patch) => {
      commit(`update-member:${groupId}:${memberId}`, (draft) => {
        const member = getGroup(draft, groupId)?.members.find((entry) => entry.id === memberId);
        if (!member) return;
        if (patch.name !== undefined) member.name = patch.name;
        if (patch.face !== undefined) member.face = patch.face;
        if (patch.color !== undefined) member.color = patch.color;
      });
    },

    deleteMember: (groupId, memberId) => {
      commit(`delete-member:${groupId}:${memberId}`, (draft) => {
        const group = getGroup(draft, groupId);
        if (!group) return;
        group.members = group.members.filter((member) => member.id !== memberId);
        for (const song of group.songs) {
          song.lines = song.lines
            .map((line) => ({
              ...line,
              memberIds: line.memberIds.filter((id) => id !== memberId),
            }))
            .filter((line) => line.memberIds.length > 0);
          for (const section of song.sections) {
            for (const formation of section.formations) {
              formation.placements = formation.placements.filter(
                (placement) => placement.memberId !== memberId,
              );
              formation.anchors = formation.anchors.filter((anchorId) => anchorId !== memberId);
            }
          }
        }
      });
    },

    createSong: (groupId, title, durationSec, sourceUrl) => {
      if (!getGroup(getState().workspace, groupId)) return null;
      const song = createSong(title, durationSec, sourceUrl ?? null);
      commit('create-song', (draft) => {
        getGroup(draft, groupId)?.songs.push(song);
      });
      return song.id;
    },

    updateSong: (groupId, songId, patch) => {
      commit(`update-song:${groupId}:${songId}`, (draft) => {
        const song = getGroup(draft, groupId)?.songs.find((entry) => entry.id === songId);
        if (!song) return;
        if (patch.title !== undefined) song.title = patch.title;
        if (patch.durationSec !== undefined) song.durationSec = patch.durationSec;
        if (patch.videoFileName !== undefined) song.videoFileName = patch.videoFileName;
        if (patch.audioFileName !== undefined) song.audioFileName = patch.audioFileName;
        if (patch.sourceUrl !== undefined) song.sourceUrl = patch.sourceUrl;
      });
    },

    deleteSong: (groupId, songId) => {
      commit(`delete-song:${groupId}:${songId}`, (draft) => {
        const group = getGroup(draft, groupId);
        if (!group) return;
        group.songs = group.songs.filter((song) => song.id !== songId);
      });
    },

    addLine: (groupId, songId, input) => {
      const group = getGroup(getState().workspace, groupId);
      if (!group) return null;
      const song = group.songs.find((entry) => entry.id === songId);
      if (!song) return null;
      const cleaned = cleanLineInput(group, input);
      if (!cleaned) return null;
      const line = createLine(
        cleaned.startSec,
        cleaned.endSec,
        cleaned.memberIds,
        cleaned.kind,
        cleaned.lyric,
        cleaned.note,
      );
      commit(`add-line:${groupId}:${songId}`, (draft) => {
        getGroup(draft, groupId)
          ?.songs.find((entry) => entry.id === songId)
          ?.lines.push(line);
      });
      return line.id;
    },

    updateLine: (groupId, songId, lineId, patch) => {
      const group = getGroup(getState().workspace, groupId);
      const song = group?.songs.find((entry) => entry.id === songId);
      const line = song?.lines.find((entry) => entry.id === lineId);
      if (!group || !song || !line) return false;
      const merged: LineInput = {
        startSec: patch.startSec ?? line.startSec,
        endSec: patch.endSec ?? line.endSec,
        memberIds: patch.memberIds ?? line.memberIds,
        kind: patch.kind ?? line.kind,
        lyric: patch.lyric !== undefined ? patch.lyric : line.lyric,
        note: patch.note !== undefined ? patch.note : line.note,
      };
      const cleaned = cleanLineInput(group, merged);
      if (!cleaned) return false;
      commit(`update-line:${groupId}:${songId}:${lineId}`, (draft) => {
        const target = getGroup(draft, groupId)
          ?.songs.find((entry) => entry.id === songId)
          ?.lines.find((entry) => entry.id === lineId);
        if (!target) return;
        target.startSec = cleaned.startSec;
        target.endSec = cleaned.endSec;
        target.memberIds = [...cleaned.memberIds];
        target.kind = cleaned.kind;
        if (cleaned.lyric) target.lyric = cleaned.lyric;
        else delete target.lyric;
        if (cleaned.note) target.note = cleaned.note;
        else delete target.note;
      });
      return true;
    },

    deleteLine: (groupId, songId, lineId) => {
      commit(`delete-line:${groupId}:${songId}:${lineId}`, (draft) => {
        const song = getGroup(draft, groupId)?.songs.find((entry) => entry.id === songId);
        if (!song) return;
        song.lines = song.lines.filter((line) => line.id !== lineId);
      });
    },

    setGrid: (groupId, songId, cols, rows) => {
      let removed = 0;
      commit(`set-grid:${groupId}:${songId}`, (draft) => {
        const song = getGroup(draft, groupId)?.songs.find((entry) => entry.id === songId);
        if (!song) return;
        song.grid = { cols, rows };
        for (const section of song.sections) {
          for (const formation of section.formations) {
            const before = formation.placements.length;
            formation.placements = formation.placements.filter(
              (placement) =>
                placement.col >= 0 &&
                placement.col < cols &&
                placement.row >= 0 &&
                placement.row < rows,
            );
            const removedIds = new Set(
              formation.placements.map((placement) => placement.memberId),
            );
            formation.anchors = formation.anchors.filter((anchorId) => removedIds.has(anchorId));
            removed += before - formation.placements.length;
          }
        }
      });
      return removed;
    },

    addSection: (groupId, songId, label, startSec, endSec) => {
      const group = getGroup(getState().workspace, groupId);
      const song = group?.songs.find((entry) => entry.id === songId);
      if (!song) return null;
      if (endSec <= startSec) return null;
      for (const section of song.sections) {
        if (startSec < section.endSec - EPSILON && endSec > section.startSec + EPSILON) return null;
      }
      const section = createSection(label, startSec, endSec);
      section.formations.push(createFormation(startSec, endSec));
      commit(`add-section:${groupId}:${songId}`, (draft) => {
        getGroup(draft, groupId)?.songs.find((entry) => entry.id === songId)?.sections.push(section);
      });
      return section.id;
    },

    updateSection: (groupId, songId, sectionId, patch) => {
      const group = getGroup(getState().workspace, groupId);
      const song = group?.songs.find((entry) => entry.id === songId);
      const section = song?.sections.find((entry) => entry.id === sectionId);
      if (!song || !section) return false;
      const nextStart = patch.startSec ?? section.startSec;
      const nextEnd = patch.endSec ?? section.endSec;
      if (nextEnd <= nextStart) return false;
      for (const other of song.sections) {
        if (other.id === sectionId) continue;
        if (nextStart < other.endSec - EPSILON && nextEnd > other.startSec + EPSILON) return false;
      }
      const delta = nextStart - section.startSec;
      const shifted = section.formations.map((formation) => ({
        startSec: formation.startSec + delta,
        endSec: formation.endSec + delta,
      }));
      if (shifted.some((span) => span.startSec < nextStart - EPSILON || span.endSec > nextEnd + EPSILON)) {
        return false;
      }
      commit(`update-section:${groupId}:${songId}:${sectionId}`, (draft) => {
        const target = getGroup(draft, groupId)
          ?.songs.find((entry) => entry.id === songId)
          ?.sections.find((entry) => entry.id === sectionId);
        if (!target) return;
        if (patch.label !== undefined) target.label = patch.label;
        for (const formation of target.formations) {
          formation.startSec += delta;
          formation.endSec += delta;
        }
        target.startSec = nextStart;
        target.endSec = nextEnd;
      });
      return true;
    },

    deleteSection: (groupId, songId, sectionId) => {
      commit(`delete-section:${groupId}:${songId}:${sectionId}`, (draft) => {
        const song = getGroup(draft, groupId)?.songs.find((entry) => entry.id === songId);
        if (!song) return;
        song.sections = song.sections.filter((section) => section.id !== sectionId);
      });
    },

    addFormation: (groupId, songId, sectionId) => {
      const group = getGroup(getState().workspace, groupId);
      const song = group?.songs.find((entry) => entry.id === songId);
      const section = song?.sections.find((entry) => entry.id === sectionId);
      if (!song || !section) return null;
      const sorted = [...section.formations].sort((a, b) => a.startSec - b.startSec);
      let formation = createFormation(section.startSec, section.endSec);
      let splitLastId: string | null = null;
      let splitAt = 0;
      if (sorted.length > 0) {
        const last = sorted[sorted.length - 1];
        if (last.endSec < section.endSec - 0.5) {
          formation = createFormation(last.endSec, section.endSec);
        } else {
          const lastDuration = last.endSec - last.startSec;
          if (lastDuration < 1) return null;
          splitAt = last.startSec + lastDuration / 2;
          formation = createFormation(splitAt, last.endSec);
          splitLastId = last.id;
        }
      }
      commit(`add-formation:${groupId}:${songId}:${sectionId}`, (draft) => {
        const targetSection = getGroup(draft, groupId)
          ?.songs.find((entry) => entry.id === songId)
          ?.sections.find((entry) => entry.id === sectionId);
        if (!targetSection) return;
        if (splitLastId) {
          const last = targetSection.formations.find((entry) => entry.id === splitLastId);
          if (last) last.endSec = splitAt;
        }
        targetSection.formations.push(formation);
      });
      return formation.id;
    },

    duplicateFormation: (groupId, songId, sectionId, formationId) => {
      const group = getGroup(getState().workspace, groupId);
      const song = group?.songs.find((entry) => entry.id === songId);
      const section = song?.sections.find((entry) => entry.id === sectionId);
      const source = section?.formations.find((entry) => entry.id === formationId);
      if (!song || !section || !source) return null;
      const duration = source.endSec - source.startSec;
      if (duration <= 0) return null;
      const lastEnd = section.formations.reduce(
        (latest, formation) => Math.max(latest, formation.endSec),
        section.startSec,
      );
      if (lastEnd + duration > section.endSec + EPSILON) return null;
      const copy = createFormation(lastEnd, lastEnd + duration);
      copy.placements = source.placements.map((placement) => ({ ...placement }));
      copy.anchors = [...source.anchors];
      commit(`duplicate-formation:${groupId}:${songId}:${sectionId}:${formationId}`, (draft) => {
        getGroup(draft, groupId)
          ?.songs.find((entry) => entry.id === songId)
          ?.sections.find((entry) => entry.id === sectionId)
          ?.formations.push(copy);
      });
      return copy.id;
    },

    updateFormationTimes: (groupId, songId, sectionId, formationId, startSec, endSec) => {
      const group = getGroup(getState().workspace, groupId);
      const song = group?.songs.find((entry) => entry.id === songId);
      const section = song?.sections.find((entry) => entry.id === sectionId);
      const formation = section?.formations.find((entry) => entry.id === formationId);
      if (!section || !formation) return false;
      if (endSec <= startSec) return false;
      if (startSec < section.startSec - EPSILON || endSec > section.endSec + EPSILON) return false;
      for (const other of section.formations) {
        if (other.id === formationId) continue;
        if (startSec < other.endSec - EPSILON && endSec > other.startSec + EPSILON) return false;
      }
      commit(`update-formation:${groupId}:${songId}:${formationId}`, (draft) => {
        const target = getGroup(draft, groupId)
          ?.songs.find((entry) => entry.id === songId)
          ?.sections.find((entry) => entry.id === sectionId)
          ?.formations.find((entry) => entry.id === formationId);
        if (!target) return;
        target.startSec = startSec;
        target.endSec = endSec;
      });
      return true;
    },

    deleteFormation: (groupId, songId, sectionId, formationId) => {
      commit(`delete-formation:${groupId}:${songId}:${formationId}`, (draft) => {
        const section = getGroup(draft, groupId)
          ?.songs.find((entry) => entry.id === songId)
          ?.sections.find((entry) => entry.id === sectionId);
        if (!section) return;
        section.formations = section.formations.filter((formation) => formation.id !== formationId);
      });
    },

    placeMember: (groupId, songId, sectionId, formationId, memberId, col, row) => {
      const group = getGroup(getState().workspace, groupId);
      const song = group?.songs.find((entry) => entry.id === songId);
      const section = song?.sections.find((entry) => entry.id === sectionId);
      const formation = section?.formations.find((entry) => entry.id === formationId);
      if (!song || !formation) return false;
      if (col < 0 || col >= song.grid.cols || row < 0 || row >= song.grid.rows) return false;
      if (!group?.members.some((member) => member.id === memberId)) return false;
      const existing = formation.placements.find((placement) => placement.memberId === memberId);
      const occupant = formation.placements.find(
        (placement) => placement.col === col && placement.row === row,
      );
      if (!existing && occupant) return false;
      commit(`move-member:${groupId}:${songId}:${formationId}:${memberId}`, (draft) => {
        const targetFormation = getGroup(draft, groupId)
          ?.songs.find((entry) => entry.id === songId)
          ?.sections.find((entry) => entry.id === sectionId)
          ?.formations.find((entry) => entry.id === formationId);
        if (!targetFormation) return;
        const target = targetFormation.placements.find(
          (placement) => placement.memberId === memberId,
        );
        if (!target) {
          targetFormation.placements.push({
            memberId,
            col,
            row,
            postureId: draft.settings.postures[0]?.id ?? 'standing',
          });
          if (targetFormation.anchors.length === 0) targetFormation.anchors.push(memberId);
          return;
        }
        if (occupant && occupant.memberId !== memberId) {
          const other = targetFormation.placements.find(
            (placement) => placement.memberId === occupant.memberId,
          );
          if (other) {
            const oldCol = target.col;
            const oldRow = target.row;
            other.col = oldCol;
            other.row = oldRow;
          }
        }
        target.col = col;
        target.row = row;
      });
      return true;
    },

    removePlacement: (groupId, songId, sectionId, formationId, memberId) => {
      commit(`remove-member:${groupId}:${songId}:${formationId}:${memberId}`, (draft) => {
        const formation = getGroup(draft, groupId)
          ?.songs.find((entry) => entry.id === songId)
          ?.sections.find((entry) => entry.id === sectionId)
          ?.formations.find((entry) => entry.id === formationId);
        if (!formation) return;
        formation.placements = formation.placements.filter(
          (placement) => placement.memberId !== memberId,
        );
        formation.anchors = formation.anchors.filter((anchorId) => anchorId !== memberId);
      });
    },

    setPosture: (groupId, songId, sectionId, formationId, memberId, postureId) => {
      commit(`posture:${groupId}:${songId}:${formationId}:${memberId}`, (draft) => {
        const formation = getGroup(draft, groupId)
          ?.songs.find((entry) => entry.id === songId)
          ?.sections.find((entry) => entry.id === sectionId)
          ?.formations.find((entry) => entry.id === formationId);
        const placement = formation?.placements.find((entry) => entry.memberId === memberId);
        if (!placement) return;
        placement.postureId = postureId;
      });
    },

    toggleAnchor: (groupId, songId, sectionId, formationId, memberId) => {
      commit(`anchor:${groupId}:${songId}:${formationId}:${memberId}`, (draft) => {
        const formation = getGroup(draft, groupId)
          ?.songs.find((entry) => entry.id === songId)
          ?.sections.find((entry) => entry.id === sectionId)
          ?.formations.find((entry) => entry.id === formationId);
        if (!formation || !formation.placements.some((entry) => entry.memberId === memberId)) {
          return;
        }
        if (formation.anchors.includes(memberId)) {
          formation.anchors = formation.anchors.filter((anchorId) => anchorId !== memberId);
        } else {
          formation.anchors.push(memberId);
        }
      });
    },

    addPosture: (label, height) => {
      const posture = { id: newId('pst'), label, height };
      commit('add-posture', (draft) => {
        draft.settings.postures.push(posture);
      });
      return posture.id;
    },

    updatePosture: (postureId, patch) => {
      commit(`update-posture:${postureId}`, (draft) => {
        const posture = draft.settings.postures.find((entry) => entry.id === postureId);
        if (!posture) return;
        if (patch.label !== undefined) posture.label = patch.label;
        if (patch.height !== undefined) posture.height = patch.height;
      });
    },

    deletePosture: (postureId) => {
      const workspace = getState().workspace;
      if (workspace.settings.postures.length <= 1) return false;
      const inUse = workspace.groups.some((group) =>
        group.songs.some((song) =>
          song.sections.some((section) =>
            section.formations.some((formation) =>
              formation.placements.some((placement) => placement.postureId === postureId),
            ),
          ),
        ),
      );
      if (inUse) return false;
      commit(`delete-posture:${postureId}`, (draft) => {
        draft.settings.postures = draft.settings.postures.filter(
          (posture) => posture.id !== postureId,
        );
      });
      return true;
    },
  };
});
