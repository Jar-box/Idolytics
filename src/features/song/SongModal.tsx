import { useEffect, useState, type FormEvent } from 'react';
import type { Song } from '../../domain/schema';
import { ClockInput } from '../../components/ClockInput';
import { Modal } from '../../components/Modal';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useToastStore } from '../../store/toastStore';

interface SongModalProps {
  open: boolean;
  groupId: string;
  song: Song | null;
  onClose: () => void;
  onCreated?: (songId: string) => void;
}

export function SongModal({ open, groupId, song, onClose, onCreated }: SongModalProps) {
  const createSong = useWorkspaceStore((state) => state.createSong);
  const updateSong = useWorkspaceStore((state) => state.updateSong);
  const pushToast = useToastStore((state) => state.push);

  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(180);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(song?.title ?? '');
    setDuration(song?.durationSec || 180);
    setError(null);
  }, [open, song]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Give this song a title.');
      return;
    }
    if (duration <= 0) {
      setError('Set a song length greater than zero.');
      return;
    }
    if (duration > 12 * 60 * 60) {
      setError('Song length must be 12 hours or less.');
      return;
    }
    if (song) {
      updateSong(groupId, song.id, { title: trimmed, durationSec: duration });
      pushToast('Song updated.', 'success');
      onClose();
      return;
    }
    const id = createSong(groupId, trimmed, duration);
    if (!id) {
      setError('Could not create this song.');
      return;
    }
    pushToast('Song created.', 'success');
    onClose();
    onCreated?.(id);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={song ? 'Edit song' : 'Add song'}
      eyebrow={song ? 'Song details' : 'New track'}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="song-form" className="btn btn-primary">
            {song ? 'Save changes' : 'Add song'}
          </button>
        </>
      }
    >
      <form id="song-form" onSubmit={handleSubmit} className="stack-form">
        <label className="field">
          <span className="field-label">Song title</span>
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Supernova"
            maxLength={80}
            autoComplete="off"
          />
        </label>
        <ClockInput
          label="Song length"
          value={duration}
          onChange={setDuration}
          hint="Used to plan section timestamps. You can change it later."
        />
        <p className="form-note">
          Link the dance practice video inside the choreo editor. Video files stay on your device
          and are never embedded in the workspace file.
        </p>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Modal>
  );
}
