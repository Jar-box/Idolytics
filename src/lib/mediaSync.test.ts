import { describe, expect, it } from 'vitest';
import { createEmptyWorkspace } from '../domain/schema';
import { createGroup, createSong } from '../domain/factories';
import {
  MediaApiError,
  chooseNewerManifest,
  countMediaCopies,
  mediaDestination,
  mediaErrorMessage,
  mediaFileUrl,
  mediaSnapshotSignature,
  resolveMediaCopy,
  workspaceToMediaSnapshot,
} from './mediaSync';
import type { MediaManifest } from './mediaTypes';

function makeWorkspace() {
  const workspace = createEmptyWorkspace();
  const group = createGroup('A2O Lite');
  const song = createSong('Hush', 210);
  group.songs.push(song);
  workspace.groups.push(group);
  return { workspace, group, song };
}

function makeManifest(revision: number, folder = 'A2O Lite'): MediaManifest {
  return {
    version: 1,
    revision,
    updatedAt: '2026-01-01T00:00:00.000Z',
    groups: {
      grp_test: {
        name: 'A2O Lite',
        folder,
        songs: {
          sng_test: {
            title: 'Hush',
            folder: 'Hush',
            copies: {
              audio: {
                originalName: 'track.mp3',
                fileName: 'track (2).mp3',
                size: 1234,
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
              video: {
                originalName: 'practice.mp4',
                fileName: 'practice.mp4',
                size: 4567,
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            },
          },
        },
      },
    },
  };
}

describe('workspaceToMediaSnapshot', () => {
  it('keeps only the names needed to plan media folders', () => {
    const { workspace, group, song } = makeWorkspace();
    expect(workspaceToMediaSnapshot(workspace)).toEqual({
      groups: [
        {
          id: group.id,
          name: 'A2O Lite',
          songs: [{ id: song.id, title: 'Hush' }],
        },
      ],
    });
  });

  it('produces a signature that changes with group and song names', () => {
    const { workspace, group, song } = makeWorkspace();
    const initial = mediaSnapshotSignature(workspaceToMediaSnapshot(workspace));
    expect(mediaSnapshotSignature(workspaceToMediaSnapshot(workspace))).toBe(initial);

    group.name = 'A2O Lite Renamed';
    expect(mediaSnapshotSignature(workspaceToMediaSnapshot(workspace))).not.toBe(initial);

    group.name = 'A2O Lite';
    song.title = 'Hush (Remix)';
    expect(mediaSnapshotSignature(workspaceToMediaSnapshot(workspace))).not.toBe(initial);
  });
});

describe('chooseNewerManifest', () => {
  it('accepts an incoming manifest when there is no current copy', () => {
    const incoming = makeManifest(3);
    expect(chooseNewerManifest(null, incoming)).toBe(incoming);
  });

  it('ignores an older revision and replaces an equal one', () => {
    const current = makeManifest(5, 'Current');
    expect(chooseNewerManifest(current, makeManifest(4, 'Old'))).toBe(current);
    const replacement = makeManifest(5, 'Replacement');
    expect(chooseNewerManifest(current, replacement)).toBe(replacement);
  });
});

describe('mediaFileUrl', () => {
  it('encodes every path segment', () => {
    expect(
      mediaFileUrl('groups/A2O Lite/songs/Hush #1/audio/track & mix.mp3'),
    ).toBe(
      '/__media/file/groups/A2O%20Lite/songs/Hush%20%231/audio/track%20%26%20mix.mp3',
    );
  });
});

describe('resolveMediaCopy', () => {
  it('resolves by the original name or the stored file name', () => {
    const manifest = makeManifest(1);
    const byOriginal = resolveMediaCopy(manifest, 'grp_test', 'sng_test', 'audio', 'track.mp3');
    expect(byOriginal?.copy.fileName).toBe('track (2).mp3');
    expect(byOriginal?.relativePath).toBe(
      'groups/A2O Lite/songs/Hush/audio/track (2).mp3',
    );
    expect(byOriginal?.url).toBe(
      '/__media/file/groups/A2O%20Lite/songs/Hush/audio/track%20(2).mp3',
    );

    const byFileName = resolveMediaCopy(
      manifest,
      'grp_test',
      'sng_test',
      'audio',
      'track (2).mp3',
    );
    expect(byFileName?.copy.originalName).toBe('track.mp3');
  });

  it('returns null for missing ids, copies, or a different source name', () => {
    const manifest = makeManifest(1);
    expect(resolveMediaCopy(null, 'grp_test', 'sng_test', 'audio', 'track.mp3')).toBeNull();
    expect(resolveMediaCopy(manifest, 'grp_other', 'sng_test', 'audio', 'track.mp3')).toBeNull();
    expect(resolveMediaCopy(manifest, 'grp_test', 'sng_other', 'audio', 'track.mp3')).toBeNull();
    expect(resolveMediaCopy(manifest, 'grp_test', 'sng_test', 'audio', null)).toBeNull();
    expect(
      resolveMediaCopy(manifest, 'grp_test', 'sng_test', 'audio', 'different.mp3'),
    ).toBeNull();
  });
});

describe('mediaDestination', () => {
  it('joins the library path and relative media path', () => {
    expect(
      mediaDestination('groups/A/songs/B/audio/c.mp3', 'media'),
    ).toBe('media/groups/A/songs/B/audio/c.mp3');
    expect(
      mediaDestination('groups/A/songs/B/video/c.mp4', 'media/'),
    ).toBe('media/groups/A/songs/B/video/c.mp4');
    expect(
      mediaDestination('groups/A/songs/B/audio/c.mp3', 'C:\\Projects\\Idolytics\\media'),
    ).toBe('C:/Projects/Idolytics/media/groups/A/songs/B/audio/c.mp3');
    expect(mediaDestination('groups/A/songs/B/audio/c.mp3', null)).toBe(
      'media/groups/A/songs/B/audio/c.mp3',
    );
  });
});

describe('countMediaCopies', () => {
  it('counts audio and video copies across songs', () => {
    expect(countMediaCopies(null)).toEqual({ audio: 0, video: 0 });
    expect(countMediaCopies(makeManifest(1))).toEqual({ audio: 1, video: 1 });
  });
});

describe('mediaErrorMessage', () => {
  it('uses API and error messages, with a fallback', () => {
    expect(mediaErrorMessage(new MediaApiError(413, 'Too large.'))).toBe('Too large.');
    expect(mediaErrorMessage(new Error('Disk full.'))).toBe('Disk full.');
    expect(mediaErrorMessage(null, 'Fallback.')).toBe('Fallback.');
    expect(mediaErrorMessage(null)).toContain('media library is unavailable');
  });
});
