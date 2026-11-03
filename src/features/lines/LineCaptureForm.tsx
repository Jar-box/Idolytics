import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { Check, MicVocal } from 'lucide-react';
import type { Group, LineKind, Song, VocalLine } from '../../domain/schema';
import { Avatar } from '../../components/Avatar';
import { ClockInput } from '../../components/ClockInput';
import { roundTo } from '../../lib/time';
import { useToastStore } from '../../store/toastStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { lineKindOptions } from './lineKindMeta';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface LineCaptureFormProps {
  group: Group;
  song: Song;
  line: VocalLine | null;
  currentTime: number;
  spanSec: number;
  onSaved: (lineId: string) => void;
  onCancelEdit: () => void;
  onDelete?: (lineId: string) => void;
}

const MAX_TIME = 60 * 60 * 12;

function draftStartAt(value: number, spanSec: number): number {
  return roundTo(Math.max(0, Math.min(value, Math.max(0, spanSec - 0.1))), 1);
}

function draftEndAt(start: number, spanSec: number): number {
  const end = Math.min(spanSec, start + 5);
  if (end > start) return roundTo(end, 1);
  return roundTo(Math.max(start + 0.1, Math.min(spanSec, start + 1)), 1);
}

export function LineCaptureForm({
  group,
  song,
  line,
  currentTime,
  spanSec,
  onSaved,
  onCancelEdit,
  onDelete,
}: LineCaptureFormProps) {
  const addLine = useWorkspaceStore((state) => state.addLine);
  const updateLine = useWorkspaceStore((state) => state.updateLine);
  const mergeLineIntoExisting = useWorkspaceStore((state) => state.mergeLineIntoExisting);
  const pushToast = useToastStore((state) => state.push);

  const [confirmDelete, setConfirmDelete] = useState(false);

  const initialStart = draftStartAt(currentTime, spanSec);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(draftEndAt(initialStart, spanSec));
  const [kind, setKind] = useState<LineKind>('sung');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [lyric, setLyric] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ memberId: string; memberName: string } | null>(null);
  const nextStartRef = useRef<number | null>(null);
