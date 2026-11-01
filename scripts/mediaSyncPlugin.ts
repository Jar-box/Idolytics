import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, type Dirent } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import type { Plugin } from 'vite';
import { MediaImportError, MediaImporter } from './mediaImport.ts';
import {
  DEFAULT_MEDIA_DIR,
  MEDIA_BASE_PATH,
  MEDIA_MANIFEST_VERSION,
  type MediaCopyRecord,
  type MediaCopyResponse,
  type MediaCounts,
  type MediaGroupEntry,
  type MediaKind,
  type MediaManifest,
  type MediaSongEntry,
  type MediaStatusPayload,
  type MediaStatusResponse,
  type MediaWorkspaceGroup,
  type MediaWorkspaceSnapshot,
  type MediaWorkspaceSong,
} from '../src/lib/mediaTypes.ts';

const MANIFEST_FILE = '.idolytics-media.json';
const FILE_PREFIX = `${MEDIA_BASE_PATH}/file/`;
const MAX_FOLDER_NAME = 84;
const MAX_FILE_NAME = 160;
const MAX_DISPLAY_NAME = 80;
const MAX_JSON_BODY = 2 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024 * 1024;
const MAX_GROUPS = 100;
const MAX_SONGS = 300;
const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const KINDS: MediaKind[] = ['audio', 'video'];
const INVALID_SEGMENT_PATTERN = /[<>:"/\\|?*\u0000-\u001f\u007f]/;
const INVALID_SEGMENT_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export class MediaLibraryError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'MediaLibraryError';
    this.statusCode = statusCode;
  }
}

interface MediaUploadInput {
  groupId: string;
  groupName: string;
  songId: string;
  songTitle: string;
  kind: MediaKind;
  filename: string;
  stream: Readable;
  sizeHint?: number;
}

interface MediaFileInfo {
  path: string;
  size: number;
  mtime: Date;
}

interface FolderMove {
  id: string;
  from: string;
  to: string;
  fromPath: string;
  tempPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | null {
  return isRecord(error) && typeof error.code === 'string' ? error.code : null;
}

function truncate(value: string, max: number): string {
  const characters = Array.from(value);
  return characters.length <= max ? value : characters.slice(0, max).join('');
}

function sanitizeSegment(value: string, fallback: string, max = MAX_FOLDER_NAME): string {
  let next = value
    .replace(INVALID_SEGMENT_CHARS, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/g, '');
  next = truncate(next, max).trim().replace(/[. ]+$/g, '');
  if (!next) next = fallback;
  if (RESERVED_WINDOWS_NAME.test(next)) next = `${next}_`;
  return truncate(next, max).trim() || fallback;
}

function sanitizeFileName(value: string, fallback: string): string {
  const withoutPath = value.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = sanitizeSegment(withoutPath, fallback, MAX_FILE_NAME);
  return cleaned || fallback;
}

function withSuffix(base: string, index: number, max: number): string {
  const suffix = ` (${index})`;
  const stem = truncate(base, Math.max(1, max - suffix.length)).trim() || 'Item';
  return `${stem}${suffix}`;
}

function withFileSuffix(base: string, index: number, max: number): string {
  const suffix = ` (${index})`;
  const extension = path.extname(base);
  if (!extension || extension.length + suffix.length + 1 > max) {
    return withSuffix(base, index, max);
  }
  const stem =
    truncate(base.slice(0, -extension.length), max - extension.length - suffix.length).trim() ||
    'Item';
  return `${stem}${suffix}${extension}`;
}

function uniqueName(base: string, taken: ReadonlySet<string>, max: number): string {
  let candidate = truncate(base, max).trim() || 'Item';
  let index = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = withSuffix(base, index, max);
    index += 1;
  }
  return candidate;
}

function uniqueFileName(base: string, taken: ReadonlySet<string>, max: number): string {
  let candidate = truncate(base, max).trim() || 'Item';
  let index = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = withFileSuffix(base, index, max);
    index += 1;
  }
  return candidate;
}

function isValidId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value);
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isValidId(value)) {
    throw new MediaLibraryError(400, `${label} is not valid.`);
  }
  return value;
}

function displayName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return truncate(value.trim(), MAX_DISPLAY_NAME) || fallback;
}

function parseSnapshot(value: unknown): MediaWorkspaceSnapshot {
  if (!isRecord(value) || !Array.isArray(value.groups)) {
    throw new MediaLibraryError(400, 'The workspace snapshot is not valid.');
  }
  if (value.groups.length > MAX_GROUPS) {
    throw new MediaLibraryError(400, 'The workspace has too many groups.');
  }
  const groupIds = new Set<string>();
  const groups: MediaWorkspaceGroup[] = [];
  for (const rawGroup of value.groups) {
    if (!isRecord(rawGroup)) {
      throw new MediaLibraryError(400, 'A group in the workspace snapshot is not valid.');
    }
    const id = requiredId(rawGroup.id, 'Group id');
    if (groupIds.has(id)) {
      throw new MediaLibraryError(400, 'The workspace snapshot contains a duplicate group.');
    }
    groupIds.add(id);
    if (!Array.isArray(rawGroup.songs) || rawGroup.songs.length > MAX_SONGS) {
      throw new MediaLibraryError(400, 'A group has an invalid song list.');
    }
    const songIds = new Set<string>();
    const songs: MediaWorkspaceSong[] = [];
    for (const rawSong of rawGroup.songs) {
      if (!isRecord(rawSong)) {
        throw new MediaLibraryError(400, 'A song in the workspace snapshot is not valid.');
      }
      const songId = requiredId(rawSong.id, 'Song id');
      if (songIds.has(songId)) {
        throw new MediaLibraryError(400, 'A group contains a duplicate song.');
      }
      songIds.add(songId);
      songs.push({
        id: songId,
        title: displayName(rawSong.title, 'Untitled song'),
      });
    }
    groups.push({
      id,
      name: displayName(rawGroup.name, 'Untitled group'),
      songs,
    });
  }
  return { groups };
}

