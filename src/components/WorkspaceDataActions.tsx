import { useRef, useState } from 'react';
import { AlertTriangle, Download, RotateCcw, Upload } from 'lucide-react';
import type { Workspace } from '../domain/schema';
import { parseWorkspaceJson, saveWorkspaceToDisk } from '../store/persistence';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useNavStore } from '../store/navStore';
import { useToastStore } from '../store/toastStore';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';

interface WorkspaceDataActionsProps {
  showReset?: boolean;
}

export function WorkspaceDataActions({ showReset = false }: WorkspaceDataActionsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workspace = useWorkspaceStore((state) => state.workspace);
  const replaceWorkspace = useWorkspaceStore((state) => state.replaceWorkspace);
  const resetWorkspace = useWorkspaceStore((state) => state.resetWorkspace);
  const goWorkspace = useNavStore((state) => state.goWorkspace);
  const pushToast = useToastStore((state) => state.push);

  const [pendingWorkspace, setPendingWorkspace] = useState<Workspace | null>(null);
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const importSongCount = pendingWorkspace
    ? pendingWorkspace.groups.reduce((total, group) => total + group.songs.length, 0)
    : 0;

  const handleExport = async () => {
    try {
      const result = await saveWorkspaceToDisk(workspace);
      if (result === 'saved') pushToast('Workspace saved to disk.', 'success');
      if (result === 'downloaded') pushToast('Workspace export downloaded.', 'success');
    } catch {
      pushToast('Could not save the workspace file.', 'error');
    }
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) {
      setImportErrors(['That file is larger than 40 MB.']);
      return;
    }
    try {
      const text = await file.text();
      const result = parseWorkspaceJson(text);
      if (!result.ok || !result.workspace) {
        setImportErrors(result.errors.length > 0 ? result.errors : ['Could not read that file.']);
        return;
      }
      setPendingWorkspace(result.workspace);
    } catch {
      setImportErrors(['Could not read that file.']);
    }
  };

  return (
    <>
      <div className="data-actions">
        <button type="button" className="btn btn-ghost" onClick={() => void handleExport()}>
          <Download size={16} />
          Export JSON
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={16} />
          Import JSON
        </button>
        {showReset ? (
          <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setResetOpen(true)}>
            <RotateCcw size={16} />
            Reset workspace
          </button>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            event.target.value = '';
            void handleFile(file);
          }}
        />
      </div>

      <ConfirmDialog
        open={pendingWorkspace !== null}
        title="Replace this workspace?"
        message={
          pendingWorkspace
            ? `This import contains ${pendingWorkspace.groups.length} ${
                pendingWorkspace.groups.length === 1 ? 'group' : 'groups'
              } and ${importSongCount} ${importSongCount === 1 ? 'song' : 'songs'}. It will replace everything currently in this workspace.`
            : ''
        }
        confirmLabel="Replace workspace"
        tone="danger"
        onCancel={() => setPendingWorkspace(null)}
        onConfirm={() => {
          if (!pendingWorkspace) return;
          replaceWorkspace(pendingWorkspace);
          setPendingWorkspace(null);
          goWorkspace();
          pushToast('Workspace imported.', 'success');
        }}
      />

      <ConfirmDialog
        open={resetOpen}
        title="Reset the workspace?"
        message="Every group, member, song, section, formation, and logged line in this browser will be removed. Export a backup first if you need one."
        confirmLabel="Reset everything"
        tone="danger"
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          resetWorkspace();
          setResetOpen(false);
          goWorkspace();
          pushToast('Workspace reset.', 'success');
        }}
      />

      <Modal
        open={importErrors !== null}
        onClose={() => setImportErrors(null)}
        title="Import failed"
        eyebrow="Workspace file"
        size="sm"
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setImportErrors(null)}>
            Close
          </button>
        }
      >
        <div className="import-error-heading">
          <AlertTriangle size={20} aria-hidden="true" />
          <p>The file could not be validated. Nothing was changed.</p>
        </div>
        <ul className="error-list mono">
          {importErrors?.map((error) => <li key={error}>{error}</li>)}
        </ul>
      </Modal>
    </>
  );
}
