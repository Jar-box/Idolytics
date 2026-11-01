import type { Workspace } from '../domain/schema.ts';
import type { WorkspaceStats } from '../domain/stats.ts';

export const WORKSPACE_BACKUP_BASE_PATH = '/__workspace';
export const WORKSPACE_BACKUP_DIRECTORY = 'backups/workspace';
export const WORKSPACE_BACKUP_LIMIT = 20;
export const WORKSPACE_BACKUP_RECORD_FORMAT = 'idolytics-workspace-backup';
export const WORKSPACE_BACKUP_RECORD_VERSION = 1;
export const WORKSPACE_BACKUP_INDEX_FORMAT = 'idolytics-workspace-backup-index';
export const WORKSPACE_BACKUP_INDEX_VERSION = 1;

export const WORKSPACE_BACKUP_SOURCES = [
  'autosave',
  'manual',
  'pre-reset',
  'pre-import',
  'pre-restore',
] as const;

export type WorkspaceBackupSource = (typeof WORKSPACE_BACKUP_SOURCES)[number];

export function isWorkspaceBackupSource(value: unknown): value is WorkspaceBackupSource {
  return (
    typeof value === 'string' &&
    (WORKSPACE_BACKUP_SOURCES as readonly string[]).includes(value)
  );
}

export interface WorkspaceBackupSummary {
  file: string;
  createdAt: string;
  source: WorkspaceBackupSource;
  origin: string;
  stats: WorkspaceStats;
  size: number;
  signature: string;
}

export interface WorkspaceBackupRecord {
  format: typeof WORKSPACE_BACKUP_RECORD_FORMAT;
  version: typeof WORKSPACE_BACKUP_RECORD_VERSION;
  createdAt: string;
  source: WorkspaceBackupSource;
  origin: string;
  stats: WorkspaceStats;
  signature: string;
  workspace: Workspace;
}

export interface WorkspaceBackupIndex {
  format: typeof WORKSPACE_BACKUP_INDEX_FORMAT;
  version: typeof WORKSPACE_BACKUP_INDEX_VERSION;
  backups: WorkspaceBackupSummary[];
}

export interface WorkspaceBackupStatus {
  available: true;
  directory: string;
  limit: number;
  backups: WorkspaceBackupSummary[];
}

export interface WorkspaceBackupCreateRequest {
  source: WorkspaceBackupSource;
  workspace: Workspace;
}

export interface WorkspaceBackupCreateResponse {
  created: boolean;
  deduplicated: boolean;
  skipped: boolean;
  backup: WorkspaceBackupSummary | null;
}
