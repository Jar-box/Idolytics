import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MediaImportError,
  MediaImporter,
  buildVideoFormatSelector,
  describeImportFailure,
  parseImportProgressLine,
  parseMediaImportRequest,
  validateImportUrl,
} from './mediaImport';
import { MediaLibrary, MediaLibraryError } from './mediaSyncPlugin';
import type {
  MediaImportJob,
  MediaImportState,
  MediaWorkspaceSnapshot,
} from '../src/lib/mediaTypes';

const TEST_SNAPSHOT: MediaWorkspaceSnapshot = {
  groups: [
    {
      id: 'grp_test',
      name: 'Test Group',
      songs: [{ id: 'sng_test', title: 'Test Song' }],
    },
  ],
};

const FAKE_YTDLP = `import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

const args = process.argv.slice(2);
const mode = process.env.IDOLYTICS_FAKE_MODE ?? 'ok';

if (args.includes('--version')) {
  console.log('2026.02.04');
  process.exit(0);
}
if (args.includes('--help')) {
  console.log('  --js-runtimes RUNTIME  JavaScript runtime to use (e.g. node)');
  process.exit(0);
}
if (mode === 'fail') {
  console.error('ERROR: Video unavailable');
  process.exit(1);
}
if (mode === 'hang') {
  setInterval(() => undefined, 1000);
} else if (args.includes('--dump-single-json')) {
  if (mode === 'playlist') {
    console.log(JSON.stringify({ _type: 'playlist', entries: [] }));
  } else if (mode === 'live') {
    console.log(JSON.stringify({ title: 'Live test', is_live: true }));
  } else if (mode === 'noduration') {
    console.log(JSON.stringify({ title: 'No length video' }));
  } else {
    console.log(JSON.stringify({ title: 'Fake Test Video', duration: 123.4 }));
  }
  process.exit(0);
} else {
  console.log('IDLYTDLPROGRESS:500|1000|0|downloading');
  console.log('IDLYTDLPROGRESS:1000|1000|0|finished');
  const outputIndex = args.indexOf('-o');
  const output = args[outputIndex + 1];
  if (!output) {
    console.error('missing output template');
    process.exit(1);
  }
  const target = output.replace('%(ext)s', args.includes('-x') ? 'm4a' : 'mp4');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, 'fake media bytes');
  process.exit(0);
}
`;

const FAKE_FFMPEG = `if (process.argv.includes('-version')) {
  console.log('ffmpeg version 8.0.1 Copyright (c) 2000-2026 the FFmpeg developers');
} else {
  console.log('');
}
`;

let root: string;
let library: MediaLibrary;
let importer: MediaImporter | null;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'idolytics-import-'));
  library = new MediaLibrary(root);
  await library.sync(TEST_SNAPSHOT);
  importer = null;
});

afterEach(async () => {
  importer?.dispose();
  await rm(root, { recursive: true, force: true });
});

async function writeTools(): Promise<{ ytDlp: string; ffmpeg: string }> {
  const toolsDir = path.join(root, 'tools');
  await mkdir(toolsDir, { recursive: true });
  const ytDlp = path.join(toolsDir, 'fake-yt-dlp.mjs');
  const ffmpeg = path.join(toolsDir, 'fake-ffmpeg.mjs');
  await writeFile(ytDlp, FAKE_YTDLP, 'utf8');
  await writeFile(ffmpeg, FAKE_FFMPEG, 'utf8');
  return { ytDlp, ffmpeg };
}

async function createImporter(
  mode = 'ok',
  options: { probeTimeoutMs?: number } = {},
): Promise<MediaImporter> {
  const tools = await writeTools();
  const instance = new MediaImporter({
    root,
    library,
    ytDlp: { command: process.execPath, prefixArgs: [tools.ytDlp] },
    ffmpeg: { command: process.execPath, prefixArgs: [tools.ffmpeg] },
    env: { ...process.env, IDOLYTICS_FAKE_MODE: mode },
    probeTimeoutMs: options.probeTimeoutMs,
  });
  importer = instance;
  return instance;
}

