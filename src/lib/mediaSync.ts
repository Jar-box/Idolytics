import type { Workspace } from '../domain/schema';
import {
  MEDIA_BASE_PATH,
  isTerminalMediaImportState,
  type MediaCopyRecord,
  type MediaCopyResponse,
  type MediaImportCancelResponse,
  type MediaImportJob,
  type MediaImportRequest,
  type MediaImportStartResponse,
  type MediaManifest,
  type MediaProbeResponse,
  type MediaStatusResponse,
  type MediaSyncResponse,
  type MediaWorkspaceSnapshot,
} from './mediaTypes';

export class MediaApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'MediaApiError';
    this.status = status;
  }
}

export function mediaLibrarySupported(): boolean {
  return import.meta.env.DEV;
}

export function workspaceToMediaSnapshot(workspace: Workspace): MediaWorkspaceSnapshot {
  return {
    groups: workspace.groups.map((group) => ({
      id: group.id,
      name: group.name,
      songs: group.songs.map((song) => ({ id: song.id, title: song.title })),
    })),
  };
}

export function mediaSnapshotSignature(snapshot: MediaWorkspaceSnapshot): string {
  return JSON.stringify(snapshot);
}

export function chooseNewerManifest(
  current: MediaManifest | null,
  incoming: MediaManifest,
): MediaManifest {
  if (current && current.revision > incoming.revision) return current;
  return incoming;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnavailableStatus(status: number): boolean {
  return status === 0 || status === 502 || status === 503 || status === 504;
}

interface RequestInitLike {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function requestJson<T>(
  url: string,
  init: RequestInitLike,
  timeoutMs = 8000,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const handleExternalAbort = () => controller.abort();
  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener('abort', handleExternalAbort, { once: true });
  }
  try {
    const response = await fetch(url, {
      method: init.method,
      body: init.body,
      headers: { Accept: 'application/json', ...init.headers },
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = null;
      }
    }
    if (!response.ok) {
      const message = isUnavailableStatus(response.status)
        ? 'The media library is unavailable. Start the app with npm run dev.'
        : isRecord(data) && typeof data.error === 'string'
          ? data.error
          : `The media library request failed (${response.status}).`;
      throw new MediaApiError(response.status, message);
    }
    if (data === null) {
      throw new MediaApiError(
        response.status,
        'The media library returned an empty response.',
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof MediaApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new MediaApiError(0, 'The media library did not respond in time.');
    }
    throw new MediaApiError(
      0,
      'The media library is unavailable. Start the app with npm run dev.',
    );
  } finally {
    window.clearTimeout(timer);
    init.signal?.removeEventListener('abort', handleExternalAbort);
  }
}

export function getMediaStatus(): Promise<MediaStatusResponse> {
  return requestJson<MediaStatusResponse>(`${MEDIA_BASE_PATH}/status`, { method: 'GET' });
}

export function probeMediaUrl(
  url: string,
  options: { signal?: AbortSignal } = {},
): Promise<MediaProbeResponse> {
  return requestJson<MediaProbeResponse>(
    `${MEDIA_BASE_PATH}/probe`,
    {
      method: 'POST',
      body: JSON.stringify({ url }),
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
    },
    50_000,
  );
}

export function startMediaImport(
  request: MediaImportRequest,
): Promise<MediaImportStartResponse> {
  return requestJson<MediaImportStartResponse>(
    `${MEDIA_BASE_PATH}/import`,
    {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'Content-Type': 'application/json' },
    },
    15000,
  );
}

export function getMediaImport(jobId: string): Promise<MediaImportJob> {
  return requestJson<MediaImportJob>(
    `${MEDIA_BASE_PATH}/import/${encodeURIComponent(jobId)}`,
    { method: 'GET' },
  );
}

export function cancelMediaImport(jobId: string): Promise<MediaImportCancelResponse> {
  return requestJson<MediaImportCancelResponse>(
    `${MEDIA_BASE_PATH}/import/${encodeURIComponent(jobId)}`,
    { method: 'DELETE' },
  );
}

export interface WatchMediaImportOptions {
  intervalMs?: number;
  signal?: AbortSignal;
  onUpdate?: (job: MediaImportJob) => void;
}

function waitForImportPoll(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new MediaApiError(0, 'The import was cancelled.'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      window.clearTimeout(timer);
      reject(new MediaApiError(0, 'The import was cancelled.'));
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

export async function watchMediaImport(
  jobId: string,
  options: WatchMediaImportOptions = {},
): Promise<MediaImportJob> {
  const interval = Math.max(250, options.intervalMs ?? 900);
  for (;;) {
    if (options.signal?.aborted) {
      throw new MediaApiError(0, 'The import was cancelled.');
    }
    const job = await getMediaImport(jobId);
    options.onUpdate?.(job);
    if (isTerminalMediaImportState(job.state)) return job;
    await waitForImportPoll(interval, options.signal);
  }
}

export function syncMediaLibrary(
  snapshot: MediaWorkspaceSnapshot,
): Promise<MediaSyncResponse> {
  return requestJson<MediaSyncResponse>(
    `${MEDIA_BASE_PATH}/sync`,
    {
      method: 'POST',
      body: JSON.stringify(snapshot),
      headers: { 'Content-Type': 'application/json' },
    },
    12000,
  );
}

export function mediaFileUrl(relativePath: string): string {
  return `${MEDIA_BASE_PATH}/file/${relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

export interface ResolvedMediaCopy {
  url: string;
  relativePath: string;
  copy: MediaCopyRecord;
}

export function resolveMediaCopy(
  manifest: MediaManifest | null | undefined,
  groupId: string,
  songId: string,
  kind: 'audio' | 'video',
  storedName: string | null,
): ResolvedMediaCopy | null {
  if (!manifest || !storedName) return null;
  const group = manifest.groups[groupId];
  const song = group?.songs[songId];
  const copy = song?.copies[kind];
  if (!group || !song || !copy) return null;
  if (copy.originalName !== storedName && copy.fileName !== storedName) return null;
  const relativePath = [
    'groups',
    group.folder,
    'songs',
    song.folder,
    kind,
    copy.fileName,
  ].join('/');
  return { url: mediaFileUrl(relativePath), relativePath, copy };
}

export function mediaDestination(
  relativePath: string,
  libraryPath: string | null,
): string {
  const root = (libraryPath ?? 'media').replace(/\\/g, '/').replace(/\/+$/, '');
  return `${root}/${relativePath}`;
}

export function countMediaCopies(manifest: MediaManifest | null): {
  audio: number;
  video: number;
} {
  let audio = 0;
  let video = 0;
  if (!manifest) return { audio, video };
  for (const group of Object.values(manifest.groups)) {
    for (const song of Object.values(group.songs)) {
      if (song.copies.audio) audio += 1;
      if (song.copies.video) video += 1;
    }
  }
  return { audio, video };
}

export interface CopyMediaRequest {
  groupId: string;
  groupName: string;
  songId: string;
  songTitle: string;
  kind: 'audio' | 'video';
  file: File;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export function copyMediaFile(request: CopyMediaRequest): Promise<MediaCopyResponse> {
  return new Promise((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      reject(new MediaApiError(0, 'The media library is not available in this browser.'));
      return;
    }
    const params = new URLSearchParams({
      groupId: request.groupId,
      groupName: request.groupName,
      songId: request.songId,
      songTitle: request.songTitle,
      kind: request.kind,
      filename: request.file.name,
    });
    const xhr = new XMLHttpRequest();
    let settled = false;
    const cleanup = () => {
      request.signal?.removeEventListener('abort', handleAbort);
    };
    const finish = (task: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      task();
    };
    const handleAbort = () => {
      xhr.abort();
    };
    xhr.open('POST', `${MEDIA_BASE_PATH}/copy?${params.toString()}`, true);
    xhr.setRequestHeader('Content-Type', request.file.type || 'application/octet-stream');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      request.onProgress?.(Math.max(0, Math.min(1, event.loaded / event.total)));
    };
    xhr.onload = () => {
      finish(() => {
        let data: unknown = null;
        try {
          data = xhr.responseText ? (JSON.parse(xhr.responseText) as unknown) : null;
        } catch {
          data = null;
        }
        if (xhr.status >= 200 && xhr.status < 300 && isRecord(data)) {
          resolve(data as unknown as MediaCopyResponse);
          return;
        }
        const message = isUnavailableStatus(xhr.status)
          ? 'The media library is unavailable. This file stays linked for this session.'
          : isRecord(data) && typeof data.error === 'string'
            ? data.error
            : `The media copy failed (${xhr.status || 'network error'}).`;
        reject(new MediaApiError(xhr.status, message));
      });
    };
    xhr.onerror = () => {
      finish(() =>
        reject(
          new MediaApiError(
            0,
            'The media library could not receive that file. It stays linked for this session.',
          ),
        ),
      );
    };
    xhr.onabort = () => {
      finish(() => reject(new MediaApiError(0, 'The media copy was cancelled.')));
    };
    if (request.signal) {
      if (request.signal.aborted) {
        finish(() => reject(new MediaApiError(0, 'The media copy was cancelled.')));
        return;
      }
      request.signal.addEventListener('abort', handleAbort, { once: true });
    }
    xhr.send(request.file);
  });
}

export function mediaErrorMessage(
  error: unknown,
  fallback = 'The media library is unavailable. The file stays linked for this session.',
): string {
  if (error instanceof MediaApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
