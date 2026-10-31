import { useEffect, useState, type FormEvent } from 'react';
import type { Section } from '../../domain/schema';
import { ClockInput } from '../../components/ClockInput';
import { Modal } from '../../components/Modal';
import { formatClock, roundTo } from '../../lib/time';
import { useWorkspaceStore } from '../../store/workspaceStore';

interface SectionModalProps {
  open: boolean;
  groupId: string;
  songId: string;
  section: Section | null;
  defaultLabel: string;
  defaultStart: number;
  defaultEnd: number;
  currentTime: number;
  hasVideo: boolean;
  onClose: () => void;
  onSaved: (sectionId: string) => void;
}

export function SectionModal({
  open,
  groupId,
  songId,
  section,
  defaultLabel,
  defaultStart,
  defaultEnd,
  currentTime,
  hasVideo,
  onClose,
  onSaved,
}: SectionModalProps) {
  const addSection = useWorkspaceStore((state) => state.addSection);
  const updateSection = useWorkspaceStore((state) => state.updateSection);

  const [label, setLabel] = useState(defaultLabel);
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel(section?.label ?? defaultLabel);
    setStart(section?.startSec ?? defaultStart);
    setEnd(section?.endSec ?? defaultEnd);
    setError(null);
  }, [open, section, defaultLabel, defaultStart, defaultEnd]);

  const useVideoTime = (setter: (value: number) => void) => {
    setter(roundTo(currentTime, 1));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (end <= start) {
      setError('The end time must be after the start time.');
      return;
    }
    if (end > 12 * 60 * 60) {
      setError('Section times must stay within 12 hours.');
      return;
    }
    const trimmed = label.trim();
    if (section) {
      const ok = updateSection(groupId, songId, section.id, {
        label: trimmed,
        startSec: start,
        endSec: end,
      });
      if (!ok) {
        setError(
          'Those times overlap another section or would leave a formation outside the new range.',
        );
        return;
      }
      onSaved(section.id);
    } else {
      const id = addSection(groupId, songId, trimmed, start, end);
      if (!id) {
        setError('Those times overlap another section. Choose a clear range.');
        return;
      }
      onSaved(id);
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={section ? 'Edit section' : 'Add section'}
      eyebrow={section ? 'Song map' : 'New range'}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="section-form" className="btn btn-primary">
            {section ? 'Save section' : 'Add section'}
          </button>
        </>
      }
    >
      <form id="section-form" onSubmit={handleSubmit} className="stack-form">
        <label className="field">
          <span className="field-label">Section label</span>
          <input
            className="input"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Chorus, Verse 1, Dance break…"
            maxLength={80}
            autoComplete="off"
          />
        </label>
        <div className="form-grid-2">
          <ClockInput
            label="Start"
            value={start}
            onChange={setStart}
            onUseCurrentTime={hasVideo ? () => useVideoTime(setStart) : undefined}
          />
          <ClockInput
            label="End"
            value={end}
            onChange={setEnd}
            onUseCurrentTime={hasVideo ? () => useVideoTime(setEnd) : undefined}
          />
        </div>
        <p className="form-note">
          A new section automatically gets one formation spanning its full range. Sections cannot
          overlap. {section ? `Currently ${formatClock(section.startSec)} – ${formatClock(section.endSec)}.` : ''}
        </p>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Modal>
  );
}
