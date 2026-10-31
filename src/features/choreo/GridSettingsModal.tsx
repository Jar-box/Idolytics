import { useEffect, useState, type FormEvent } from 'react';
import type { Song } from '../../domain/schema';
import { Modal } from '../../components/Modal';
import { useToastStore } from '../../store/toastStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

interface GridSettingsModalProps {
  open: boolean;
  groupId: string;
  song: Song;
  onClose: () => void;
}

export function GridSettingsModal({ open, groupId, song, onClose }: GridSettingsModalProps) {
  const setGrid = useWorkspaceStore((state) => state.setGrid);
  const pushToast = useToastStore((state) => state.push);

  const [cols, setCols] = useState(song.grid.cols);
  const [rows, setRows] = useState(song.grid.rows);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCols(song.grid.cols);
    setRows(song.grid.rows);
    setError(null);
  }, [open, song.grid.cols, song.grid.rows]);

  const outOfBounds = (() => {
    let count = 0;
    for (const section of song.sections) {
      for (const formation of section.formations) {
        for (const placement of formation.placements) {
          if (placement.col >= cols || placement.row >= rows) count += 1;
        }
      }
    }
    return count;
  })();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (cols < 3 || cols > 21 || rows < 1 || rows > 9) {
      setError('Columns must be 3–21 and rows must be 1–9.');
      return;
    }
    if (outOfBounds > 0) {
      setError(
        `${outOfBounds} placement${outOfBounds === 1 ? ' is' : 's are'} outside that grid. Move or remove them before shrinking.`,
      );
      return;
    }
    setGrid(groupId, song.id, cols, rows);
    pushToast('Stage grid updated.', 'success');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Stage grid"
      eyebrow="Per song"
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="grid-form" className="btn btn-primary">
            Apply grid
          </button>
        </>
      }
    >
      <form id="grid-form" onSubmit={handleSubmit} className="stack-form">
        <div className="form-grid-2">
          <label className="field">
            <span className="field-label">Columns</span>
            <input
              type="number"
              className="input mono"
              min={3}
              max={21}
              value={cols}
              onChange={(event) => setCols(Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span className="field-label">Rows</span>
            <input
              type="number"
              className="input mono"
              min={1}
              max={9}
              value={rows}
              onChange={(event) => setRows(Number(event.target.value))}
            />
          </label>
        </div>
        <p className="form-note">
          The grid is a top-down stage plot. Row 1 is the front edge nearest the audience. Every
          formation in this song shares the same grid.
        </p>
        {outOfBounds > 0 ? (
          <p className="form-warning">
            {outOfBounds} existing placement{outOfBounds === 1 ? '' : 's'} would fall outside this
            size.
          </p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Modal>
  );
}
