import { AlertTriangle, Crown, EyeOff, Star, Trash2 } from 'lucide-react';
import type { Formation, Member, Posture } from '../../domain/schema';
import type { FormationScore } from '../../domain/scoring';
import { Avatar } from '../../components/Avatar';
import { formatPoints } from '../../lib/time';

interface LiveScoreboardProps {
  formation: Formation;
  members: Member[];
  postures: Posture[];
  score: FormationScore;
  selectedMemberId: string | null;
  onSelectMember: (memberId: string) => void;
  onToggleAnchor: (memberId: string) => void;
  onSetPosture: (memberId: string, postureId: string) => void;
  onRemoveMember: (memberId: string) => void;
}

export function LiveScoreboard({
  formation,
  members,
  postures,
  score,
  selectedMemberId,
  onSelectMember,
  onToggleAnchor,
  onSetPosture,
  onRemoveMember,
}: LiveScoreboardProps) {
  const memberById = new Map(members.map((member) => [member.id, member]));
  const scoreByMember = new Map(score.memberScores.map((entry) => [entry.memberId, entry]));
  const placements = formation.placements
    .map((placement) => {
      const member = memberById.get(placement.memberId);
      const memberScore = scoreByMember.get(placement.memberId);
      return { placement, member, memberScore };
    })
    .filter(
      (entry): entry is {
        placement: (typeof formation.placements)[number];
        member: Member;
        memberScore: (typeof score.memberScores)[number];
      } => Boolean(entry.member && entry.memberScore),
    )
    .sort(
      (a, b) =>
        b.memberScore.ratio - a.memberScore.ratio ||
        (a.member.name || '').localeCompare(b.member.name || ''),
    );

  const anchorNames = formation.anchors
    .map((anchorId) => memberById.get(anchorId)?.name || 'Unknown')
    .join(', ');

  return (
    <aside className="panel score-panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">This formation</p>
          <h2>Live score</h2>
        </div>
        <span className="panel-meta mono">{score.durationSec.toFixed(1)}s</span>
      </header>

      <div className="score-summary">
        <div>
          <span className="score-summary-label">Placed</span>
          <span className="score-summary-value mono">{score.memberCount}</span>
        </div>
        <div>
          <span className="score-summary-label">Anchors</span>
          <span className="score-summary-value mono">
            {formation.anchors.length > 0 ? formation.anchors.length : '—'}
          </span>
        </div>
        <div className="score-summary-anchor">
          <span className="score-summary-label">Center</span>
          <span className="score-summary-name">{anchorNames || 'Not set'}</span>
        </div>
      </div>

      {!score.hasAnchor && score.memberCount > 0 ? (
        <div className="inline-warning">
          <AlertTriangle size={15} />
          <p>Select at least one anchor with the star button to score this formation.</p>
        </div>
      ) : null}

      {placements.length === 0 ? (
        <div className="score-empty">
          <Crown size={22} />
          <p>No one on stage yet. Drag members into the grid to see live scores.</p>
        </div>
      ) : (
        <div className="score-list">
          {placements.map(({ placement, member, memberScore }) => {
            const isAnchor = formation.anchors.includes(member.id);
            const numerator =
              score.memberCount > 0 ? Math.round(memberScore.ratio * score.memberCount) : 0;
            const percent = Math.round(memberScore.ratio * 100);
            const blockedBy = memberScore.blockedBy
              ? memberById.get(memberScore.blockedBy)?.name || 'another member'
              : null;
            return (
              <div
                key={member.id}
                className={`score-row ${member.id === selectedMemberId ? 'is-selected' : ''} ${
                  memberScore.hidden ? 'is-hidden' : ''
                }`}
              >
                <button
                  type="button"
                  className="score-row-main"
                  onClick={() => onSelectMember(member.id)}
                >
                  <Avatar
                    name={member.name}
                    face={member.face}
                    color={member.color}
                    size={34}
                    dimmed={memberScore.hidden}
                  />
                  <span className="score-row-identity">
                    <span className="score-row-name">
                      {member.name || 'Unnamed member'}
                      {isAnchor ? <Crown size={12} className="score-anchor-icon" /> : null}
                    </span>
                    <span className={`score-row-sub ${memberScore.hidden ? 'cell-warn' : ''}`}>
                      {memberScore.hidden ? (
                        <>
                          <EyeOff size={11} /> blocked by {blockedBy}
                        </>
                      ) : (
                        <>
                          {formatPoints(memberScore.points)} pts · rank {memberScore.rank + 1}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="score-row-value mono">
                    {numerator}/{score.memberCount}
                    <small>{percent}%</small>
                  </span>
                </button>
                <div className="score-track" aria-hidden="true">
                  <span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
                </div>
                <div className="score-row-controls">
                  <label className="score-posture">
                    <span className="sr-only">Posture for {member.name || 'member'}</span>
                    <select
                      className="select select-small"
                      value={placement.postureId}
                      onChange={(event) => onSetPosture(member.id, event.target.value)}
                    >
                      {postures.map((posture) => (
                        <option key={posture.id} value={posture.id}>
                          {posture.label || 'Unnamed posture'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className={`icon-button icon-button-small ${isAnchor ? 'is-active' : ''}`}
                    onClick={() => onToggleAnchor(member.id)}
                    aria-pressed={isAnchor}
                    title={isAnchor ? 'Remove anchor' : 'Make anchor'}
                    aria-label={isAnchor ? 'Remove anchor' : 'Make anchor'}
                  >
                    <Star size={14} fill={isAnchor ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button-small"
                    onClick={() => onRemoveMember(member.id)}
                    title="Remove from formation"
                    aria-label="Remove from formation"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <footer className="score-panel-foot">
        <span className="mono">PTS = RATIO × SECONDS</span>
        <span>Hidden members score 0.</span>
      </footer>
    </aside>
  );
}