async function waitForJob(
  instance: MediaImporter,
  jobId: string,
  timeoutMs = 6000,
): Promise<MediaImportJob> {
  const started = Date.now();
  for (;;) {
    const job = instance.get(jobId);
    if (!job) throw new Error(`Import ${jobId} disappeared.`);
    if (job.state === 'done' || job.state === 'error' || job.state === 'cancelled') {
      return job;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Import ${jobId} did not finish (last state: ${job.state}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForState(
  instance: MediaImporter,
  jobId: string,
  state: MediaImportState,
  timeoutMs = 6000,
): Promise<MediaImportJob> {
  const started = Date.now();
  for (;;) {
    const job = instance.get(jobId);
    if (!job) throw new Error(`Import ${jobId} disappeared.`);
    if (job.state === state) return job;
    if (job.state === 'error' || job.state === 'done' || job.state === 'cancelled') {
      throw new Error(`Import ${jobId} ended as ${job.state} before reaching ${state}.`);
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Import ${jobId} did not reach ${state}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForImportTempCleanup(timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  for (;;) {
    const entries = await readdir(path.join(root, 'media', '.tmp')).catch(() => []);
    if (entries.filter((entry) => entry.startsWith('import-')).length === 0) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error('Import temp folder was not removed.');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function importRequest(kind: 'audio' | 'video' = 'video') {
  return {
    url: 'https://example.com/watch?v=test',
    groupId: 'grp_test',
    groupName: 'Test Group',
    songId: 'sng_test',
    songTitle: 'Test Song',
    kind,
    quality: '1080' as const,
  };
}

describe('media import URL validation', () => {
  it('accepts public http and https links', () => {
    expect(validateImportUrl('https://example.com/watch?v=1')).toBe(
      'https://example.com/watch?v=1',
    );
    expect(validateImportUrl('http://media.example.org/audio')).toBe(
      'http://media.example.org/audio',
    );
  });

  it('rejects unsupported protocols and credentials', () => {
    expect(() => validateImportUrl('file:///C:/secret.mp4')).toThrow(MediaImportError);
    expect(() => validateImportUrl('ftp://example.com/file.mp4')).toThrow(MediaImportError);
    expect(() => validateImportUrl('https://user:pass@example.com/video')).toThrow(
      MediaImportError,
    );
  });

  it('rejects local and private network hosts', () => {
    for (const url of [
      'http://localhost:3000/video',
      'http://127.0.0.1/video',
      'http://10.0.0.5/video',
      'http://172.20.1.2/video',
      'http://192.168.1.10/video',
      'http://169.254.1.2/video',
      'http://[::1]/video',
    ]) {
      expect(() => validateImportUrl(url), url).toThrow(MediaImportError);
    }
  });

  it('rejects playlists and keeps audio quality at best', () => {
    expect(() =>
      validateImportUrl('https://www.youtube.com/playlist?list=PL1234567890'),
    ).toThrow(/single video/i);
    const request = parseMediaImportRequest({
      ...importRequest('audio'),
      quality: '720',
    });
    expect(request.kind).toBe('audio');
    expect(request.quality).toBe('720');
  });

  it('rejects invalid ids and media kinds', () => {
    expect(() =>
      parseMediaImportRequest({ ...importRequest(), groupId: '../bad' }),
    ).toThrow(MediaImportError);
    expect(() =>
      parseMediaImportRequest({ ...importRequest(), kind: 'image' }),
    ).toThrow(MediaImportError);
  });
});

describe('media import helpers', () => {
  it('caps video formats by quality while preferring H.264 and AAC MP4', () => {
    expect(buildVideoFormatSelector('1080')).toContain('[height<=1080]');
    expect(buildVideoFormatSelector('720')).toContain('[height<=720]');
    expect(buildVideoFormatSelector('best')).not.toContain('height<=');
    expect(buildVideoFormatSelector('1080')).toContain('vcodec^=avc1');
    expect(buildVideoFormatSelector('1080')).toContain('ba[ext=m4a]');
  });

  it('parses progress markers and ignores unrelated output', () => {
    expect(parseImportProgressLine('random line')).toBeNull();
    expect(
      parseImportProgressLine('IDLYTDLPROGRESS:500|1000|0|downloading'),
    ).toEqual({ progress: 0.5, status: 'downloading' });
    expect(
      parseImportProgressLine('IDLYTDLPROGRESS:750|0|1000|downloading'),
    ).toEqual({ progress: 0.75, status: 'downloading' });
    expect(
      parseImportProgressLine('IDLYTDLPROGRESS:1000|1000|0|finished'),
    ).toEqual({ progress: 1, status: 'finished' });
    expect(
      parseImportProgressLine('IDLYTDLPROGRESS:NA|NA|NA|downloading'),
    ).toEqual({ progress: null, status: 'downloading' });
  });

  it('turns common yt-dlp failures into friendly messages', () => {
    expect(describeImportFailure('ERROR: Sign in to confirm you are not a bot')).toContain(
      'IDOLYTICS_YTDLP_COOKIES_FROM_BROWSER',
    );
    expect(describeImportFailure('ERROR: Video unavailable')).toContain('unavailable');
    expect(describeImportFailure('ERROR: Private video')).toContain('private');
    expect(describeImportFailure('ERROR: Requested format is not available')).toContain(
      'No compatible format',
    );
    expect(describeImportFailure('ERROR: HTTP Error 403: Forbidden')).toContain('403');
  });
});

describe('MediaImporter', () => {
  it('downloads a video, saves it through the manifest, and reports progress', async () => {
    const instance = await createImporter();
    const { jobId } = await instance.start(importRequest('video'));
    const job = await waitForJob(instance, jobId);

    expect(job.state).toBe('done');
    expect(job.error).toBeNull();
    expect(job.title).toBe('Fake Test Video');
    expect(job.durationSec).toBe(123.4);
    expect(job.copy?.kind).toBe('video');
    expect(job.copy?.relativePath).toMatch(
      /^groups\/Test Group\/songs\/Test Song\/video\/Fake Test Video\.mp4$/,
    );
    expect(job.copy?.reused).toBe(false);

    const savedPath = path.join(root, 'media', job.copy?.relativePath ?? '');
    expect(await readFile(savedPath, 'utf8')).toBe('fake media bytes');
    const status = await library.status();
    const copy = status.manifest.groups.grp_test?.songs.sng_test?.copies.video;
    expect(copy?.fileName).toBe('Fake Test Video.mp4');
    expect(copy?.size).toBe(Buffer.byteLength('fake media bytes'));

    await waitForImportTempCleanup();
  });

  it('downloads audio to M4A without extracting it from a video', async () => {
    const instance = await createImporter();
    const { jobId } = await instance.start(importRequest('audio'));
    const job = await waitForJob(instance, jobId);

    expect(job.state).toBe('done');
    expect(job.copy?.kind).toBe('audio');
    expect(job.copy?.relativePath).toMatch(/\/audio\/Fake Test Video\.m4a$/);
  });

  it('reports download failures without leaving temp files', async () => {
    const instance = await createImporter('fail');
    const { jobId } = await instance.start(importRequest());
    const job = await waitForJob(instance, jobId);

    expect(job.state).toBe('error');
    expect(job.error).toContain('unavailable');
    await waitForImportTempCleanup();
  });

  it('rejects playlist and live metadata', async () => {
    const playlistImporter = await createImporter('playlist');
    const playlist = await playlistImporter.start(importRequest());
    const playlistJob = await waitForJob(playlistImporter, playlist.jobId);
    expect(playlistJob.state).toBe('error');
    expect(playlistJob.error).toContain('single video');

    importer?.dispose();
    const liveImporter = await createImporter('live');
    const live = await liveImporter.start(importRequest());
    const liveJob = await waitForJob(liveImporter, live.jobId);
    expect(liveJob.state).toBe('error');
    expect(liveJob.error).toContain('Live streams');
  });

  it('cancels an in-flight import and cleans up its staging folder', async () => {
    const instance = await createImporter('hang');
    const { jobId } = await instance.start(importRequest());
    await waitForState(instance, jobId, 'resolving');
    const result = await instance.cancel(jobId);

    expect(result?.cancelled).toBe(true);
    expect(result?.job.state).toBe('cancelled');
    const job = await waitForJob(instance, jobId);
    expect(job.state).toBe('cancelled');

    const started = Date.now();
    for (;;) {
      const tempEntries = await readdir(path.join(root, 'media', '.tmp')).catch(() => []);
      if (tempEntries.filter((entry) => entry.startsWith('import-')).length === 0) break;
      if (Date.now() - started > 3000) {
        throw new Error('Import temp folder was not removed.');
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  });

  it('does not start when the requested kind is already importing for the song', async () => {
    const instance = await createImporter('hang');
    const first = await instance.start(importRequest('video'));
    await waitForState(instance, first.jobId, 'resolving');
    await expect(instance.start(importRequest('video'))).rejects.toMatchObject({
      statusCode: 409,
    });
    await instance.cancel(first.jobId);
    await waitForJob(instance, first.jobId);
  });
});

describe('MediaImporter link probe', () => {
  it('reads a title and duration without downloading', async () => {
    const instance = await createImporter();
    const result = await instance.probe({ url: 'https://example.com/watch?v=test' });

    expect(result).toEqual({ title: 'Fake Test Video', durationSec: 123.4 });
    const tempEntries = await readdir(path.join(root, 'media', '.tmp')).catch(() => []);
    expect(tempEntries.filter((entry) => entry.startsWith('import-'))).toEqual([]);
  });

  it('reads metadata when ffmpeg is missing', async () => {
    const tools = await writeTools();
    const instance = new MediaImporter({
      root,
      library,
      ytDlp: { command: process.execPath, prefixArgs: [tools.ytDlp] },
      ffmpeg: path.join(root, 'tools', 'missing-ffmpeg'),
      env: { ...process.env, IDOLYTICS_FAKE_MODE: 'ok' },
    });
    importer = instance;

    const result = await instance.probe({ url: 'https://example.com/watch?v=test' });
    expect(result.durationSec).toBe(123.4);
  });

  it('rejects playlists, live links, and links without a fixed length', async () => {
    const playlist = await createImporter('playlist');
    await expect(
      playlist.probe({ url: 'https://example.com/watch?v=test' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    playlist.dispose();

    const live = await createImporter('live');
    await expect(
      live.probe({ url: 'https://example.com/watch?v=test' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    live.dispose();

    const noDuration = await createImporter('noduration');
    await expect(
      noDuration.probe({ url: 'https://example.com/watch?v=test' }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects unsafe or invalid links', async () => {
    const instance = await createImporter();

    for (const url of [
      'file:///C:/secret.mp4',
      'http://localhost:3000/video',
      'not a link',
    ]) {
      await expect(instance.probe({ url })).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(instance.probe({})).rejects.toMatchObject({ statusCode: 400 });
  });

  it('times out when metadata lookup hangs', async () => {
    const instance = await createImporter('hang', { probeTimeoutMs: 250 });
    await expect(
      instance.probe({ url: 'https://example.com/watch?v=test' }),
    ).rejects.toMatchObject({ statusCode: 504 });
  });
});

describe('MediaLibrary.saveImport', () => {
  it('rejects files outside the media temp folder', async () => {
    const outside = path.join(root, 'outside.mp4');
    await writeFile(outside, 'outside bytes');
    await expect(
      library.saveImport({
        groupId: 'grp_test',
        groupName: 'Test Group',
        songId: 'sng_test',
        songTitle: 'Test Song',
        kind: 'video',
        filename: 'outside.mp4',
        tempPath: outside,
        size: (await stat(outside)).size,
      }),
    ).rejects.toBeInstanceOf(MediaLibraryError);
  });
});
