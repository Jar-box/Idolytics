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
