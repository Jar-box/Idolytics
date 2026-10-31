import { useMemo } from 'react';
import { BarChart3, Crown, EyeOff, Star } from 'lucide-react';
import type { Group, Song } from '../../domain/schema';
import { buildGroupLeaderboard, scoreSong } from '../../domain/scoring';
import { Avatar } from '../../components/Avatar';
import { EmptyState } from '../../components/EmptyState';
import { Leaderboard } from '../../components/Leaderboard';
import { StatsRow } from '../../components/StatsRow';
import { formatClock, formatPoints, roundTo } from '../../lib/time';
import { useWorkspaceStore } from '../../store/workspaceStore';

interface ResultsPanelProps {
  group: Group;
  song: Song;
  onGoChoreo: () => void;
}

export function ResultsPanel({ group, song, onGoChoreo }: ResultsPanelProps) {
  const postures = useWorkspaceStore((state) => state.workspace.settings.postures);
  const score = useMemo(() => scoreSong(song, postures), [song, postures]);
  const groupLeaderboard = useMemo(
    () => buildGroupLeaderboard(group, postures),
    [group, postures],
  );

  const memberById = useMemo(
    () => new Map(group.members.map((member) => [member.id, member])),
    [group.members],
  );
  const formationScoreById = useMemo(
    () => new Map(score.formationScores.map((formation) => [formation.formationId, formation])),
    [score.formationScores],
  );
  const participantIds = useMemo(
    () => new Set(score.rows.map((row) => row.memberId)),
    [score.rows],
  );
  const notFeatured = group.members.filter((member) => !participantIds.has(member.id));
  const leader = score.rows[0] ? memberById.get(score.rows[0].memberId) : undefined;

  const sections = useMemo(
    () =>
      [...song.sections]
        .sort((a, b) => a.startSec - b.startSec)
        .map((section) => ({
          ...section,
          formations: [...section.formations].sort((a, b) => a.startSec - b.startSec),
        })),
    [song.sections],
  );

  if (score.durationSec === 0) {
    return (
      <div className="results-page">
        <section className="panel">
          <EmptyState
            icon={<BarChart3 size={28} />}
            eyebrow="No choreo data"
            title="Results appear after the first formation"
            message="Add a section and plot at least one formation to generate per-second scores."
            action={
              <button type="button" className="btn btn-primary" onClick={onGoChoreo}>
                Go to choreo editor
              </button>
            }
          />
        </section>
      </div>
    );
  }

  return (
    <div className="results-page">
      <StatsRow
        items={[
          { label: 'Choreo logged', value: formatClock(score.durationSec), accent: true },
          { label: 'Formations', value: String(score.formationCount).padStart(2, '0') },
          { label: 'Participants', value: String(score.rows.length).padStart(2, '0') },
          {
            label: 'Top score',
            value: score.rows[0] ? `${roundTo(score.rows[0].percentage, 1).toFixed(1)}%` : '—',
            hint: leader?.name,
          },
        ]}
      />

      <div className="results-grid">
        <section className="panel results-table-panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">Per member · whole song</p>
              <h2>Song results</h2>
            </div>
            <span className="panel-meta mono">% = PTS / CHOREO SEC</span>
          </header>
          <div className="table-scroll">
            <table className="results-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Member</th>
                  <th scope="col">Score</th>
                  <th scope="col">Points</th>
                  <th scope="col">Anchor time</th>
                  <th scope="col">Hidden</th>
                  <th scope="col">Placed</th>
                </tr>
              </thead>
              <tbody>
                {score.rows.map((row, index) => {
                  const member = memberById.get(row.memberId);
                  if (!member) return null;
                  return (
                    <tr key={row.memberId}>
                      <td className="mono table-rank">{String(index + 1).padStart(2, '0')}</td>
                      <td>
                        <div className="table-member">
                          <Avatar
                            name={member.name}
                            face={member.face}
                            color={member.color}
                            size={32}
                          />
                          <span>{member.name || 'Unnamed member'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-score">
                          <span className="mono">{roundTo(row.percentage, 1).toFixed(1)}%</span>
                          <span className="score-track" aria-hidden="true">
                            <span
                              style={{
                                width: `${Math.max(1, Math.min(100, row.percentage))}%`,
                              }}
                            />
                          </span>
                        </div>
                      </td>
                      <td className="mono">{formatPoints(row.points)}</td>
                      <td className="mono">{formatClock(row.anchorSeconds)}</td>
                      <td className="mono">
                        {row.hiddenSeconds > 0 ? (
                          <span className="cell-warn">
                            <EyeOff size={12} /> {formatClock(row.hiddenSeconds)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="mono">{row.placementCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {notFeatured.length > 0 ? (
            <div className="not-featured">
              <span>Not featured in this song:</span>
              {notFeatured.map((member) => (
                <span key={member.id} className="not-featured-chip">
                  <span className="mini-color-dot" style={{ backgroundColor: member.color }} />
                  {member.name || 'Unnamed member'}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        <Leaderboard
          rows={groupLeaderboard}
          title="Group leaderboard"
          eyebrow="Across all songs"
          emptyMessage="Log more songs to build the group ranking."
          compact
        />
      </div>

      <section className="panel breakdown-panel">
        <header className="panel-header">
          <div>
            <p className="eyebrow">Audit trail</p>
            <h2>Formation breakdown</h2>
          </div>
          <span className="panel-meta mono">
            {score.formationCount} {score.formationCount === 1 ? 'FORMATION' : 'FORMATIONS'}
          </span>
        </header>

        {sections.map((section) => (
          <div key={section.id} className="breakdown-section">
            <div className="breakdown-section-head">
              <div>
                <h3>{section.label || 'Untitled section'}</h3>
                <span className="mono">
                  {formatClock(section.startSec)} – {formatClock(section.endSec)}
                </span>
              </div>
              <span className="status-chip">
                {section.formations.length}{' '}
                {section.formations.length === 1 ? 'formation' : 'formations'}
              </span>
            </div>
            <div className="formation-breakdown-list">
              {section.formations.map((formation, index) => {
                const formationScore = formationScoreById.get(formation.id);
                if (!formationScore) return null;
                const duration = Math.max(0, formation.endSec - formation.startSec);
                const anchorNames = formation.anchors
                  .map((anchorId) => memberById.get(anchorId)?.name || 'Unknown')
                  .join(', ');
                return (
                  <details key={formation.id} className="formation-breakdown" open={index === 0}>
                    <summary>
                      <span className="formation-summary-title">
                        <span className="mono">F{String(index + 1).padStart(2, '0')}</span>
                        <span>
                          {formatClock(formation.startSec)} – {formatClock(formation.endSec)}
                        </span>
                        <span className="formation-summary-duration mono">
                          {duration.toFixed(1)}s
                        </span>
                      </span>
                      <span className="formation-summary-meta">
                        {anchorNames ? (
                          <span className="anchor-label">
                            <Crown size={12} /> {anchorNames}
                          </span>
                        ) : (
                          <span className="cell-warn">No anchor</span>
                        )}
                        <span>{formationScore.memberCount} placed</span>
                      </span>
                    </summary>
                    <div className="formation-score-list">
                      {formationScore.memberScores
                        .slice()
                        .sort((a, b) => b.ratio - a.ratio || a.memberId.localeCompare(b.memberId))
                        .map((memberScore) => {
                          const member = memberById.get(memberScore.memberId);
                          if (!member) return null;
                          const numerator =
                            formationScore.memberCount > 0
                              ? Math.round(memberScore.ratio * formationScore.memberCount)
                              : 0;
                          const blockedBy = memberScore.blockedBy
                            ? memberById.get(memberScore.blockedBy)?.name || 'another member'
                            : null;
                          return (
                            <div
                              key={memberScore.memberId}
                              className={`formation-score-row ${
                                memberScore.hidden ? 'is-hidden' : ''
                              }`}
                            >
                              <Avatar
                                name={member.name}
                                face={member.face}
                                color={member.color}
                                size={28}
                                dimmed={memberScore.hidden}
                              />
                              <span className="formation-score-name">
                                {member.name || 'Unnamed member'}
                                {memberScore.isAnchor ? (
                                  <span className="anchor-pill">
                                    <Star size={10} /> anchor
                                  </span>
                                ) : null}
                                {memberScore.hidden ? (
                                  <span className="hidden-pill">
                                    <EyeOff size={10} /> blocked by {blockedBy}
                                  </span>
                                ) : null}
                              </span>
                              <span className="mono formation-fraction">
                                {numerator}/{formationScore.memberCount}
                              </span>
                              <span className="mono formation-points">
                                {formatPoints(memberScore.points)} pts
                              </span>
                              <span className="mono formation-percent">
                                {Math.round(memberScore.ratio * 100)}%
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
