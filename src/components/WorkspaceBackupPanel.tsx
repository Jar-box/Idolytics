import { useState } from 'react';
import { Database, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react';
import type {
  WorkspaceBackupSource,
  WorkspaceBackupSummary,
} from '../lib/workspaceBackupTypes';
import { useBackupStore } from '../store/backupStore';
import { useToastStore } from '../store/toastStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { WorkspaceRestoreDialog } from './WorkspaceRestoreDialog';

const sourceLabels: Record<WorkspaceBackupSource, string> = {
  autosave: 'Autosave',
  manual: 'Manual',
  'pre-reset': 'Before reset',
  'pre-import': 'Before import',
  'pre-restore': 'Before restore',
};

function formatBackupDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function latestLabel(backup: WorkspaceBackupSummary | undefined): string {
  return backup ? formatBackupDate(backup.createdAt) : 'None yet';
}

export function WorkspaceBackupPanel() {
  const workspace = useWorkspaceStore((state) => state.workspace);
  const serviceStatus = useBackupStore((state) => state.status);
  const backups = useBackupStore((state) => state.backups);
  const directory = useBackupStore((state) => state.directory);
  const limit = useBackupStore((state) => state.limit);
  const error = useBackupStore((state) => state.error);
  const creating = useBackupStore((state) => state.creating);
  const refreshing = useBackupStore((state) => state.status === 'loading');
  const refresh = useBackupStore((state) => state.refresh);
  const create = useBackupStore((state) => state.create);
  const pushToast = useToastStore((state) => state.push);

  const [restoreTarget, setRestoreTarget] = useState<WorkspaceBackupSummary | null>(null);

  const statusLabel =
    serviceStatus === 'ready'
      ? 'On'
      : serviceStatus === 'loading'
        ? 'Checking'
        : serviceStatus === 'unavailable'
          ? 'Unavailable'
          : 'Not checked';

  const handleManualBackup = async () => {
    if (workspace.groups.length === 0) {
      pushToast('Create a group before backing up the workspace.', 'info');
      return;
    }
    try {
      const result = await create(workspace, 'manual');
      if (!result) {
        pushToast('Workspace backups need the local dev server.', 'error');
        return;
      }
      if (result.skipped) {
        pushToast('There is nothing to back up yet.', 'info');
      } else if (result.deduplicated) {
        pushToast('That workspace is already backed up.', 'info');
      } else {
        pushToast('Workspace backup created.', 'success');
      }
    } catch (backupError) {
      pushToast(
        backupError instanceof Error
          ? backupError.message
          : 'Could not create a workspace backup.',
        'error',
      );
    }
  };

  return (
    <div className="backup-panel">
      <div className="settings-heading backup-settings-heading">
        <p className="eyebrow">Local safety net</p>
        <h3>Workspace backups</h3>
      </div>
      <p className="settings-copy">
        The dev server keeps JSON snapshots outside the browser in{' '}
        <code>{directory}/</code>. Non-empty workspaces are backed up after a short idle, before
        resets, imports, and restores, and whenever you choose. The newest {limit} are kept.
      </p>

      <div className="settings-fact-grid backup-fact-grid">
        <div>
          <span>Status</span>
          <strong className={serviceStatus === 'ready' ? 'is-ready' : ''}>{statusLabel}</strong>
        </div>
        <div>
          <span>Folder</span>
          <strong className="mono media-path" title={directory}>
            {directory}/
          </strong>
        </div>
        <div>
          <span>Snapshots</span>
          <strong className="mono">
            {backups.length} / {limit}
          </strong>
        </div>
        <div>
          <span>Latest</span>
          <strong className="mono">{latestLabel(backups[0])}</strong>
        </div>
      </div>

      <div className="backup-actions">
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={creating || refreshing || workspace.groups.length === 0}
          onClick={() => void handleManualBackup()}
        >
          <Database size={13} />
          {creating ? 'Backing up…' : 'Back up now'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw size={13} className={refreshing ? 'is-spinning' : undefined} />
          {refreshing ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="settings-note is-warning">
          <TriangleAlert size={15} />
          <p>{error}</p>
        </div>
      ) : null}

      {backups.length === 0 ? (
        <div className="settings-note">
          <Database size={15} />
          <p>
            {serviceStatus === 'unavailable'
              ? 'Backups are unavailable right now. Check that the app is running through npm run dev.'
              : 'Backups appear here after the first non-empty workspace is saved in development.'}
          </p>
        </div>
      ) : (
        <ul className="backup-list">
          {backups.map((backup) => (
            <li key={backup.file} className="backup-row" title={backup.file}>
              <div className="backup-row-copy">
                <strong>{formatBackupDate(backup.createdAt)}</strong>
                <span className="mono">
                  {sourceLabels[backup.source]} · {plural(backup.stats.groups, 'group')} ·{' '}
                  {plural(backup.stats.songs, 'song')}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => setRestoreTarget(backup)}
              >
                <RotateCcw size={13} />
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}

      <WorkspaceRestoreDialog
        backup={restoreTarget}
        onClose={() => setRestoreTarget(null)}
      />
    </div>
  );
}
