import { ListMusic, Pencil, Play, Trash2 } from 'lucide-react';
import type { Group, VocalLine } from '../../domain/schema';
import { lineDuration } from '../../domain/lineDistribution';
import { formatClock } from '../../lib/time';
import { lineKindMeta } from './lineKindMeta';

interface LineLogProps {
  group: Group;
  lines: VocalLine[];
  activeLines: VocalLine[];
  selectedLineId: string | null;
  editingLineId: string | null;
  onSelect: (lineId: string) => void;
  onEdit: (line: VocalLine) => void;
  onDelete: (lineId: string) => void;
  onSeek: (time: number) => void;
}

export function LineLog({
  group,
  lines,
  activeLines,
  selectedLineId,
  editingLineId,
  onSelect,
  onEdit,
  onDelete,
  onSeek,
}: LineLogProps) {
  const memberById = new Map(group.members.map((member) => [member.id, member]));
  const activeLineIds = new Set(activeLines.map((line) => line.id));

  return (
    <section className="panel line-log-panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Chronological audit trail</p>
          <h2>Logged parts</h2>
        </div>
        <span className="panel-meta mono">
          {lines.length} {lines.length === 1 ? 'PART' : 'PARTS'}
        </span>
      </header>

      {lines.length === 0 ? (
        <div className="line-log-empty">
          <ListMusic size={22} />
          <p>No parts logged yet. Capture the first part in the panel on the right.</p>
        </div>
      ) : (
        <div className="line-log-list">
          {lines.map((line) => {
            const selected = line.id === selectedLineId;
            const editing = line.id === editingLineId;
            const playing = activeLineIds.has(line.id);
            const kindMeta = lineKindMeta[line.kind];
            return (
              <article
                key={line.id}
                className={[
                  'line-log-row',
                  selected ? 'is-selected' : '',
                  editing ? 'is-editing' : '',
                  playing ? 'is-playing' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <button
                  type="button"
                  className="line-log-main"
                  onClick={() => {
                    onSelect(line.id);
                    onSeek(line.startSec);
                  }}
                  aria-current={selected ? 'true' : undefined}
                >
                  <span className="line-log-time mono">
                    {playing ? (
                      <>
                        <span className="line-log-live-dot" aria-hidden="true" />
                        <span className="sr-only">singing now</span>
                      </>
                    ) : null}
                    <span>{formatClock(line.startSec, true)}</span>
                    <span className="line-log-arrow">→</span>
                    <span>{formatClock(line.endSec, true)}</span>
                  </span>

                  <span className={`line-kind-badge ${kindMeta.className}`}>
                    {kindMeta.label}
                  </span>

                  <span className="line-log-copy">
                    <span className="line-log-members">
                      {line.memberIds.map((memberId) => {
                        const member = memberById.get(memberId);
                        if (!member) return null;
                        return (
                          <span key={memberId} className="line-log-member">
                            <span
                              className="mini-color-dot"
                              style={{ backgroundColor: member.color }}
                              aria-hidden="true"
                            />
                            {member.name || 'Unnamed member'}
                          </span>
                        );
                      })}
                    </span>
                    {line.lyric ? (
                      <span className="line-log-lyric">“{line.lyric}”</span>
                    ) : null}
                    {line.note ? <span className="line-log-note">{line.note}</span> : null}
                  </span>
                </button>

                <div className="line-log-actions">
                  <span className="line-log-duration mono">
                    {lineDuration(line).toFixed(1)}s
                  </span>
                  <button
                    type="button"
                    className="icon-button icon-button-small"
                    onClick={() => onSeek(line.startSec)}
                    title="Seek to this part"
                    aria-label={`Seek to ${formatClock(line.startSec, true)}`}
                  >
                    <Play size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button-small"
                    onClick={() => onEdit(line)}
                    title="Edit part"
                    aria-label={`Edit part at ${formatClock(line.startSec, true)}`}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button-small line-log-delete"
                    onClick={() => onDelete(line.id)}
                    title="Delete part"
                    aria-label={`Delete part at ${formatClock(line.startSec, true)}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
