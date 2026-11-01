import { RotateCcw, X } from 'lucide-react';
import type { WorkspaceBackupSummary } from '../lib/workspaceBackupTypes';

interface WorkspaceRecoveryBannerProps {
  backup: WorkspaceBackupSummary;
  onRestore: () => void;
  onDismiss: () => void;
}

function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function formatBackupDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function WorkspaceRecoveryBanner({
  backup,
  onRestore,
  onDismiss,
}: WorkspaceRecoveryBannerProps) {
  return (
    <div className="recovery-banner" role="status">
      <RotateCcw size={18} aria-hidden="true" />
      <div>
        <strong>A local workspace backup is available.</strong>
        <p>
          {plural(backup.stats.groups, 'group')} and {plural(backup.stats.songs, 'song')} were saved
          on {formatBackupDate(backup.createdAt)}. Restore it if this workspace is empty or
          something went missing.
        </p>
      </div>
      <div className="recovery-banner-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={onDismiss}>
          <X size={13} aria-hidden="true" />
          Dismiss
        </button>
        <button type="button" className="btn btn-primary btn-small" onClick={onRestore}>
          <RotateCcw size={13} aria-hidden="true" />
          Restore backup
        </button>
      </div>
    </div>
  );
}
