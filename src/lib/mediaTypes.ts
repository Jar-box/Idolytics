export const MEDIA_BASE_PATH = '/__media';
export const MEDIA_MANIFEST_VERSION = 1;
export const DEFAULT_MEDIA_DIR = 'media';

export type MediaKind = 'audio' | 'video';
export type MediaSource = 'local' | 'library';
export type MediaCopyStatus =
  | 'idle'
  | 'copying'
  | 'done'
  | 'error'
  | 'off'
  | 'unavailable';

export interface MediaCopyRecord {
  originalName: string;
  fileName: string;
  size: number;
  updatedAt: string;
}

export interface MediaSongEntry {
  title: string;
  folder: string;
  copies: Partial<Record<MediaKind, MediaCopyRecord>>;
}

export interface MediaGroupEntry {
  name: string;
  folder: string;
  songs: Record<string, MediaSongEntry>;
}

export interface MediaManifest {
  version: typeof MEDIA_MANIFEST_VERSION;
  revision: number;
  updatedAt: string;
  groups: Record<string, MediaGroupEntry>;
}

export interface MediaWorkspaceSong {
  id: string;
  title: string;
}

export interface MediaWorkspaceGroup {
  id: string;
  name: string;
  songs: MediaWorkspaceSong[];
}

export interface MediaWorkspaceSnapshot {
  groups: MediaWorkspaceGroup[];
}

export interface MediaCounts {
  groups: number;
  songs: number;
  audio: number;
  video: number;
}

export interface MediaStatusPayload {
  available: true;
  libraryPath: string;
  absolutePath: string;
  manifest: MediaManifest;
  counts: MediaCounts;
  syncedAt: string;
  warnings: string[];
}

export type MediaImportQuality = '720' | '1080' | 'best';

export const MEDIA_IMPORT_QUALITIES: readonly MediaImportQuality[] = [
  '720',
  '1080',
  'best',
];

export type MediaImportState =
  | 'queued'
  | 'resolving'
  | 'downloading'
  | 'processing'
  | 'saving'
  | 'done'
  | 'error'
  | 'cancelled';

export function isTerminalMediaImportState(state: MediaImportState): boolean {
  return state === 'done' || state === 'error' || state === 'cancelled';
}

export interface MediaImportRequest {
  url: string;
  groupId: string;
  groupName: string;
  songId: string;
  songTitle: string;
  kind: MediaKind;
  quality: MediaImportQuality;
}

export interface MediaImportJob {
  id: string;
  state: MediaImportState;
  progress: number;
  title: string | null;
  durationSec: number | null;
  copy: MediaCopyResponse | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MediaImportStartResponse {
  jobId: string;
}

export interface MediaProbeResponse {
  title: string | null;
  durationSec: number;
}

export interface MediaImportCancelResponse {
  cancelled: boolean;
  job: MediaImportJob;
}

export interface MediaToolStatus {
  available: boolean;
  version: string | null;
}

export interface MediaImportTools {
  ytDlp: MediaToolStatus;
  ffmpeg: MediaToolStatus;
  cookies: 'browser' | 'file' | null;
}

export interface MediaStatusResponse extends MediaStatusPayload {
  tools: MediaImportTools;
}

export type MediaSyncResponse = MediaStatusResponse;

export interface MediaCopyResponse {
  copy: MediaCopyRecord;
  groupId: string;
  songId: string;
  kind: MediaKind;
  groupFolder: string;
  songFolder: string;
  relativePath: string;
  url: string;
  reused: boolean;
  manifestRevision: number;
}

export interface MediaErrorPayload {
  error: string;
}

export interface MediaCopyState {
  status: MediaCopyStatus;
  progress: number;
  message: string | null;
  destination: string | null;
}

export function emptyMediaCopyState(): MediaCopyState {
  return { status: 'idle', progress: 0, message: null, destination: null };
}
