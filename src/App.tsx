import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AppHeader } from './components/AppHeader';
import { ToastViewport } from './components/ToastViewport';
import { SettingsModal } from './features/settings/SettingsModal';
import { WorkspacePage } from './features/workspace/WorkspacePage';
import { GroupPage } from './features/group/GroupPage';
import { SongPage } from './features/song/SongPage';
import { useNavStore } from './store/navStore';
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

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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
      <ToastViewport />
    </div>
  );
}
