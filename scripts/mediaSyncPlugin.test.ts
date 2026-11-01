import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { MediaLibrary, parseByteRange } from './mediaSyncPlugin';
import type { MediaKind, MediaWorkspaceSnapshot } from '../src/lib/mediaTypes';

let projectRoot: string;
let library: MediaLibrary;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), 'idolytics-media-'));
  library = new MediaLibrary(projectRoot);
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

function mediaRoot(): string {
  return path.join(projectRoot, 'media');
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

function snapshot(
  groups: Array<{ id: string; name: string; songs: Array<{ id: string; title: string }> }>,
): MediaWorkspaceSnapshot {
  return { groups };
}

async function upload(input: {
  groupId?: string;
  groupName?: string;
  songId?: string;
  songTitle?: string;
  kind?: MediaKind;
  filename: string;
  contents: string;
}) {
  return library.saveUpload({
    groupId: input.groupId ?? 'grp_a',
    groupName: input.groupName ?? 'A2O Lite',
    songId: input.songId ?? 'sng_a',
    songTitle: input.songTitle ?? 'Hush',
    kind: input.kind ?? 'audio',
    filename: input.filename,
    stream: Readable.from([Buffer.from(input.contents)]),
    sizeHint: Buffer.byteLength(input.contents),
  });
}

describe('MediaLibrary folder reconciliation', () => {
  it('creates group, song, and media folders from a workspace snapshot', async () => {
    const initial = await library.status();
    expect(initial.manifest.revision).toBe(0);

    const payload = await library.sync(
      snapshot([
        {
          id: 'grp_a',
          name: 'A2O Lite',
          songs: [{ id: 'sng_a', title: 'Hush' }],
        },
      ]),
    );

    expect(payload.manifest.groups.grp_a.folder).toBe('A2O Lite');
    expect(payload.manifest.groups.grp_a.songs.sng_a.folder).toBe('Hush');
    expect(await isDirectory(path.join(mediaRoot(), 'groups', 'A2O Lite', 'songs', 'Hush', 'audio'))).toBe(true);
    expect(await isDirectory(path.join(mediaRoot(), 'groups', 'A2O Lite', 'songs', 'Hush', 'video'))).toBe(true);
    expect(payload.counts).toEqual({ groups: 1, songs: 1, audio: 0, video: 0 });
    expect(payload.manifest.revision).toBe(1);
    expect(await isFile(path.join(mediaRoot(), '.idolytics-media.json'))).toBe(true);
  });

  it('moves folders when a group or song is renamed and keeps copies linked', async () => {
    await library.sync(
      snapshot([
        { id: 'grp_a', name: 'Old Group', songs: [{ id: 'sng_a', title: 'Old Song' }] },
      ]),
    );
    await upload({
      groupName: 'Old Group',
      songTitle: 'Old Song',
      filename: 'track.mp3',
      contents: 'audio-bytes',
    });

    const payload = await library.sync(
      snapshot([
        { id: 'grp_a', name: 'New Group', songs: [{ id: 'sng_a', title: 'New Song' }] },
      ]),
    );

    expect(payload.manifest.groups.grp_a.folder).toBe('New Group');
    expect(payload.manifest.groups.grp_a.songs.sng_a.folder).toBe('New Song');
    expect(payload.manifest.groups.grp_a.songs.sng_a.copies.audio?.fileName).toBe('track.mp3');
    expect(
      await isFile(
        path.join(mediaRoot(), 'groups', 'New Group', 'songs', 'New Song', 'audio', 'track.mp3'),
      ),
    ).toBe(true);
    expect(await isDirectory(path.join(mediaRoot(), 'groups', 'Old Group'))).toBe(false);
    expect(payload.counts.audio).toBe(1);
  });

  it('suffixes colliding folder names and sanitizes unsafe characters', async () => {
    const payload = await library.sync(
      snapshot([
        { id: 'grp_1', name: 'Twice', songs: [{ id: 'sng_1', title: 'A/B: C?' }] },
        { id: 'grp_2', name: 'Twice', songs: [] },
        { id: 'grp_3', name: 'CON', songs: [] },
      ]),
    );

    expect(payload.manifest.groups.grp_1.folder).toBe('Twice');
    expect(payload.manifest.groups.grp_2.folder).toBe('Twice (2)');
    expect(payload.manifest.groups.grp_3.folder).toBe('CON_');
    const songFolder = payload.manifest.groups.grp_1.songs.sng_1.folder;
    expect(songFolder).toContain('A-B');
    expect(songFolder).not.toMatch(/[<>:"/\\|?*]/);
    expect(await isDirectory(path.join(mediaRoot(), 'groups', 'Twice (2)'))).toBe(true);
  });

  it('keeps stale entries and folders until the folder is removed', async () => {
    await library.sync(
      snapshot([{ id: 'grp_a', name: 'A2O Lite', songs: [{ id: 'sng_a', title: 'Hush' }] }]),
    );
    await upload({ filename: 'track.mp3', contents: 'audio-bytes' });

    const afterDelete = await library.sync(snapshot([]));
    expect(afterDelete.manifest.groups.grp_a).toBeDefined();
    expect(await isDirectory(path.join(mediaRoot(), 'groups', 'A2O Lite'))).toBe(true);

    await rm(path.join(mediaRoot(), 'groups', 'A2O Lite'), { recursive: true, force: true });
    const cleaned = await library.sync(snapshot([]));
    expect(cleaned.manifest.groups.grp_a).toBeUndefined();
  });
});

describe('MediaLibrary copy handling', () => {
  it('reuses same-name, same-size files and suffixes different content', async () => {
    await library.sync(
      snapshot([{ id: 'grp_a', name: 'A2O Lite', songs: [{ id: 'sng_a', title: 'Hush' }] }]),
    );

    const first = await upload({ filename: 'track.mp3', contents: 'abc' });
    expect(first.copy.fileName).toBe('track.mp3');
    expect(first.reused).toBe(false);

    const same = await upload({ filename: 'track.mp3', contents: 'abc' });
    expect(same.copy.fileName).toBe('track.mp3');
    expect(same.reused).toBe(true);
    expect(await readdir(path.join(mediaRoot(), 'groups', 'A2O Lite', 'songs', 'Hush', 'audio'))).toEqual(['track.mp3']);

    const different = await upload({ filename: 'track.mp3', contents: 'abcd' });
    expect(different.copy.fileName).toBe('track (2).mp3');
    expect(different.reused).toBe(false);
    const saved = await readFile(path.join(mediaRoot(), ...different.relativePath.split('/')), 'utf8');
    expect(saved).toBe('abcd');

    const status = await library.status();
    expect(status.manifest.groups.grp_a.songs.sng_a.copies.audio?.fileName).toBe(
      'track (2).mp3',
    );
    expect(status.manifest.groups.grp_a.songs.sng_a.copies.audio?.size).toBe(4);
  });

  it('prunes copies whose files were removed from disk', async () => {
    await library.sync(
      snapshot([{ id: 'grp_a', name: 'A2O Lite', songs: [{ id: 'sng_a', title: 'Hush' }] }]),
    );
    const copy = await upload({ filename: 'track.mp3', contents: 'abc' });
    await rm(path.join(mediaRoot(), ...copy.relativePath.split('/')));

    const status = await library.status();
    expect(status.manifest.groups.grp_a.songs.sng_a.copies.audio).toBeUndefined();
    expect(status.counts.audio).toBe(0);
  });

  it('reports a manifest revision that advances with each save', async () => {
    await library.sync(
      snapshot([{ id: 'grp_a', name: 'A2O Lite', songs: [{ id: 'sng_a', title: 'Hush' }] }]),
    );
    const copy = await upload({ filename: 'track.mp3', contents: 'abc' });
    expect(copy.manifestRevision).toBe(2);

    const status = await library.status();
    expect(status.manifest.revision).toBe(2);

    const synced = await library.sync(
      snapshot([{ id: 'grp_a', name: 'A2O Lite', songs: [{ id: 'sng_a', title: 'Hush' }] }]),
    );
    expect(synced.manifest.revision).toBe(3);
  });
});

describe('MediaLibrary path safety', () => {
  it('serves only files that live under the media root', async () => {
    await library.sync(
      snapshot([{ id: 'grp_a', name: 'A2O Lite', songs: [{ id: 'sng_a', title: 'Hush' }] }]),
    );
    const copy = await upload({ filename: 'track.mp3', contents: 'abc' });

    const info = await library.statMediaFile(copy.relativePath.split('/'));
    expect(info?.size).toBe(3);

    expect(await library.statMediaFile(['groups', '..', 'songs', 'Hush', 'audio', 'x.mp3'])).toBeNull();
    expect(await library.statMediaFile(['groups', 'A2O Lite', 'songs', 'Hush', 'audio', '..'])).toBeNull();
    expect(
      await library.statMediaFile(['groups', 'A2O Lite', 'songs', 'Hush', 'audio', 'missing.mp3']),
    ).toBeNull();
  });
});

describe('parseByteRange', () => {
  it('returns null without a range header', () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
    expect(parseByteRange('', 100)).toBeNull();
  });

  it('parses closed, open, and suffix ranges', () => {
    expect(parseByteRange('bytes=0-99', 100)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange('bytes=50-', 100)).toEqual({ start: 50, end: 99 });
    expect(parseByteRange('bytes=-20', 100)).toEqual({ start: 80, end: 99 });
    expect(parseByteRange('bytes=0-1000', 100)).toEqual({ start: 0, end: 99 });
  });

  it('rejects unsatisfiable or malformed ranges', () => {
    expect(parseByteRange('bytes=100-', 100)).toBe('invalid');
    expect(parseByteRange('bytes=50-40', 100)).toBe('invalid');
    expect(parseByteRange('bytes=abc', 100)).toBe('invalid');
    expect(parseByteRange('bytes=-0', 100)).toBe('invalid');
    expect(parseByteRange('bytes=0-10,20-30', 100)).toBe('invalid');
    expect(parseByteRange('bytes=0-', 0)).toBe('invalid');
  });
});
