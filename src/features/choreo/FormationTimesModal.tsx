import { useEffect, useState, type FormEvent } from 'react';
import type { Formation, Section } from '../../domain/schema';
import { ClockInput } from '../../components/ClockInput';
import { Modal } from '../../components/Modal';
import { formatClock, roundTime } from '../../lib/time';
import { useWorkspaceStore } from '../../store/workspaceStore';

interface FormationTimesModalProps {
  open: boolean;
  groupId: string;
  songId: string;
  section: Section;
  formation: Formation;
  currentTime: number;
  hasVideo: boolean;
  onClose: () => void;
}

export function FormationTimesModal({
  open,
  groupId,
  songId,
  section,
  formation,
  currentTime,
  hasVideo,
  onClose,
}: FormationTimesModalProps) {
  const updateFormationTimes = useWorkspaceStore((state) => state.updateFormationTimes);
  const [start, setStart] = useState(formation.startSec);
  const [end, setEnd] = useState(formation.endSec);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStart(formation.startSec);
    setEnd(formation.endSec);
    setError(null);
  }, [open, formation]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (end <= start) {
      setError('The end time must be after the start time.');
      return;
    }
    const ok = updateFormationTimes(
      groupId,
      songId,
      section.id,
      formation.id,
      start,
      end,
    );
    if (!ok) {
      setError(
        'This formation must stay inside its section and cannot overlap another formation.',
      );
      return;
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Formation timing"
      eyebrow="Duration weights the score"
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="formation-times-form" className="btn btn-primary">
            Save timing
          </button>
        </>
      }
    >
      <form id="formation-times-form" onSubmit={handleSubmit} className="stack-form">
        <div className="form-grid-2">
          <ClockInput
            label="Start"
            value={start}
            onChange={setStart}
            onUseCurrentTime={hasVideo ? () => setStart(roundTime(currentTime)) : undefined}
          />
          <ClockInput
            label="End"
            value={end}
            onChange={setEnd}
            onUseCurrentTime={hasVideo ? () => setEnd(roundTime(currentTime)) : undefined}
          />
        </div>
        <p className="form-note">
          Section range: {formatClock(section.startSec)} – {formatClock(section.endSec)}. Scores are
          weighted by this formation's duration in seconds.
        </p>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Modal>
  );
}