function normalizeManifest(value: unknown): MediaManifest {
  if (
    !isRecord(value) ||
    value.version !== MEDIA_MANIFEST_VERSION ||
    !isRecord(value.groups)
  ) {
    throw new MediaLibraryError(400, 'The media manifest is not valid.');
  }
  const groups: Record<string, MediaGroupEntry> = {};
  for (const [groupId, rawGroup] of Object.entries(value.groups)) {
    if (!isValidId(groupId) || !isRecord(rawGroup)) continue;
    const folder = typeof rawGroup.folder === 'string' ? rawGroup.folder : '';
    if (!folder || !isSafeSegment(folder)) continue;
    if (!isRecord(rawGroup.songs)) continue;
    const songs: Record<string, MediaSongEntry> = {};
    for (const [songId, rawSong] of Object.entries(rawGroup.songs)) {
      if (!isValidId(songId) || !isRecord(rawSong)) continue;
      const songFolder = typeof rawSong.folder === 'string' ? rawSong.folder : '';
      if (!songFolder || !isSafeSegment(songFolder)) continue;
      const copies: Partial<Record<MediaKind, MediaCopyRecord>> = {};
      if (isRecord(rawSong.copies)) {
        for (const kind of KINDS) {
          const rawCopy = rawSong.copies[kind];
          if (!isRecord(rawCopy)) continue;
          if (
            typeof rawCopy.originalName !== 'string' ||
            typeof rawCopy.fileName !== 'string' ||
            !isSafeSegment(rawCopy.fileName) ||
            typeof rawCopy.size !== 'number' ||
            !Number.isFinite(rawCopy.size) ||
            rawCopy.size < 0 ||
            typeof rawCopy.updatedAt !== 'string'
          ) {
            continue;
          }
          copies[kind] = {
            originalName: rawCopy.originalName,
            fileName: rawCopy.fileName,
            size: rawCopy.size,
            updatedAt: rawCopy.updatedAt,
          };
        }
      }
      songs[songId] = {
        title: typeof rawSong.title === 'string' ? rawSong.title : '',
        folder: songFolder,
        copies,
      };
    }
    groups[groupId] = {
      name: typeof rawGroup.name === 'string' ? rawGroup.name : '',
      folder,
      songs,
    };
  }
  return {
    version: MEDIA_MANIFEST_VERSION,
    revision:
      typeof value.revision === 'number' && Number.isFinite(value.revision)
        ? Math.max(0, Math.floor(value.revision))
        : 0,
    updatedAt:
      typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    groups,
  };
}

function createEmptyManifest(): MediaManifest {
  return {
    version: MEDIA_MANIFEST_VERSION,
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    groups: {},
  };
}

function isSafeSegment(value: string): boolean {
  if (!value || value === '.' || value === '..') return false;
  if (value.startsWith('.')) return false;
  if (value.endsWith('.') || value.endsWith(' ')) return false;
  return !INVALID_SEGMENT_PATTERN.test(value);
}

function isMediaKind(value: string): value is MediaKind {
  return value === 'audio' || value === 'video';
}

function parseMediaPath(segments: string[]): boolean {
  return (
    segments.length === 6 &&
    segments[0] === 'groups' &&
    segments[2] === 'songs' &&
    isMediaKind(segments[4]) &&
    segments.every((segment) => isSafeSegment(segment))
  );
}

function decodeMediaSegments(raw: string): string[] | null {
  const segments: string[] = [];
  for (const part of raw.split('/')) {
    if (!part) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (!isSafeSegment(decoded)) return null;
    segments.push(decoded);
  }
  return parseMediaPath(segments) ? segments : null;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    const info = await stat(target);
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    const info = await stat(target);
    return info.isFile();
  } catch {
    return false;
  }
}

async function listEntryNames(target: string): Promise<string[]> {
  try {
    const entries = await readdir(target, { withFileTypes: true });
    return entries.map((entry) => entry.name);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
}

async function lowerEntrySet(target: string): Promise<Set<string>> {
  return new Set((await listEntryNames(target)).map((name) => name.toLowerCase()));
}

async function replaceFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EEXIST' || code === 'EPERM' || code === 'ENOTEMPTY') {
      await rm(to, { force: true });
      await rename(from, to);
      return;
    }
    throw error;
  }
}

function planFolderNames(
  items: Array<{ id: string; base: string; current: string | null }>,
  blocked: ReadonlySet<string>,
  max: number,
): Map<string, string> {
  const claimed = new Set<string>();
  const desired = new Map<string, string>();
  for (const item of items) {
    if (!item.current) continue;
    const current = item.current;
    const lower = current.toLowerCase();
    if (
      lower === item.base.toLowerCase() &&
      !blocked.has(lower) &&
      !claimed.has(lower)
    ) {
      desired.set(item.id, current);
      claimed.add(lower);
    }
  }
  for (const item of items) {
    if (desired.has(item.id)) continue;
    const taken = new Set([...blocked, ...claimed]);
    const name = uniqueName(item.base, taken, max);
    desired.set(item.id, name);
    claimed.add(name.toLowerCase());
  }
  for (const item of items) {
    const next = desired.get(item.id);
    if (item.current && next && item.current.toLowerCase() === next.toLowerCase()) {
      desired.set(item.id, item.current);
    }
  }
  return desired;
}