const formRef = useRef<HTMLFormElement>(null);

  const resetDraft = (at: number) => {
    const nextStart = draftStartAt(at, spanSec);
    setStart(nextStart);
    setEnd(draftEndAt(nextStart, spanSec));
    setKind('sung');
    setMemberIds([]);
    setLyric('');
    setNote('');
    setError(null);
  };

  const activeLineId = line?.id ?? null;

  useEffect(() => {
    if (line) {
      setStart(line.startSec);
      setEnd(line.endSec);
      setKind(line.kind);
      setMemberIds(line.memberIds);
      setLyric(line.lyric ?? '');
      setNote(line.note ?? '');
      setError(null);
      return;
    }
    resetDraft(nextStartRef.current ?? currentTime);
    nextStartRef.current = null;
    // Reset only when entering or leaving edit mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLineId]);

  useEffect(() => {
    setMemberIds((current) => {
      const next = current.filter((memberId) =>
        group.members.some((member) => member.id === memberId),
      );
      return next.length === current.length ? current : next;
    });
  }, [group.members]);

  const toggleMember = (memberId: string) => {
    setMemberIds((current) =>
      current.includes(memberId)
        ? current.filter((entry) => entry !== memberId)
        : [...current, memberId],
    );
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target as Element | null;
      if (target?.closest('textarea')) return;
      if (target?.closest('#line-capture-form')) return; // native submit handles it
      formRef.current?.requestSubmit();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (end <= start) {
      setError('The end time must be after the start time.');
      return;
    }
    if (end > MAX_TIME) {
      setError('Line times must stay within 12 hours.');
      return;
    }
    if (memberIds.length === 0) {
      setError('Choose at least one member.');
      return;
    }

    const eps = 1e-6;
    const prevMembers = new Set(line?.memberIds ?? []);
    const addedMembers = memberIds.filter((m) => !prevMembers.has(m));
    if (addedMembers.length > 0) {
      for (const m of addedMembers) {
        const hasOverlap = song.lines.some(
          (l) =>
            l.id !== line?.id &&
            l.memberIds.includes(m) &&
            l.startSec < end - eps &&
            start < l.endSec + eps,
        );
        if (hasOverlap) {
          const member = group.members.find((gm) => gm.id === m);
          setConflict({ memberId: m, memberName: member?.name || 'This member' });
          setError(null);
          return;
        }
      }
    }

    doSave();
  };

  const doSave = () => {
    setConflict(null);
    const trimmedLyric = lyric.trim();
    const trimmedNote = note.trim();
    const payload = {
      startSec: start,
      endSec: end,
      memberIds,
      kind,
      lyric: trimmedLyric || undefined,
      note: trimmedNote || undefined,
    };
    if (line) {
      const ok = updateLine(group.id, song.id, line.id, payload);
      if (!ok) {
        setError('Could not save this part. Check the members and times.');
        return;
      }
      nextStartRef.current = line.endSec;
      pushToast('Part updated.', 'success');
      onSaved(line.id);
      return;
    }
    const id = addLine(group.id, song.id, payload);
    if (!id) {
      setError('Could not add this part. Check the members and times.');
      return;
    }
    pushToast('Part added.', 'success');
    onSaved(id);
    resetDraft(end);
  };

  const doMerge = () => {
    if (!conflict) return;
    setConflict(null);
    const trimmedLyric = lyric.trim();
    const trimmedNote = note.trim();
    const payload = {
      startSec: start,
      endSec: end,
      memberIds,
      kind,
      lyric: trimmedLyric || undefined,
      note: trimmedNote || undefined,
    };
    const ok = mergeLineIntoExisting(group.id, song.id, line?.id ?? null, payload, conflict.memberId);
    if (!ok) {
      setError('Could not merge this part. Check the members and times.');
      return;
    }
    pushToast('Merged into existing line.', 'success');
    if (line) {
      onSaved(line.id);
      onCancelEdit();
    } else {
      onSaved('');
      resetDraft(end);
    }
  };

  const duration = Math.max(0, end - start);

  const doDelete = () => {
    if (!line || !onDelete) return;
    setConfirmDelete(false);
    onDelete(line.id);
    onCancelEdit();
  };

  return (
    <section className="panel line-capture-panel">
      <header className="panel-header line-capture-header">
        <div>
          <p className="eyebrow">{line ? 'Editing logged part' : 'New vocal part'}</p>
          <h2>{line ? 'Edit part' : 'Capture a part'}</h2>
        </div>
        {line ? (
          <>
            <button type="button" className="btn btn-ghost btn-small" onClick={onCancelEdit}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => setConfirmDelete(true)}
            >
              Delete part
            </button>
          </>
        ) : (
          <span className="panel-meta mono">{duration.toFixed(1)}s</span>
        )}
      </header>

      <form ref={formRef} id="line-capture-form" className="line-capture-form" onSubmit={handleSubmit}>
        <div className="form-grid-2">
          <ClockInput
            label="Start"
            value={start}
            onChange={setStart}
            currentTimeLabel="audio"
            onUseCurrentTime={() => setStart(roundTo(currentTime, 1))}
          />
          <ClockInput
            label="End"
            value={end}
            onChange={setEnd}
            currentTimeLabel="audio"
            onUseCurrentTime={() => setEnd(roundTo(currentTime, 1))}
          />
        </div>

        <div className="field">
          <span className="field-label">Part type</span>
          <div className="line-kind-toggle" role="group" aria-label="Vocal part type">
            {lineKindOptions.map(({ kind: optionKind, label, className, icon: Icon }) => (
              <button
                key={optionKind}
                type="button"
                className={[
                  'line-kind-option',
                  className,
                  kind === optionKind ? 'is-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-pressed={kind === optionKind}
                onClick={() => setKind(optionKind)}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
          <span className="field-hint">
            One technique per part. If the delivery changes mid-line, split it into adjacent
            parts.
          </span>
        </div>

        <div className="field">
          <span className="field-label">Members</span>
          <div className="line-member-grid">
            {group.members.map((member) => {
              const selected = memberIds.includes(member.id);
              const style = {
                '--member-color': member.color,
              } as CSSProperties;
              return (
                <button
                  key={member.id}
                  type="button"
                  className={`line-member-chip ${selected ? 'is-selected' : ''}`}
                  style={style}
                  aria-pressed={selected}
                  onClick={() => toggleMember(member.id)}
                >
                  <Avatar
                    name={member.name}
                    face={member.face}
                    color={member.color}
                    size={22}
                  />
                  <span className="line-member-name">
                    {member.name || 'Unnamed member'}
                  </span>
                  {selected ? <Check size={12} className="line-member-check" /> : null}
                </button>
              );
            })}
          </div>
          <span className="field-hint">
            {memberIds.length > 1
              ? `Shared part — each selected member gets the full ${duration.toFixed(1)}s.`
              : 'Pick one or more members. Shared parts credit the full duration to everyone.'}
          </span>
        </div>

        <label className="field">
          <span className="field-label">
            Lyric <span className="line-optional">optional</span>
          </span>
          <input
            className="input"
            value={lyric}
            onChange={(event) => setLyric(event.target.value)}
            placeholder="e.g. I'm a supernova"
            maxLength={300}
            autoComplete="off"
          />
        </label>

        <label className="field">
          <span className="field-label">
            Note <span className="line-optional">optional</span>
          </span>
          <textarea
            className="input line-note-input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Harmony, ad-lib run, high note, double-tracked…"
            maxLength={300}
            rows={2}
          />
        </label>

        {end > song.durationSec && song.durationSec > 0 ? (
          <p className="form-warning">
            This part ends past the saved song length. The chart will extend to fit it.
          </p>
        ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      <button type="submit" className="btn btn-primary line-save-button">
        {line ? (
          <>
            <Check size={15} />
            Save part
          </>
        ) : (
          <>
            <MicVocal size={15} />
            Add part
          </>
        )}
      </button>
    </form>

      <ConfirmDialog
        open={conflict !== null}
        title="Line conflict"
        message={
          conflict
            ? `${conflict.memberName} already has a line at this time. Keep both lines (overlapping), or cut ${conflict.memberName}'s line so this part becomes shared with them?`
            : ''
        }
        confirmLabel="Cut & share"
        cancelLabel="Keep both (overlapping)"
        onConfirm={doMerge}
        onCancel={doSave}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete part"
        message="Delete this part? This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
  </section>
  );
}
