import type { LeaderboardRow } from '../domain/scoring';
import { Avatar } from './Avatar';
import { EmptyState } from './EmptyState';
import { formatClock, formatPoints, roundTo } from '../lib/time';
import { Crown } from 'lucide-react';

interface LeaderboardProps {
  rows: LeaderboardRow[];
  showGroup?: boolean;
  limit?: number;
  title?: string;
  eyebrow?: string;
  emptyMessage?: string;
  compact?: boolean;
}

export function Leaderboard({
  rows,
  showGroup = false,
  limit,
  title = 'Choreo leaderboard',
  eyebrow = 'Normalized score',
  emptyMessage = 'Log a formation to start the ranking.',
  compact = false,
}: LeaderboardProps) {
  const visible = typeof limit === 'number' ? rows.slice(0, limit) : rows;
  const topPercentage = visible[0]?.percentage ?? 0;

  return (
    <section className={`panel leaderboard-panel ${compact ? 'is-compact' : ''}`}>
      <header className="panel-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <span className="panel-meta mono">% / SEC</span>
      </header>
      {visible.length === 0 ? (
        <EmptyState
          compact
          icon={<Crown size={24} />}
          title="No scores yet"
          message={emptyMessage}
        />
      ) : (
        <ol className="leaderboard-list">
          {visible.map((row, index) => {
            const rank = index + 1;
            const width = topPercentage > 0 ? (row.percentage / topPercentage) * 100 : 0;
            return (
              <li key={row.memberId} className={`leaderboard-row rank-${rank}`}>
                <span className="leaderboard-rank mono">{String(rank).padStart(2, '0')}</span>
                <Avatar name={row.memberName} face={row.face} color={row.color} size={38} />
                <div className="leaderboard-identity">
                  <span className="leaderboard-name">{row.memberName}</span>
                  <span className="leaderboard-sub">
                    {showGroup ? row.groupName : `${formatClock(row.anchorSeconds)} anchor`}
                  </span>
                </div>
                <div className="leaderboard-bar" aria-hidden="true">
                  <span style={{ width: `${Math.max(2, width)}%` }} />
                </div>
                <div className="leaderboard-numbers">
                  <span className="leaderboard-percent mono">
                    {roundTo(row.percentage, 1).toFixed(1)}
                    <small>%</small>
                  </span>
                  <span className="leaderboard-points mono">
                    {formatPoints(row.points)} pts · {row.songs} {row.songs === 1 ? 'song' : 'songs'}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