export function parseByteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0 || (match[1] === '' && match[2] === '')) return 'invalid';
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid';
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] === '' ? size - 1 : Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return 'invalid';
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function mimeTypeForFile(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  const types: Record<string, string> = {
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.m4v': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.oga': 'audio/ogg',
    '.ogg': 'audio/ogg',
    '.ogv': 'video/ogg',
    '.opus': 'audio/opus',
    '.wav': 'audio/wav',
    '.weba': 'audio/webm',
    '.webm': 'video/webm',
  };
  return types[extension] ?? 'application/octet-stream';
}

function countManifest(manifest: MediaManifest): MediaCounts {
  const counts: MediaCounts = { groups: 0, songs: 0, audio: 0, video: 0 };
  for (const group of Object.values(manifest.groups)) {
    counts.groups += 1;
    for (const song of Object.values(group.songs)) {
      counts.songs += 1;
      if (song.copies.audio) counts.audio += 1;
      if (song.copies.video) counts.video += 1;
    }
  }
  return counts;
}

function mediaUrlForRelativePath(relativePath: string): string {
  return `${FILE_PREFIX}${relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

export class MediaLibrary {
  readonly projectRoot: string;
  readonly root: string;
  readonly relativeRoot: string;
  readonly manifestPath: string;
  readonly groupsRoot: string;
  private readonly tmpRoot: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(projectRoot: string, libraryDir = DEFAULT_MEDIA_DIR) {
    this.projectRoot = path.resolve(projectRoot);
    this.root = path.resolve(this.projectRoot, libraryDir);
    const relative = path.relative(this.projectRoot, this.root);
    this.relativeRoot = (relative || '.').split(path.sep).join('/');
    this.manifestPath = path.join(this.root, MANIFEST_FILE);
    this.groupsRoot = path.join(this.root, 'groups');
    this.tmpRoot = path.join(this.root, '.tmp');
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async loadManifest(): Promise<MediaManifest> {
    let text: string;
    try {
      text = await readFile(this.manifestPath, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return createEmptyManifest();
      throw error;
    }
    try {
      return normalizeManifest(JSON.parse(text) as unknown);
    } catch {
      const backup = `${this.manifestPath}.corrupt-${Date.now()}`;
      await rename(this.manifestPath, backup).catch(() => undefined);
      return createEmptyManifest();
    }
  }

  private async saveManifest(manifest: MediaManifest): Promise<void> {
    manifest.revision = (manifest.revision ?? 0) + 1;
    manifest.updatedAt = new Date().toISOString();
    await mkdir(this.root, { recursive: true });
    const temp = `${this.manifestPath}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await replaceFile(temp, this.manifestPath);
  }

  private payload(manifest: MediaManifest, warnings: string[]): MediaStatusPayload {
    return {
      available: true,
      libraryPath: this.relativeRoot,
      absolutePath: this.root,
      manifest,
      counts: countManifest(manifest),
      syncedAt: manifest.updatedAt,
      warnings,
    };
  }

  async status(): Promise<MediaStatusPayload> {
    return this.enqueue(async () => {
      const manifest = await this.loadManifest();
      const changed = await this.pruneMissingCopies(manifest);
      if (changed) await this.saveManifest(manifest);
      return this.payload(manifest, []);
    });
  }

  async sync(value: unknown): Promise<MediaStatusPayload> {
    const snapshot = parseSnapshot(value);
    return this.enqueue(async () => {
      const manifest = await this.loadManifest();
      const warnings: string[] = [];
      await this.cleanupStaleTemps();
      await this.reconcile(manifest, snapshot, warnings);
      await this.pruneMissingCopies(manifest);
      await this.saveManifest(manifest);
      return this.payload(manifest, warnings);
    });
  }

  private async reconcile(
    manifest: MediaManifest,
    snapshot: MediaWorkspaceSnapshot,
    warnings: string[],
  ): Promise<void> {
    await mkdir(this.groupsRoot, { recursive: true });
    await this.dropDeletedEntriesWithMissingFolders(manifest, snapshot);
    await this.reconcileGroups(manifest, snapshot.groups, warnings);
    for (const group of snapshot.groups) {
      const entry = manifest.groups[group.id];
      if (!entry) continue;
      await mkdir(path.join(this.groupsRoot, entry.folder), { recursive: true });
      await this.reconcileSongs(entry, group.songs, warnings);
    }
    await rmdir(this.tmpRoot).catch(() => undefined);
  }

  private async dropDeletedEntriesWithMissingFolders(
    manifest: MediaManifest,
    snapshot: MediaWorkspaceSnapshot,
  ): Promise<void> {
    const groupIds = new Set(snapshot.groups.map((group) => group.id));
    for (const [groupId, group] of Object.entries(manifest.groups)) {
      if (!groupIds.has(groupId)) {
        if (!(await pathExists(path.join(this.groupsRoot, group.folder)))) {
          delete manifest.groups[groupId];
        }
        continue;
      }
      const songIds = new Set(
        snapshot.groups.find((entry) => entry.id === groupId)?.songs.map((song) => song.id) ??
          [],
      );
      for (const [songId, song] of Object.entries(group.songs)) {
        if (songIds.has(songId)) continue;
        if (!(await pathExists(path.join(this.groupsRoot, group.folder, 'songs', song.folder)))) {
          delete group.songs[songId];
        }
      }
    }
  }

  private async reconcileGroups(
    manifest: MediaManifest,
    groups: MediaWorkspaceGroup[],
    warnings: string[],
  ): Promise<void> {
    const existing = await listEntryNames(this.groupsRoot);
    const snapshotIds = new Set(groups.map((group) => group.id));
    const owned = new Set(
      Object.values(manifest.groups).map((entry) => entry.folder.toLowerCase()),
    );
    const blocked = new Set<string>();
    for (const [groupId, entry] of Object.entries(manifest.groups)) {
      if (!snapshotIds.has(groupId)) blocked.add(entry.folder.toLowerCase());
    }
    for (const name of existing) {
      const lower = name.toLowerCase();
      if (!owned.has(lower)) blocked.add(lower);
    }

    const items = groups.map((group) => ({
      id: group.id,
      base: sanitizeSegment(group.name, 'Untitled group'),
      current: manifest.groups[group.id]?.folder ?? null,
    }));
    const desired = planFolderNames(items, blocked, MAX_FOLDER_NAME);
    const moves: FolderMove[] = [];
    for (const group of groups) {
      const entry = manifest.groups[group.id];
      if (!entry) continue;
      const to = desired.get(group.id);
      if (!to || entry.folder === to) continue;
      if (entry.folder.toLowerCase() === to.toLowerCase()) {
        desired.set(group.id, entry.folder);
        continue;
      }
      const fromPath = path.join(this.groupsRoot, entry.folder);
      if (await pathExists(fromPath)) {
        moves.push({
          id: group.id,
          from: entry.folder,
          to,
          fromPath,
          tempPath: path.join(this.tmpRoot, `group-${randomBytes(6).toString('hex')}.dir`),
        });
      }
    }

    if (moves.length > 0) await mkdir(this.tmpRoot, { recursive: true });
    const staged = new Map<string, FolderMove>();
    for (const move of moves) {
      try {
        await rename(move.fromPath, move.tempPath);
        staged.set(move.id, move);
      } catch {
        warnings.push(
          `Could not rename the folder for "${displayName(
            groups.find((group) => group.id === move.id)?.name,
            'Untitled group',
          )}". Its files were left where they were.`,
        );
      }
    }

    for (const group of groups) {
      let entry = manifest.groups[group.id];
      if (!entry) {
        entry = { name: group.name, folder: '', songs: {} };
        manifest.groups[group.id] = entry;
      }
      entry.name = group.name;
      entry.songs = entry.songs ?? {};
      const move = staged.get(group.id);
      if (move) {
        let targetName = desired.get(group.id) ?? move.to;
        let targetPath = path.join(this.groupsRoot, targetName);
        if (await pathExists(targetPath)) {
          targetName = uniqueName(
            sanitizeSegment(group.name, 'Untitled group'),
            await lowerEntrySet(this.groupsRoot),
            MAX_FOLDER_NAME,
          );
          targetPath = path.join(this.groupsRoot, targetName);
        }
        try {
          await rename(move.tempPath, targetPath);
          entry.folder = targetName;
        } catch {
          warnings.push(
            `Could not finish renaming the folder for "${group.name || 'Untitled group'}".`,
          );
          await rename(move.tempPath, move.fromPath).catch(() => undefined);
          entry.folder = move.from;
        }
        continue;
      }

      if (entry.folder && (await pathExists(path.join(this.groupsRoot, entry.folder)))) {
        continue;
      }
      let targetName = desired.get(group.id) ?? sanitizeSegment(group.name, 'Untitled group');
      let targetPath = path.join(this.groupsRoot, targetName);
      if (await pathExists(targetPath)) {
        targetName = uniqueName(
          sanitizeSegment(group.name, 'Untitled group'),
          await lowerEntrySet(this.groupsRoot),
          MAX_FOLDER_NAME,
        );
        targetPath = path.join(this.groupsRoot, targetName);
      }
      try {
        await mkdir(targetPath, { recursive: true });
        entry.folder = targetName;
      } catch {
        warnings.push(`Could not create the folder for "${group.name || 'Untitled group'}".`);
      }
    }
  }

  private async reconcileSongs(
    group: MediaGroupEntry,
    songs: MediaWorkspaceSong[],
    warnings: string[],
  ): Promise<void> {
    const songsRoot = path.join(this.groupsRoot, group.folder, 'songs');
    await mkdir(songsRoot, { recursive: true });
    const existing = await listEntryNames(songsRoot);
    const snapshotIds = new Set(songs.map((song) => song.id));
    const owned = new Set(Object.values(group.songs).map((song) => song.folder.toLowerCase()));
    const blocked = new Set<string>();
    for (const [songId, song] of Object.entries(group.songs)) {
      if (!snapshotIds.has(songId)) blocked.add(song.folder.toLowerCase());
    }
    for (const name of existing) {
      const lower = name.toLowerCase();
      if (!owned.has(lower)) blocked.add(lower);
    }

    const items = songs.map((song) => ({
      id: song.id,
      base: sanitizeSegment(song.title, 'Untitled song'),
      current: group.songs[song.id]?.folder ?? null,
    }));
    const desired = planFolderNames(items, blocked, MAX_FOLDER_NAME);
    const moves: FolderMove[] = [];
    for (const song of songs) {
      const entry = group.songs[song.id];
      if (!entry) continue;
      const to = desired.get(song.id);
      if (!to || entry.folder === to) continue;
      if (entry.folder.toLowerCase() === to.toLowerCase()) {
        desired.set(song.id, entry.folder);
        continue;
      }
      const fromPath = path.join(songsRoot, entry.folder);
      if (await pathExists(fromPath)) {
        moves.push({
          id: song.id,
          from: entry.folder,
          to,
          fromPath,
          tempPath: path.join(this.tmpRoot, `song-${randomBytes(6).toString('hex')}.dir`),
        });
      }
    }

    if (moves.length > 0) await mkdir(this.tmpRoot, { recursive: true });
    const staged = new Map<string, FolderMove>();
    for (const move of moves) {
      try {
        await rename(move.fromPath, move.tempPath);
        staged.set(move.id, move);
      } catch {
        warnings.push(
          `Could not rename the song folder for "${displayName(
            songs.find((song) => song.id === move.id)?.title,
            'Untitled song',
          )}". Its files were left where they were.`,
        );
      }
    }

    for (const song of songs) {
      let entry = group.songs[song.id];
      if (!entry) {
        entry = { title: song.title, folder: '', copies: {} };
        group.songs[song.id] = entry;
      }
      entry.title = song.title;
      entry.copies = entry.copies ?? {};
      const move = staged.get(song.id);
      if (move) {
        let targetName = desired.get(song.id) ?? move.to;
        let targetPath = path.join(songsRoot, targetName);
        if (await pathExists(targetPath)) {
          targetName = uniqueName(
            sanitizeSegment(song.title, 'Untitled song'),
            await lowerEntrySet(songsRoot),
            MAX_FOLDER_NAME,
          );
          targetPath = path.join(songsRoot, targetName);
        }
        try {
          await rename(move.tempPath, targetPath);
          entry.folder = targetName;
        } catch {
          warnings.push(
            `Could not finish renaming the song folder for "${song.title || 'Untitled song'}".`,
          );
          await rename(move.tempPath, move.fromPath).catch(() => undefined);
          entry.folder = move.from;
        }
      } else if (!entry.folder || !(await pathExists(path.join(songsRoot, entry.folder)))) {
        let targetName = desired.get(song.id) ?? sanitizeSegment(song.title, 'Untitled song');
        let targetPath = path.join(songsRoot, targetName);
        if (await pathExists(targetPath)) {
          targetName = uniqueName(
            sanitizeSegment(song.title, 'Untitled song'),
            await lowerEntrySet(songsRoot),
            MAX_FOLDER_NAME,
          );
          targetPath = path.join(songsRoot, targetName);
        }
        try {
          await mkdir(targetPath, { recursive: true });
          entry.folder = targetName;
        } catch {
          warnings.push(`Could not create the song folder for "${song.title || 'Untitled song'}".`);
        }
      }

      if (!entry.folder) continue;
      try {
        await mkdir(path.join(songsRoot, entry.folder, 'audio'), { recursive: true });
        await mkdir(path.join(songsRoot, entry.folder, 'video'), { recursive: true });
      } catch {
        warnings.push(`Could not create media folders for "${song.title || 'Untitled song'}".`);
      }
    }
  }

  private async ensureGroup(
    manifest: MediaManifest,
    groupId: string,
    groupName: string,
  ): Promise<MediaGroupEntry> {
    await mkdir(this.groupsRoot, { recursive: true });
    const existing = manifest.groups[groupId];
    if (existing) {
      existing.name = groupName;
      existing.songs = existing.songs ?? {};
      if (existing.folder && (await pathExists(path.join(this.groupsRoot, existing.folder)))) {
        return existing;
      }
      const base = sanitizeSegment(existing.folder || groupName, 'Untitled group');
      let folder = base;
      const taken = await lowerEntrySet(this.groupsRoot);
      if (taken.has(folder.toLowerCase())) {
        folder = uniqueName(base, taken, MAX_FOLDER_NAME);
      }
      await mkdir(path.join(this.groupsRoot, folder), { recursive: true });
      existing.folder = folder;
      return existing;
    }
    const base = sanitizeSegment(groupName, 'Untitled group');
    const folder = uniqueName(base, await lowerEntrySet(this.groupsRoot), MAX_FOLDER_NAME);
    await mkdir(path.join(this.groupsRoot, folder), { recursive: true });
    const entry: MediaGroupEntry = { name: groupName, folder, songs: {} };
    manifest.groups[groupId] = entry;
    return entry;
  }

  private async ensureSong(
    group: MediaGroupEntry,
    songId: string,
    songTitle: string,
  ): Promise<MediaSongEntry> {
    const songsRoot = path.join(this.groupsRoot, group.folder, 'songs');
    await mkdir(songsRoot, { recursive: true });
    const existing = group.songs[songId];
    if (existing) {
      existing.title = songTitle;
      existing.copies = existing.copies ?? {};
      if (existing.folder && (await pathExists(path.join(songsRoot, existing.folder)))) {
        return existing;
      }
      const base = sanitizeSegment(existing.folder || songTitle, 'Untitled song');
      let folder = base;
      const taken = await lowerEntrySet(songsRoot);
      if (taken.has(folder.toLowerCase())) {
        folder = uniqueName(base, taken, MAX_FOLDER_NAME);
      }
      await mkdir(path.join(songsRoot, folder), { recursive: true });
      existing.folder = folder;
      return existing;
    }
    const base = sanitizeSegment(songTitle, 'Untitled song');
    const folder = uniqueName(base, await lowerEntrySet(songsRoot), MAX_FOLDER_NAME);
    await mkdir(path.join(songsRoot, folder), { recursive: true });
    const entry: MediaSongEntry = { title: songTitle, folder, copies: {} };
    group.songs[songId] = entry;
    return entry;
  }

  async saveUpload(input: MediaUploadInput): Promise<MediaCopyResponse> {
    const groupId = requiredId(input.groupId, 'Group id');
    const songId = requiredId(input.songId, 'Song id');
    if (!isMediaKind(input.kind)) {
      throw new MediaLibraryError(400, 'Media kind must be audio or video.');
    }
    if (typeof input.filename !== 'string' || input.filename.length === 0) {
      throw new MediaLibraryError(400, 'A file name is required.');
    }
    if (input.sizeHint !== undefined && input.sizeHint > MAX_UPLOAD_BYTES) {
      throw new MediaLibraryError(413, 'That file is too large for the media library.');
    }
    const groupName = displayName(input.groupName, 'Untitled group');
    const songTitle = displayName(input.songTitle, 'Untitled song');

    await mkdir(this.tmpRoot, { recursive: true });
    const tempPath = path.join(
      this.tmpRoot,
      `upload-${randomBytes(8).toString('hex')}.part`,
    );
    const writer = createWriteStream(tempPath, { flags: 'wx' });
    let bytes = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const fail = (error: unknown) => {
          if (settled) return;
          settled = true;
          input.stream.unpipe(writer);
          writer.destroy();
          reject(error);
        };
        input.stream.on('data', (chunk: Buffer | string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > MAX_UPLOAD_BYTES) {
            fail(new MediaLibraryError(413, 'That file is too large for the media library.'));
          }
        });
        input.stream.once('error', fail);
        input.stream.once('aborted', () => {
          fail(new MediaLibraryError(499, 'The upload was cancelled.'));
        });
        writer.once('error', fail);
        writer.once('finish', () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        input.stream.pipe(writer);
      });

      const info = await stat(tempPath);
      if (!info.isFile() || info.size <= 0) {
        throw new MediaLibraryError(400, 'The uploaded file was empty.');
      }
      return await this.commitUpload({
        groupId,
        groupName,
        songId,
        songTitle,
        kind: input.kind,
        filename: input.filename,
        tempPath,
        size: info.size,
      });
    } catch (error) {
      writer.destroy();
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async saveImport(input: {
    groupId: string;
    groupName: string;
    songId: string;
    songTitle: string;
    kind: MediaKind;
    filename: string;
    tempPath: string;
    size: number;
  }): Promise<MediaCopyResponse> {
    const groupId = requiredId(input.groupId, 'Group id');
    const songId = requiredId(input.songId, 'Song id');
    if (!isMediaKind(input.kind)) {
      throw new MediaLibraryError(400, 'Media kind must be audio or video.');
    }
    if (typeof input.filename !== 'string' || input.filename.length === 0) {
      throw new MediaLibraryError(400, 'A file name is required.');
    }
    if (!Number.isFinite(input.size) || input.size <= 0) {
      throw new MediaLibraryError(400, 'The imported file was empty.');
    }
    const tempPath = path.resolve(input.tempPath);
    const tmpRoot = path.resolve(this.tmpRoot);
    const relative = path.relative(tmpRoot, tempPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new MediaLibraryError(400, 'The imported file is not inside the media temp folder.');
    }
    const info = await stat(tempPath).catch(() => null);
    if (!info?.isFile() || info.size <= 0) {
      throw new MediaLibraryError(400, 'The imported file could not be read.');
    }
    if (info.size > MAX_UPLOAD_BYTES) {
      throw new MediaLibraryError(413, 'That file is too large for the media library.');
    }
    return this.commitUpload({
      groupId,
      groupName: displayName(input.groupName, 'Untitled group'),
      songId,
      songTitle: displayName(input.songTitle, 'Untitled song'),
      kind: input.kind,
      filename: input.filename,
      tempPath,
      size: info.size,
    });
  }

  private async commitUpload(input: {
    groupId: string;
    groupName: string;
    songId: string;
    songTitle: string;
    kind: MediaKind;
    filename: string;
    tempPath: string;
    size: number;
  }): Promise<MediaCopyResponse> {
    return this.enqueue(async () => {
      const manifest = await this.loadManifest();
      const group = await this.ensureGroup(manifest, input.groupId, input.groupName);
      const song = await this.ensureSong(group, input.songId, input.songTitle);
      const kindRoot = path.join(this.groupsRoot, group.folder, 'songs', song.folder, input.kind);
      await mkdir(kindRoot, { recursive: true });
      const base = sanitizeFileName(input.filename, input.kind);
      const existing = await listEntryNames(kindRoot);
      const byLower = new Map(existing.map((name) => [name.toLowerCase(), name]));
      const match = byLower.get(base.toLowerCase());
      let fileName: string | null = null;
      let reused = false;
      if (match) {
        const matchPath = path.join(kindRoot, match);
        const matchInfo = await stat(matchPath).catch(() => null);
        if (matchInfo?.isFile() && matchInfo.size === input.size) {
          fileName = match;
          reused = true;
        }
      }
      if (reused && fileName) {
        await rm(input.tempPath, { force: true });
      } else {
        const taken = new Set(existing.map((name) => name.toLowerCase()));
        let candidate = uniqueFileName(base, taken, MAX_FILE_NAME);
        let saved = false;
        for (let attempt = 0; attempt < 25; attempt += 1) {
          const target = path.join(kindRoot, candidate);
          try {
            await rename(input.tempPath, target);
            fileName = candidate;
            saved = true;
            break;
          } catch (error) {
            const code = errorCode(error);
            if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error;
            taken.add(candidate.toLowerCase());
            candidate = uniqueFileName(base, taken, MAX_FILE_NAME);
          }
        }
        if (!saved || !fileName) {
          throw new MediaLibraryError(500, 'Could not save the file into the media library.');
        }
      }

      const copy: MediaCopyRecord = {
        originalName: input.filename,
        fileName,
        size: input.size,
        updatedAt: new Date().toISOString(),
      };
      song.copies[input.kind] = copy;
      await this.saveManifest(manifest);

      const relativePath = [
        'groups',
        group.folder,
        'songs',
        song.folder,
        input.kind,
        fileName,
      ].join('/');
      return {
        copy,
        groupId: input.groupId,
        songId: input.songId,
        kind: input.kind,
        groupFolder: group.folder,
        songFolder: song.folder,
        relativePath,
        url: mediaUrlForRelativePath(relativePath),
        reused,
        manifestRevision: manifest.revision,
      };
    });
  }

  private async pruneMissingCopies(manifest: MediaManifest): Promise<boolean> {
    let changed = false;
    for (const group of Object.values(manifest.groups)) {
      for (const song of Object.values(group.songs)) {
        for (const kind of KINDS) {
          const copy = song.copies[kind];
          if (!copy) continue;
          const target = path.join(
            this.groupsRoot,
            group.folder,
            'songs',
            song.folder,
            kind,
            copy.fileName,
          );
          if (!(await isFile(target))) {
            delete song.copies[kind];
            changed = true;
          }
        }
      }
    }
    return changed;
  }

  async statMediaFile(segments: string[]): Promise<MediaFileInfo | null> {
    if (!parseMediaPath(segments)) return null;
    const target = path.resolve(this.root, ...segments);
    const root = path.resolve(this.root);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
    let realTarget: string;
    let realRoot: string;
    try {
      realRoot = await realpath(root);
      realTarget = await realpath(target);
    } catch {
      return null;
    }
    if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
      return null;
    }
    try {
      const info = await stat(realTarget);
      if (!info.isFile()) return null;
      return { path: realTarget, size: info.size, mtime: info.mtime };
    } catch {
      return null;
    }
  }

  private async cleanupStaleTemps(): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.tmpRoot, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
    const cutoff = Date.now() - TEMP_MAX_AGE_MS;
    for (const entry of entries) {
      const target = path.join(this.tmpRoot, entry.name);
      try {
        const info = await stat(target);
        if (info.mtimeMs < cutoff) await rm(target, { recursive: true, force: true });
      } catch {
        // A leftover temp file that cannot be inspected is harmless.
      }
    }
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]';
}

