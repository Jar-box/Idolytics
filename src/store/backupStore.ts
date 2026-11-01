import { create } from 'zustand';
import type { Workspace } from '../domain/schema';
import {
  WorkspaceBackupError,
  createWorkspaceBackup,
  fetchWorkspaceBackup,
  fetchWorkspaceBackupStatus,
  workspaceBackupErrorMessage,
  workspaceBackupSupported,
} from '../lib/workspaceBackup';
import {
  WORKSPACE_BACKUP_DIRECTORY,
  WORKSPACE_BACKUP_LIMIT,
  type WorkspaceBackupCreateResponse,
  type WorkspaceBackupSource,
  type WorkspaceBackupSummary,
} from '../lib/workspaceBackupTypes';
import { parseWorkspaceValue } from './persistence';
import { useWorkspaceStore } from './workspaceStore';

export type BackupServiceStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

interface BackupState {
  status: BackupServiceStatus;
  backups: WorkspaceBackupSummary[];
  directory: string;
  limit: number;
  error: string | null;
  checkedAt: string | null;
  creating: boolean;
  restoringFile: string | null;
  refresh: () => Promise<void>;
  create: (
    workspace: Workspace,
    source: WorkspaceBackupSource,
  ) => Promise<WorkspaceBackupCreateResponse | null>;
  restore: (file: string) => Promise<void>;
}

function sortBackups(backups: WorkspaceBackupSummary[]): WorkspaceBackupSummary[] {
  return [...backups].sort((left, right) => {
    const byDate = right.createdAt.localeCompare(left.createdAt);
    return byDate !== 0 ? byDate : right.file.localeCompare(left.file);
  });
}

function mergeBackup(
  backups: WorkspaceBackupSummary[],
  incoming: WorkspaceBackupSummary,
): WorkspaceBackupSummary[] {
  return sortBackups([
    incoming,
    ...backups.filter((backup) => backup.file !== incoming.file),
  ]).slice(0, WORKSPACE_BACKUP_LIMIT);
}

export const useBackupStore = create<BackupState>((set, get) => ({
  status: 'idle',
  backups: [],
  directory: WORKSPACE_BACKUP_DIRECTORY,
  limit: WORKSPACE_BACKUP_LIMIT,
  error: null,
  checkedAt: null,
  creating: false,
  restoringFile: null,

  refresh: async () => {
    if (!workspaceBackupSupported()) {
      set({
        status: 'unavailable',
        error: 'Workspace backups run only with the local dev server.',
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    set({ status: 'loading', error: null });
    try {
      const payload = await fetchWorkspaceBackupStatus();
      set({
        status: 'ready',
        backups: payload.backups,
        directory: payload.directory,
        limit: payload.limit,
        error: null,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      set({
        status: 'unavailable',
        error: workspaceBackupErrorMessage(error),
        checkedAt: new Date().toISOString(),
      });
    }
  },

  create: async (workspace, source) => {
    if (!workspaceBackupSupported()) return null;
    set({ creating: true });
    try {
      const response = await createWorkspaceBackup(workspace, source);
      const backup = response.backup;
      if (backup) {
        try {
          const payload = await fetchWorkspaceBackupStatus();
          set({
            status: 'ready',
            backups: payload.backups,
            directory: payload.directory,
            limit: payload.limit,
            error: null,
            checkedAt: new Date().toISOString(),
          });
        } catch {
          set((state) => ({ backups: mergeBackup(state.backups, backup) }));
        }
      }
      return response;
    } finally {
      set({ creating: false });
    }
  },

  restore: async (file) => {
    set({ restoringFile: file });
    try {
      const record = await fetchWorkspaceBackup(file);
      const parsed = parseWorkspaceValue(record.workspace);
      if (!parsed.ok || !parsed.workspace) {
        throw new WorkspaceBackupError(
          0,
          `That backup is not a valid workspace. ${parsed.errors[0] ?? 'It could not be read.'}`,
        );
      }

      const current = useWorkspaceStore.getState().workspace;
      if (current.groups.length > 0) {
        await get().create(current, 'pre-restore');
      }

      useWorkspaceStore.getState().replaceWorkspace(parsed.workspace);
      await get().refresh();
    } finally {
      set({ restoringFile: null });
    }
  },
}));
