import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyWorkspace, memberColorPalette } from '../domain/schema';
import { useWorkspaceStore } from './workspaceStore';

beforeEach(() => {
  useWorkspaceStore.setState({
    workspace: createEmptyWorkspace(),
    hydrated: true,
    hydrationError: null,
    saveStatus: 'saved',
    past: [],
    future: [],
    lastAction: null,
  });
});

describe('member creation', () => {
  it('creates a pasted list in one undoable step with unique colors', () => {
    const groupId = useWorkspaceStore.getState().createGroup('Test group');
    const pastBefore = useWorkspaceStore.getState().past.length;

    const ids = useWorkspaceStore.getState().createMembers(
      groupId,
      ['Minji', 'Hanni', 'Danielle'].map((name) => ({ name })),
    );

    const state = useWorkspaceStore.getState();
    const group = state.workspace.groups.find((entry) => entry.id === groupId);
    expect(ids).toHaveLength(3);
    expect(group?.members.map((member) => member.name)).toEqual([
      'Minji',
      'Hanni',
      'Danielle',
    ]);
    expect(new Set(group?.members.map((member) => member.color)).size).toBe(3);
    expect(state.past).toHaveLength(pastBefore + 1);

    state.undo();
    const afterUndo = useWorkspaceStore
      .getState()
      .workspace.groups.find((entry) => entry.id === groupId);
    expect(afterUndo?.members).toHaveLength(0);
  });

  it('trims names and skips blank entries', () => {
    const groupId = useWorkspaceStore.getState().createGroup('Test group');
    const ids = useWorkspaceStore.getState().createMembers(groupId, [
      { name: '  Minji  ' },
      { name: '   ' },
      { name: 'Hanni' },
    ]);

    expect(ids).toHaveLength(2);
    expect(
      useWorkspaceStore
        .getState()
        .workspace.groups.find((entry) => entry.id === groupId)
        ?.members.map((member) => member.name),
    ).toEqual(['Minji', 'Hanni']);
  });

  it('assigns an unused color when a single member is created without one', () => {
    const groupId = useWorkspaceStore.getState().createGroup('Test group');
    const createMember = useWorkspaceStore.getState().createMember;

    createMember(groupId, 'Minji', null);
    createMember(groupId, 'Hanni', null);

    const members =
      useWorkspaceStore
        .getState()
        .workspace.groups.find((entry) => entry.id === groupId)?.members ?? [];
    expect(members).toHaveLength(2);
    expect(memberColorPalette).toContain(members[0]?.color);
    expect(memberColorPalette).toContain(members[1]?.color);
    expect(members[0]?.color).not.toBe(members[1]?.color);
  });
});

describe('line kinds', () => {
  it('stores rap and high note parts', () => {
    const store = useWorkspaceStore.getState();
    const groupId = store.createGroup('Test group');
    const memberId = store.createMember(groupId, 'Minji', null);
    const songId = store.createSong(groupId, 'Track', 120);
    expect(memberId).not.toBeNull();
    expect(songId).not.toBeNull();
    if (!memberId || !songId) return;

    const rapId = useWorkspaceStore.getState().addLine(groupId, songId, {
      startSec: 0,
      endSec: 5,
      memberIds: [memberId],
      kind: 'rap',
    });
    const highNoteId = useWorkspaceStore.getState().addLine(groupId, songId, {
      startSec: 5,
      endSec: 9,
      memberIds: [memberId],
      kind: 'highnote',
    });

    expect(rapId).not.toBeNull();
    expect(highNoteId).not.toBeNull();

    const song = useWorkspaceStore
      .getState()
      .workspace.groups.find((entry) => entry.id === groupId)
      ?.songs.find((entry) => entry.id === songId);
    expect(song?.lines.map((line) => line.kind)).toEqual(['rap', 'highnote']);
  });
});

describe('song media references', () => {
  it('stores an audio filename and restores the previous value on undo', () => {
    const groupId = useWorkspaceStore.getState().createGroup('Test group');
    const songId = useWorkspaceStore.getState().createSong(groupId, 'Track', 120);
    expect(songId).not.toBeNull();
    if (!songId) return;

    const findSong = () =>
      useWorkspaceStore
        .getState()
        .workspace.groups.find((entry) => entry.id === groupId)
        ?.songs.find((entry) => entry.id === songId);

    expect(findSong()?.audioFileName).toBeNull();
    useWorkspaceStore
      .getState()
      .updateSong(groupId, songId, { audioFileName: 'track.mp3' });

    expect(findSong()?.audioFileName).toBe('track.mp3');
    expect(findSong()?.videoFileName).toBeNull();

    useWorkspaceStore.getState().undo();
    expect(findSong()?.audioFileName).toBeNull();
  });

  it('stores a source link and restores the previous value on undo', () => {
    const groupId = useWorkspaceStore.getState().createGroup('Test group');
    const songId = useWorkspaceStore
      .getState()
      .createSong(groupId, 'Track', 120, 'https://www.youtube.com/watch?v=example');
    expect(songId).not.toBeNull();
    if (!songId) return;

    const findSong = () =>
      useWorkspaceStore
        .getState()
        .workspace.groups.find((entry) => entry.id === groupId)
        ?.songs.find((entry) => entry.id === songId);

    expect(findSong()?.sourceUrl).toBe('https://www.youtube.com/watch?v=example');
    useWorkspaceStore.getState().updateSong(groupId, songId, { sourceUrl: null });
    expect(findSong()?.sourceUrl).toBeNull();

    useWorkspaceStore.getState().undo();
    expect(findSong()?.sourceUrl).toBe('https://www.youtube.com/watch?v=example');
  });
});

