import type { CSSProperties, DragEvent } from 'react';
import { Crown, EyeOff } from 'lucide-react';
import { memberColorPalette, type Formation, type Member, type Posture, type Song } from '../../domain/schema';
import type { FormationScore } from '../../domain/scoring';
import { Avatar } from '../../components/Avatar';
import { readMemberDrag, writeMemberDrag } from '../../lib/dnd';

interface StageGridProps {
  song: Song;
  formation: Formation;
  members: Member[];
  postures: Posture[];
  score: FormationScore;
  selectedMemberId: string | null;
  onSelectMember: (memberId: string | null) => void;
  onPlaceMember: (memberId: string, col: number, row: number) => void;
}

export function StageGrid({
  song,
  formation,
  members,
  postures,
  score,
  selectedMemberId,
  onSelectMember,
  onPlaceMember,
}: StageGridProps) {
  const memberById = new Map(members.map((member) => [member.id, member]));
  const postureById = new Map(postures.map((posture) => [posture.id, posture]));
  const placementByCell = new Map(
    formation.placements.map((placement) => [`${placement.col}:${placement.row}`, placement]),
  );
  const scoreByMember = new Map(score.memberScores.map((entry) => [entry.memberId, entry]));
  const selectedMember = selectedMemberId ? memberById.get(selectedMemberId) : null;
  const rows = Array.from({ length: song.grid.rows }, (_, index) => song.grid.rows - 1 - index);
  const cols = Array.from({ length: song.grid.cols }, (_, index) => index);

  const handleDrop = (event: DragEvent<HTMLElement>, col: number, row: number) => {
    event.preventDefault();
    const memberId = readMemberDrag(event);
    if (memberId) onPlaceMember(memberId, col, row);
  };

  return (
    <div className="stage-shell">
      <div className="stage-ruler">
        <span>BACK</span>
        <span className="mono">
          {song.grid.cols} × {song.grid.rows}
        </span>
        <span>STAGE</span>
      </div>

      <div className="stage-scroll">
        <div
          className="stage-grid"
          style={
            {
              gridTemplateColumns: `repeat(${song.grid.cols}, var(--stage-cell))`,
              '--stage-cols': song.grid.cols,
            } as CSSProperties
          }
        >
          <span className="stage-center-line" aria-hidden="true" />
          {rows.map((row) =>
            cols.map((col) => {
              const placement = placementByCell.get(`${col}:${row}`);
              if (!placement) {
                return (
                  <button
                    key={`${col}:${row}`}
                    type="button"
                    className={`stage-cell ${selectedMemberId ? 'is-target' : ''}`}
                    onClick={() => {
                      if (selectedMemberId) onPlaceMember(selectedMemberId, col, row);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(event) => handleDrop(event, col, row)}
                    aria-label={`Stage cell column ${col + 1}, row ${row + 1}${
                      selectedMember
                        ? ` — place ${selectedMember.name || 'selected member'}`
                        : ''
                    }`}
                  >
                    <span className="cell-plus" aria-hidden="true">
                      +
                    </span>
                  </button>
                );
              }
              const member = memberById.get(placement.memberId);
              const memberScore = scoreByMember.get(placement.memberId);
              const posture = postureById.get(placement.postureId);
              const numerator =
                memberScore && score.memberCount > 0
                  ? Math.round(memberScore.ratio * score.memberCount)
                  : 0;
              const isAnchor = formation.anchors.includes(placement.memberId);
              const isHidden = memberScore?.hidden ?? false;
              const isSelected = selectedMemberId === placement.memberId;
              const blockedBy = memberScore?.blockedBy
                ? memberById.get(memberScore.blockedBy)?.name || 'another member'
                : null;
              return (
                <div
                  key={`${col}:${row}`}
                  className={`stage-cell is-occupied ${isSelected ? 'is-selected' : ''}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => handleDrop(event, col, row)}
                  onClick={() => onSelectMember(placement.memberId)}
                >
                  <button
                    type="button"
                    className={`stage-token ${isAnchor ? 'is-anchor' : ''} ${
                      isHidden ? 'is-hidden' : ''
                    } ${isSelected ? 'is-selected' : ''}`}
                    style={
                      {
                        '--member-color': member?.color ?? memberColorPalette[0],
                      } as CSSProperties
                    }
                    draggable
                    onDragStart={(event) => writeMemberDrag(event, placement.memberId)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectMember(placement.memberId);
                    }}
                    title={`${member?.name || 'Unnamed member'} — ${
                      posture?.label ?? 'no posture'
                    } — ${numerator}/${score.memberCount}${
                      isHidden ? ` — blocked by ${blockedBy}` : ''
                    }`}
                    aria-label={`${member?.name || 'Unnamed member'}, ${
                      numerator
                    } of ${score.memberCount} points${
                      isAnchor ? ', anchor' : ''
                    }${isHidden ? `, blocked by ${blockedBy}` : ''}`}
                  >
                    <span className="token-badges" aria-hidden="true">
                      {isAnchor ? (
                        <span className="token-badge token-badge-anchor">
                          <Crown size={11} />
                        </span>
                      ) : null}
                      {isHidden ? (
                        <span className="token-badge token-badge-hidden">
                          <EyeOff size={11} />
                        </span>
                      ) : null}
                    </span>
                    <Avatar
                      name={member?.name ?? ''}
                      face={member?.face ?? null}
                      color={member?.color ?? memberColorPalette[0]}
                      size={46}
                      dimmed={isHidden}
                    />
                    <span className="token-score mono">
                      {numerator}/{score.memberCount}
                    </span>
                    <span className="token-name">{member?.name || 'Unnamed'}</span>
                    <span className="token-posture">{posture?.label ?? 'No posture'}</span>
                    {isHidden ? <span className="token-hidden-veil" aria-hidden="true" /> : null}
                  </button>
                </div>
              );
            }),
          )}
        </div>
      </div>

      <div className="stage-ruler stage-ruler-front">
        <span>AUDIENCE</span>
        <span className="stage-front-line" aria-hidden="true" />
        <span>FRONT</span>
      </div>

      <p className="stage-hint">
        {selectedMember
          ? `${
              selectedMember.name || 'Member'
            } selected — click a cell to place, or drag the token.`
          : 'Drag a member from the tray, or select a member and click a cell.'}
      </p>
    </div>
  );
}