function isTrustedMediaRequest(request: IncomingMessage): boolean {
  const host = request.headers.host;
  if (!host) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  if (!isLoopbackHostname(hostname)) return false;
  const origin = request.headers.origin;
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (!isLoopbackHostname(parsed.hostname)) return false;
      if (parsed.host.toLowerCase() !== host.toLowerCase()) return false;
    } catch {
      return false;
    }
  }
  return request.headers['sec-fetch-site'] !== 'cross-site';
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  headOnly = false,
): void {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(headOnly ? undefined : body);
}

function methodNotAllowed(response: ServerResponse): void {
  response.setHeader('Allow', 'GET, HEAD, POST');
  sendJson(response, 405, { error: 'That method is not supported.' });
}

async function readJsonBody(request: IncomingMessage, limit: number): Promise<unknown> {
  const rawLength = request.headers['content-length'];
  if (rawLength !== undefined) {
    const length = Number(rawLength);
    if (Number.isFinite(length) && length > limit) {
      throw new MediaLibraryError(413, 'The request body is too large.');
    }
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      throw new MediaLibraryError(413, 'The request body is too large.');
    }
    chunks.push(buffer);
  }
  if (size === 0) throw new MediaLibraryError(400, 'The request body is empty.');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new MediaLibraryError(400, 'The request body must be valid JSON.');
  }
}