describe('mergeLineIntoExisting', () => {
  const setup = () => {
    const store = useWorkspaceStore.getState();
    const groupId = store.createGroup('Test group');
    const oaId = store.createMember(groupId, 'oa', null)!;
    const merciId = store.createMember(groupId, 'merci', null)!;
    const songId = store.createSong(groupId, 'Track', 240)!;
    return { store, groupId, oaId, merciId, songId };
  };

  const findSong = (groupId: string, songId: string) =>
    useWorkspaceStore
      .getState()
      .workspace.groups.find((entry) => entry.id === groupId)
      ?.songs.find((entry) => entry.id === songId);

  it('cuts the conflicting line at the start and keeps the edited line shared', () => {
    const { groupId, oaId, merciId, songId } = setup();
    const merciLineId = useWorkspaceStore.getState().addLine(groupId, songId, {
      startSec: 21.69,
      endSec: 28.89,
      memberIds: [merciId],
      kind: 'sung',
    });
    const oaLineId = useWorkspaceStore.getState().addLine(groupId, songId, {
      startSec: 27.00,
      endSec: 28.89,
      memberIds: [oaId],
      kind: 'sung',
    });
    if (!merciLineId || !oaLineId) return;

    const ok = useWorkspaceStore
      .getState()
      .mergeLineIntoExisting(groupId, songId, oaLineId, {
        startSec: 27.00,
        endSec: 28.89,
        memberIds: [oaId, merciId],
        kind: 'sung',
      }, merciId);
    expect(ok).toBe(true);

    const song = findSong(groupId, songId)!;
    const oaLine = song.lines.find((line) => line.id === oaLineId);
    expect(oaLine).toBeDefined();
    expect(oaLine!.memberIds).toEqual([oaId, merciId]);
    expect(oaLine!.startSec).toBe(27.00);
    expect(oaLine!.endSec).toBe(28.89);

    const merciLines = song.lines.filter((line) => line.id !== oaLineId);
    expect(merciLines).toHaveLength(1);
    expect(merciLines[0].memberIds).toEqual([merciId]);
    expect(merciLines[0].startSec).toBe(21.69);
    expect(merciLines[0].endSec).toBe(27.00);
  });

  it('cuts the conflicting line on both sides when the shared part sits inside it', () => {
    const { groupId, oaId, merciId, songId } = setup();
    const merciLineId = useWorkspaceStore.getState().addLine(groupId, songId, {
      startSec: 21.69,
      endSec: 30.00,
      memberIds: [merciId],
      kind: 'sung',
    });
    const oaLineId = useWorkspaceStore.getState().addLine(groupId, songId, {
      startSec: 27.00,
      endSec: 28.89,
      memberIds: [oaId],
      kind: 'sung',
    });
    if (!merciLineId || !oaLineId) return;

    const ok = useWorkspaceStore
      .getState()
      .mergeLineIntoExisting(groupId, songId, oaLineId, {
        startSec: 27.00,
        endSec: 28.89,
        memberIds: [oaId, merciId],
        kind: 'sung',
      }, merciId);
    expect(ok).toBe(true);

    const song = findSong(groupId, songId)!;
    const oaLine = song.lines.find((line) => line.id === oaLineId);
    expect(oaLine!.memberIds).toEqual([oaId, merciId]);
    expect(oaLine!.startSec).toBe(27.00);
    expect(oaLine!.endSec).toBe(28.89);

    const merciLines = song.lines.filter((line) => line.id !== oaLineId);
    expect(merciLines).toHaveLength(2);
    expect(merciLines.map((line) => line.memberIds)).toEqual([[merciId], [merciId]]);
    expect(merciLines.map((line) => [line.startSec, line.endSec])).toEqual([
      [21.69, 27.00],
      [28.89, 30.00],
    ]);
  });

  it('removes the conflicting line entirely when it is fully covered by the shared part', () => {
    const { groupId, oaId, merciId, songId } = setup();
    const merciLineId = useWorkspaceStore.getState().addLine(groupId, songId, {
      startSec: 27.00,
      endSec: 28.89,
      memberIds: [merciId],
      kind: 'sung',
    });
    const oaLineId = useWorkspaceStore.getState().addLine(groupId, songId, {
      startSec: 21.69,
      endSec: 30.00,
      memberIds: [oaId],
      kind: 'sung',
    });
    if (!merciLineId || !oaLineId) return;

    const ok = useWorkspaceStore
      .getState()
      .mergeLineIntoExisting(groupId, songId, oaLineId, {
        startSec: 21.69,
        endSec: 30.00,
        memberIds: [oaId, merciId],
        kind: 'sung',
      }, merciId);
    expect(ok).toBe(true);

    const song = findSong(groupId, songId)!;
    const oaLine = song.lines.find((line) => line.id === oaLineId);
    expect(oaLine!.memberIds).toEqual([oaId, merciId]);
    expect(oaLine!.startSec).toBe(21.69);
    expect(oaLine!.endSec).toBe(30.00);
    expect(song.lines.find((line) => line.id === merciLineId)).toBeUndefined();
    expect(song.lines).toHaveLength(1);
  });
});
