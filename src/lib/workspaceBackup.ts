import type { Workspace } from '../domain/schema';
import {
  WORKSPACE_BACKUP_BASE_PATH,
  type WorkspaceBackupCreateResponse,
  type WorkspaceBackupRecord,
  type WorkspaceBackupSource,
  type WorkspaceBackupStatus,
} from './workspaceBackupTypes';

export class WorkspaceBackupError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'WorkspaceBackupError';
    this.status = status;
  }
}

export function workspaceBackupSupported(): boolean {
  return import.meta.env.DEV;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnavailableStatus(status: number): boolean {
  return status === 0 || status === 502 || status === 503 || status === 504;
}

async function requestJson<T>(
  url: string,
  init: { method?: string; body?: string; headers?: Record<string, string> },
  timeoutMs = 12000,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
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
        ? 'Workspace backups are unavailable. Start the app with npm run dev.'
        : isRecord(data) && typeof data.error === 'string'
          ? data.error
          : `The workspace backup request failed (${response.status}).`;
      throw new WorkspaceBackupError(response.status, message);
    }
    if (data === null) {
      throw new WorkspaceBackupError(
        response.status,
        'The workspace backup service returned an empty response.',
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof WorkspaceBackupError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new WorkspaceBackupError(0, 'The workspace backup service did not respond in time.');
    }
    throw new WorkspaceBackupError(
      0,
      'Workspace backups are unavailable. Start the app with npm run dev.',
    );
  } finally {
    window.clearTimeout(timer);
  }
}

export function fetchWorkspaceBackupStatus(): Promise<WorkspaceBackupStatus> {
  return requestJson<WorkspaceBackupStatus>(`${WORKSPACE_BACKUP_BASE_PATH}/status`, {
    method: 'GET',
  });
}

export function createWorkspaceBackup(
  workspace: Workspace,
  source: WorkspaceBackupSource,
): Promise<WorkspaceBackupCreateResponse> {
  return requestJson<WorkspaceBackupCreateResponse>(
    `${WORKSPACE_BACKUP_BASE_PATH}/backup`,
    {
      method: 'POST',
      body: JSON.stringify({ workspace, source }),
      headers: { 'Content-Type': 'application/json' },
    },
    30000,
  );
}

export function fetchWorkspaceBackup(file: string): Promise<WorkspaceBackupRecord> {
  return requestJson<WorkspaceBackupRecord>(
    `${WORKSPACE_BACKUP_BASE_PATH}/backups/${encodeURIComponent(file)}`,
    { method: 'GET' },
    30000,
  );
}

export function workspaceBackupErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'The workspace backup request failed.';
}