async function serveMediaFile(
  request: IncomingMessage,
  response: ServerResponse,
  library: MediaLibrary,
  segments: string[],
): Promise<void> {
  const info = await library.statMediaFile(segments);
  if (!info) {
    sendJson(response, 404, { error: 'That media file was not found.' });
    return;
  }
  const fileName = segments[segments.length - 1] ?? '';
  const commonHeaders: Record<string, string | number> = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Type': mimeTypeForFile(fileName),
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Last-Modified': info.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  };
  const range = parseByteRange(request.headers.range, info.size);
  if (range === 'invalid') {
    response.writeHead(416, {
      ...commonHeaders,
      'Content-Range': `bytes */${info.size}`,
      'Content-Length': 0,
    });
    response.end();
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, info.size - 1);
  const length = info.size === 0 ? 0 : end - start + 1;
  response.writeHead(range ? 206 : 200, {
    ...commonHeaders,
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}),
    'Content-Length': length,
  });
  if (request.method === 'HEAD' || length === 0) {
    response.end();
    return;
  }
  const stream = createReadStream(info.path, { start, end });
  stream.on('error', () => {
    response.destroy();
  });
  response.on('close', () => {
    stream.destroy();
  });
  stream.pipe(response);
}

async function handleMediaRequest(
  request: IncomingMessage,
  response: ServerResponse,
  library: MediaLibrary,
  importer: MediaImporter,
  url: URL,
): Promise<void> {
  if (!isTrustedMediaRequest(request)) {
    sendJson(response, 403, { error: 'The media library only accepts local app requests.' });
    return;
  }

  if (url.pathname === `${MEDIA_BASE_PATH}/status`) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      methodNotAllowed(response);
      return;
    }
    const [payload, tools] = await Promise.all([
      library.status(),
      importer.describeTools(),
    ]);
    const body: MediaStatusResponse = { ...payload, tools };
    sendJson(response, 200, body, request.method === 'HEAD');
    return;
  }

  if (url.pathname === `${MEDIA_BASE_PATH}/sync`) {
    if (request.method !== 'POST') {
      methodNotAllowed(response);
      return;
    }
    const body = await readJsonBody(request, MAX_JSON_BODY);
    const [payload, tools] = await Promise.all([
      library.sync(body),
      importer.describeTools(),
    ]);
    const result: MediaStatusResponse = { ...payload, tools };
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === `${MEDIA_BASE_PATH}/probe`) {
    if (request.method !== 'POST') {
      methodNotAllowed(response);
      return;
    }
    const body = await readJsonBody(request, MAX_JSON_BODY);
    sendJson(response, 200, await importer.probe(body));
    return;
  }

  if (url.pathname === `${MEDIA_BASE_PATH}/import`) {
    if (request.method !== 'POST') {
      methodNotAllowed(response);
      return;
    }
    const body = await readJsonBody(request, MAX_JSON_BODY);
    sendJson(response, 202, await importer.start(body));
    return;
  }

  if (url.pathname.startsWith(`${MEDIA_BASE_PATH}/import/`)) {
    const jobId = url.pathname.slice(`${MEDIA_BASE_PATH}/import/`.length);
    if (!jobId || jobId.includes('/')) {
      sendJson(response, 404, { error: 'That import was not found.' });
      return;
    }
    if (request.method === 'GET') {
      const job = importer.get(jobId);
      if (!job) {
        sendJson(response, 404, { error: 'That import was not found.' });
        return;
      }
      sendJson(response, 200, job);
      return;
    }
    if (request.method === 'DELETE') {
      const result = await importer.cancel(jobId);
      if (!result) {
        sendJson(response, 404, { error: 'That import was not found.' });
        return;
      }
      sendJson(response, 200, result);
      return;
    }
    response.setHeader('Allow', 'GET, DELETE');
    sendJson(response, 405, { error: 'That method is not supported.' });
    return;
  }

  if (url.pathname === `${MEDIA_BASE_PATH}/copy`) {
    if (request.method !== 'POST') {
      methodNotAllowed(response);
      return;
    }
    const groupId = url.searchParams.get('groupId') ?? '';
    const songId = url.searchParams.get('songId') ?? '';
    const kind = url.searchParams.get('kind') ?? '';
    const filename = url.searchParams.get('filename') ?? '';
    if (!isMediaKind(kind)) {
      throw new MediaLibraryError(400, 'Media kind must be audio or video.');
    }
    const rawLength = request.headers['content-length'];
    const sizeHint =
      rawLength === undefined || rawLength === '' ? undefined : Number(rawLength);
    const result = await library.saveUpload({
      groupId,
      groupName: url.searchParams.get('groupName') ?? '',
      songId,
      songTitle: url.searchParams.get('songTitle') ?? '',
      kind,
      filename,
      stream: request,
      sizeHint: sizeHint !== undefined && Number.isFinite(sizeHint) ? sizeHint : undefined,
    });
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname.startsWith(FILE_PREFIX)) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      methodNotAllowed(response);
      return;
    }
    const segments = decodeMediaSegments(url.pathname.slice(FILE_PREFIX.length));
    if (!segments) {
      sendJson(response, 404, { error: 'That media file was not found.' });
      return;
    }
    await serveMediaFile(request, response, library, segments);
    return;
  }

  sendJson(response, 404, { error: 'That media library endpoint was not found.' });
}

