import { ChevronRight, Download, Redo2, Settings, Undo2 } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useNavStore } from '../store/navStore';
import { useToastStore } from '../store/toastStore';
import { saveWorkspaceToDisk } from '../store/persistence';

interface AppHeaderProps {
  onOpenSettings: () => void;
}

const saveLabels = {
  idle: 'Ready',
  saving: 'Saving',
  saved: 'Saved',
  error: 'Save error',
} as const;

export function AppHeader({ onOpenSettings }: AppHeaderProps) {
  const view = useNavStore((state) => state.view);
  const goWorkspace = useNavStore((state) => state.goWorkspace);
  const goGroup = useNavStore((state) => state.goGroup);
  const workspace = useWorkspaceStore((state) => state.workspace);
  const saveStatus = useWorkspaceStore((state) => state.saveStatus);
  const pastLength = useWorkspaceStore((state) => state.past.length);
  const futureLength = useWorkspaceStore((state) => state.future.length);
  const undo = useWorkspaceStore((state) => state.undo);
  const redo = useWorkspaceStore((state) => state.redo);
  const pushToast = useToastStore((state) => state.push);

  const activeGroup =
    view.kind === 'group' || view.kind === 'song'
      ? workspace.groups.find((group) => group.id === view.groupId)
      : null;
  const activeSong =
    view.kind === 'song'
      ? activeGroup?.songs.find((song) => song.id === view.songId)
      : null;

  const handleExport = async () => {
    try {
      const result = await saveWorkspaceToDisk(workspace);
      if (result === 'saved') pushToast('Workspace saved to disk.', 'success');
      if (result === 'downloaded') pushToast('Workspace export downloaded.', 'success');
    } catch {
      pushToast('Could not export the workspace.', 'error');
    }
  };

  return (
    <header className="app-header">
      <div className="header-inner">
        <button type="button" className="wordmark" onClick={goWorkspace} aria-label="Idolytics home">
          <span className="wordmark-mark" aria-hidden="true">
            <span />
          </span>
          <span className="wordmark-text">IDOLYTICS</span>
          <span className="wordmark-version">01</span>
        </button>

        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <button
            type="button"
            className={view.kind === 'workspace' ? 'crumb is-current' : 'crumb'}
            onClick={goWorkspace}
          >
            Workspace
          </button>
          {activeGroup ? (
            <>
              <ChevronRight size={13} className="crumb-separator" aria-hidden="true" />
              <button
                type="button"
                className={view.kind === 'group' ? 'crumb is-current' : 'crumb'}
                onClick={() => goGroup(activeGroup.id)}
              >
                {activeGroup.name.trim() || 'Untitled group'}
              </button>
            </>
          ) : null}
          {activeSong ? (
            <>
              <ChevronRight size={13} className="crumb-separator" aria-hidden="true" />
              <span className="crumb is-current" aria-current="page">
                {activeSong.title.trim() || 'Untitled song'}
              </span>
            </>
          ) : null}
        </nav>

        <div className="header-actions">
          <span className={`save-badge save-${saveStatus}`}>
            <span className="save-dot" aria-hidden="true" />
            {saveLabels[saveStatus]}
          </span>
          <div className="header-divider" aria-hidden="true" />
          <button
            type="button"
            className="icon-button"
            onClick={undo}
            disabled={pastLength === 0}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            <Undo2 size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={redo}
            disabled={futureLength === 0}
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
          >
            <Redo2 size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => void handleExport()}
            title="Export workspace"
            aria-label="Export workspace"
          >
            <Download size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Open settings"
          >
            <Settings size={17} />
          </button>
        </div>
      </div>
    </header>
  );
}
