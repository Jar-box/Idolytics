import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { Check, MicVocal, Sparkles } from 'lucide-react';
import type { Group, LineKind, Song, VocalLine } from '../../domain/schema';
import { Avatar } from '../../components/Avatar';
import { ClockInput } from '../../components/ClockInput';
import { roundTo } from '../../lib/time';
import { useToastStore } from '../../store/toastStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

interface LineCaptureFormProps {
  group: Group;
  song: Song;
  line: VocalLine | null;
  currentTime: number;
  spanSec: number;
  onSaved: (lineId: string) => void;
  onCancelEdit: () => void;
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
}: LineCaptureFormProps) {
  const addLine = useWorkspaceStore((state) => state.addLine);
  const updateLine = useWorkspaceStore((state) => state.updateLine);
  const pushToast = useToastStore((state) => state.push);

  const initialStart = draftStartAt(currentTime, spanSec);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(draftEndAt(initialStart, spanSec));
  const [kind, setKind] = useState<LineKind>('sung');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [lyric, setLyric] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const nextStartRef = useRef<number | null>(null);

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

  const duration = Math.max(0, end - start);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedLyric = lyric.trim();
    const trimmedNote = note.trim();

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
        setError('Could not save this line. Check the members and times.');
        return;
      }
      nextStartRef.current = line.endSec;
      pushToast('Line updated.', 'success');
      onSaved(line.id);
      return;
    }

    const id = addLine(group.id, song.id, payload);
    if (!id) {
      setError('Could not add this line. Check the members and times.');
      return;
    }
    pushToast('Line added.', 'success');
    onSaved(id);
    resetDraft(end);
  };

  return (
    <section className="panel line-capture-panel">
      <header className="panel-header line-capture-header">
        <div>
          <p className="eyebrow">{line ? 'Editing logged part' : 'New vocal part'}</p>
          <h2>{line ? 'Edit line' : 'Capture a line'}</h2>
        </div>
        {line ? (
          <button type="button" className="btn btn-ghost btn-small" onClick={onCancelEdit}>
            Cancel
          </button>
        ) : (
          <span className="panel-meta mono">{duration.toFixed(1)}s</span>
        )}
      </header>

      <form id="line-capture-form" className="line-capture-form" onSubmit={handleSubmit}>
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
            <button
              type="button"
              className={`line-kind-option ${kind === 'sung' ? 'is-active' : ''}`}
              aria-pressed={kind === 'sung'}
              onClick={() => setKind('sung')}
            >
              <MicVocal size={14} />
              Line
            </button>
            <button
              type="button"
              className={`line-kind-option ${kind === 'adlib' ? 'is-active' : ''}`}
              aria-pressed={kind === 'adlib'}
              onClick={() => setKind('adlib')}
            >
              <Sparkles size={14} />
              Ad-lib
            </button>
          </div>
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
            placeholder="Harmony, ad-lib run, double-tracked…"
            maxLength={300}
            rows={2}
          />
        </label>

        {end > song.durationSec && song.durationSec > 0 ? (
          <p className="form-warning">
            This line ends past the saved song length. The chart will extend to fit it.
          </p>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}

        <button type="submit" className="btn btn-primary line-save-button">
          {line ? (
            <>
              <Check size={15} />
              Save line
            </>
          ) : (
            <>
              <MicVocal size={15} />
              Add line
            </>
          )}
        </button>
      </form>
    </section>
  );
}