export interface MediaSyncPluginOptions {
  libraryDir?: string;
}

export function mediaSyncPlugin(options: MediaSyncPluginOptions = {}): Plugin {
  return {
    name: 'idolytics-media-library',
    apply: 'serve',
    configureServer(server) {
      const mediaRoot = path.resolve(
        server.config.root,
        options.libraryDir ?? DEFAULT_MEDIA_DIR,
      );
      const library = new MediaLibrary(
        server.config.root,
        options.libraryDir ?? DEFAULT_MEDIA_DIR,
      );
      const importer = new MediaImporter({
        root: server.config.root,
        mediaRoot,
        library,
        logger: {
          info: (message) => server.config.logger.info(message),
          warn: (message) => server.config.logger.warn(message),
          error: (message) => server.config.logger.error(message),
        },
      });
      server.config.logger.info(
        `[idolytics] media library: ${library.relativeRoot}/`,
      );
      server.httpServer?.once('close', () => importer.dispose());
      server.middlewares.use((request, response, next) => {
        if (!request.url) {
          next();
          return;
        }
        let url: URL;
        try {
          url = new URL(request.url, 'http://localhost');
        } catch {
          next();
          return;
        }
        if (
          url.pathname !== MEDIA_BASE_PATH &&
          !url.pathname.startsWith(`${MEDIA_BASE_PATH}/`)
        ) {
          next();
          return;
        }
        void handleMediaRequest(request, response, library, importer, url).catch(
          (error: unknown) => {
            if (response.writableEnded || response.destroyed) return;
            if (error instanceof MediaLibraryError || error instanceof MediaImportError) {
              sendJson(response, error.statusCode, { error: error.message });
              return;
            }
            server.config.logger.error(`[idolytics] media request failed: ${String(error)}`);
            sendJson(response, 500, {
              error: 'The media library could not complete that request.',
            });
          },
        );
      });
    },
  };
}
