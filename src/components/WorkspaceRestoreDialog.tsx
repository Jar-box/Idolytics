import { useState } from 'react';
import type { WorkspaceBackupSummary } from '../lib/workspaceBackupTypes';
import { useBackupStore } from '../store/backupStore';
import { useNavStore } from '../store/navStore';
import { useToastStore } from '../store/toastStore';
import { ConfirmDialog } from './ConfirmDialog';

interface WorkspaceRestoreDialogProps {
  backup: WorkspaceBackupSummary | null;
  onClose: () => void;
}

function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function formatBackupDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function WorkspaceRestoreDialog({ backup, onClose }: WorkspaceRestoreDialogProps) {
  const restore = useBackupStore((state) => state.restore);
  const goWorkspace = useNavStore((state) => state.goWorkspace);
  const pushToast = useToastStore((state) => state.push);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (!backup || busy) return;
    setBusy(true);
    try {
      await restore(backup.file);
      pushToast('Workspace restored from backup.', 'success');
      goWorkspace();
      onClose();
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : 'Could not restore that backup.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={backup !== null}
      title="Restore this backup?"
      message={
        backup
          ? `The snapshot from ${formatBackupDate(backup.createdAt)} has ${plural(
              backup.stats.groups,
              'group',
            )} and ${plural(
              backup.stats.songs,
              'song',
            )}. Restoring replaces the current workspace. If the current workspace has data, a safety backup is created first.`
          : ''
      }
      confirmLabel="Restore backup"
      busyLabel="Restoring…"
      tone="danger"
      busy={busy}
      onCancel={onClose}
      onConfirm={() => void handleConfirm()}
    />
  );
}
