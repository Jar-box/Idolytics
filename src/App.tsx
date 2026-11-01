import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AppHeader } from './components/AppHeader';
import { DevOriginBanner } from './components/DevOriginBanner';
import { ToastViewport } from './components/ToastViewport';
import { WorkspaceRecoveryBanner } from './components/WorkspaceRecoveryBanner';
import { WorkspaceRestoreDialog } from './components/WorkspaceRestoreDialog';
import { SettingsModal } from './features/settings/SettingsModal';
import { WorkspacePage } from './features/workspace/WorkspacePage';
import { GroupPage } from './features/group/GroupPage';
import { SongPage } from './features/song/SongPage';
import { workspaceBackupSupported } from './lib/workspaceBackup';
import type { WorkspaceBackupSummary } from './lib/workspaceBackupTypes';
import { workspaceToMediaSnapshot } from './lib/mediaSync';
import { useBackupStore } from './store/backupStore';
import { useMediaStore } from './store/mediaStore';
import { useNavStore } from './store/navStore';
import { useToastStore } from './store/toastStore';
import { useWorkspaceStore } from './store/workspaceStore';
import { saveWorkspaceToIdb } from './store/persistence';

export default function App() {
  const hydrate = useWorkspaceStore((state) => state.hydrate);
  const hydrated = useWorkspaceStore((state) => state.hydrated);
  const hydrationError = useWorkspaceStore((state) => state.hydrationError);
  const workspace = useWorkspaceStore((state) => state.workspace);
  const setSaveStatus = useWorkspaceStore((state) => state.setSaveStatus);
  const undo = useWorkspaceStore((state) => state.undo);
  const redo = useWorkspaceStore((state) => state.redo);
  const resetWorkspace = useWorkspaceStore((state) => state.resetWorkspace);
  const view = useNavStore((state) => state.view);
  const backups = useBackupStore((state) => state.backups);
  const refreshBackups = useBackupStore((state) => state.refresh);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [recoveryDismissed, setRecoveryDismissed] = useState(false);
  const [recoveryRestore, setRecoveryRestore] = useState<WorkspaceBackupSummary | null>(null);
  const latestWorkspaceRef = useRef(workspace);
  latestWorkspaceRef.current = workspace;
  const lastBackupAttemptRef = useRef(0);
  const backupFailureNotifiedRef = useRef(false);
  const mediaSignature = useMemo(
    () => JSON.stringify(workspaceToMediaSnapshot(workspace)),
    [workspace],
  );
  const initialMediaSyncDone = useRef(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    void refreshBackups();
  }, [hydrated, refreshBackups]);

  useEffect(() => {
    if (!import.meta.env.DEV || !hydrated || hydrationError) return;
    const delay = initialMediaSyncDone.current ? 650 : 0;
    const timer = window.setTimeout(() => {
      initialMediaSyncDone.current = true;
      void useMediaStore.getState().sync(latestWorkspaceRef.current);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [hydrated, hydrationError, mediaSignature]);

  useEffect(() => {
    if (!hydrated || hydrationError) return;
    setSaveStatus('saving');
    const timer = window.setTimeout(() => {
      void saveWorkspaceToIdb(workspace)
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('error'));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [workspace, hydrated, hydrationError, setSaveStatus]);

  useEffect(() => {
    if (!workspaceBackupSupported() || !hydrated || hydrationError) return;
    if (workspace.groups.length === 0) return;

    let throttleTimer = 0;
    const timer = window.setTimeout(() => {
      const runBackup = () => {
        lastBackupAttemptRef.current = Date.now();
        void useBackupStore
          .getState()
          .create(latestWorkspaceRef.current, 'autosave')
          .then(() => {
            backupFailureNotifiedRef.current = false;
          })
          .catch(() => {
            if (backupFailureNotifiedRef.current) return;
            backupFailureNotifiedRef.current = true;
            useToastStore
              .getState()
              .push('Automatic workspace backup failed. Check Settings → Data.', 'error');
          });
      };

      const waitMs = lastBackupAttemptRef.current + 60_000 - Date.now();
      if (waitMs > 0) {
        throttleTimer = window.setTimeout(runBackup, waitMs);
      } else {
        runBackup();
      }
    }, 5_000);

    return () => {
      window.clearTimeout(timer);
      if (throttleTimer !== 0) window.clearTimeout(throttleTimer);
    };
  }, [workspace, hydrated, hydrationError]);

  useEffect(() => {
    if (workspace.groups.length > 0) setRecoveryDismissed(false);
  }, [workspace.groups.length]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isEditing || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const latestBackup = backups[0] ?? null;
  const showRecovery =
    workspaceBackupSupported() &&
    hydrated &&
    (workspace.groups.length === 0 || hydrationError !== null) &&
    latestBackup !== null &&
    !recoveryDismissed;

  if (!hydrated) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">
          <span />
        </div>
        <p className="boot-wordmark">IDOLYTICS</p>
        <p className="boot-caption">Loading the stage…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="app-atmosphere" aria-hidden="true" />
      <AppHeader onOpenSettings={() => setSettingsOpen(true)} />
      <DevOriginBanner />
      {hydrationError && !errorDismissed ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Saved data needs attention.</strong>
            <p>{hydrationError}</p>
          </div>
          <div className="error-banner-actions">
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => setErrorDismissed(true)}
            >
              Dismiss
            </button>
            <button
              type="button"
              className="btn btn-danger btn-small"
              onClick={() => {
                resetWorkspace();
                setErrorDismissed(true);
              }}
            >
              Start fresh
            </button>
          </div>
        </div>
      ) : null}
      {showRecovery && latestBackup ? (
        <WorkspaceRecoveryBanner
          backup={latestBackup}
          onDismiss={() => setRecoveryDismissed(true)}
          onRestore={() => setRecoveryRestore(latestBackup)}
        />
      ) : null}
      <main className="app-main">
        {view.kind === 'workspace' ? (
          <WorkspacePage onOpenSettings={() => setSettingsOpen(true)} />
        ) : null}
        {view.kind === 'group' ? <GroupPage groupId={view.groupId} /> : null}
        {view.kind === 'song' ? (
          <SongPage groupId={view.groupId} songId={view.songId} />
        ) : null}
      </main>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <WorkspaceRestoreDialog
        backup={recoveryRestore}
        onClose={() => setRecoveryRestore(null)}
      />
      <ToastViewport />
    </div>
  );
}
