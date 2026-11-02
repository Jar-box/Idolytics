import {
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import type { Group, Song, VocalLine } from '../../domain/schema';
import {
  lineDuration,
  sortDistributionRows,
  type MemberDistribution,
} from '../../domain/lineDistribution';
import { Avatar } from '../../components/Avatar';
import { clamp, formatClock, formatPercent } from '../../lib/time';

const LANE_HEIGHT = 15;
const LANE_GAP = 3;

export type DistributionSortMode = 'time' | 'roster' | 'average';

interface DistributionChartProps {
  group: Group;
  song: Song;
  rows: MemberDistribution[];
  spanSec: number;
  currentTime: number;
  activeLines: VocalLine[];
  sortMode: DistributionSortMode;
  onSortChange: (mode: DistributionSortMode) => void;
  selectedLineId: string | null;
  onSelectLine: (lineId: string) => void;
  onSeek: (time: number) => void;
}

function tickStep(spanSec: number): number {
  if (spanSec <= 20) return 2;
  if (spanSec <= 60) return 5;
  if (spanSec <= 120) return 10;
  if (spanSec <= 300) return 30;
  if (spanSec <= 600) return 60;
  return 120;
}

function buildTicks(spanSec: number): number[] {
  const step = tickStep(spanSec);
  const ticks: number[] = [];
  for (let tick = 0; tick <= spanSec + 1e-6; tick += step) {
    ticks.push(Math.round(tick * 1000) / 1000);
  }
  const last = ticks[ticks.length - 1];
  if (last === undefined || last < spanSec - 1e-6) ticks.push(spanSec);
  return ticks;
}

export function DistributionChart({
  group,
  song,
  rows,
  spanSec,
  currentTime,
  activeLines,
  sortMode,
  onSortChange,
  selectedLineId,
  onSelectLine,
  onSeek,
}: DistributionChartProps) {
  const [hoveredLineId, setHoveredLineId] = useState<string | null>(null);

  const memberById = useMemo(
    () => new Map(group.members.map((member) => [member.id, member])),
    [group.members],
  );
  const lineById = useMemo(
    () => new Map(song.lines.map((line) => [line.id, line])),
    [song.lines],
  );
  const activeLineIds = useMemo(
    () => new Set(activeLines.map((line) => line.id)),
    [activeLines],
  );
  const activeMemberIds = useMemo(
    () => new Set(activeLines.flatMap((line) => line.memberIds)),
    [activeLines],
  );
  const playingLine = useMemo(
    () =>
      activeLines.reduce<VocalLine | null>(
        (latest, line) => (!latest || line.startSec >= latest.startSec ? line : latest),
        null,
      ),
    [activeLines],
  );
  const sortedRows = useMemo(
    () => sortDistributionRows(rows, group.members, sortMode),
    [rows, group.members, sortMode],
  );
  const ticks = useMemo(() => buildTicks(spanSec), [spanSec]);
  const playheadPercent = spanSec > 0 ? clamp(currentTime / spanSec, 0, 1) * 100 : 0;
  const inspectedLineId = hoveredLineId ?? selectedLineId ?? playingLine?.id ?? null;
  const activeLine = inspectedLineId ? lineById.get(inspectedLineId) ?? null : null;

  const handleTrackClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    onSeek(ratio * spanSec);
  };

  const describeLine = (line: VocalLine): string => {
    const names = line.memberIds
      .map((memberId) => memberById.get(memberId)?.name || 'Unknown member')
      .join(', ');
    const base = `${line.kind === 'adlib' ? 'Ad-lib' : 'Line'} from ${formatClock(
      line.startSec,
      true,
    )} to ${formatClock(line.endSec, true)}. ${names}.`;
    return line.lyric ? `${base} ${line.lyric}` : base;
  };

  return (
    <section className="panel dist-panel">
      <header className="panel-header dist-header">
        <div>
          <p className="eyebrow">Per member · whole song</p>
          <h2>Line distribution</h2>
        </div>
        <div className="dist-header-tools">
          <span className="panel-meta mono">
            {song.lines.length} {song.lines.length === 1 ? 'LINE' : 'LINES'} ·{' '}
            {formatClock(spanSec)}
          </span>
          <label className="dist-sort">
            <span className="sr-only">Sort members</span>
            <select
              className="select select-small mono"
              value={sortMode}
              onChange={(event) => onSortChange(event.target.value as DistributionSortMode)}
            >
              <option value="time">Sort: most time</option>
              <option value="average">Sort: average position</option>
              <option value="roster">Sort: roster order</option>
            </select>
          </label>
        </div>
      </header>

      <div className="dist-legend">
        <span className="dist-legend-item">
          <span className="dist-legend-swatch is-sung" aria-hidden="true" />
          Line
        </span>
        <span className="dist-legend-item">
          <span className="dist-legend-swatch is-adlib" aria-hidden="true" />
          Ad-lib
        </span>
        <span className="dist-legend-item">
          <span className="dist-legend-swatch is-average" aria-hidden="true" />
          Average position
        </span>
        <span className="dist-legend-time mono">
          <span className="live-dot" aria-hidden="true" />
          {formatClock(currentTime, true)}
        </span>
      </div>

      <div className="dist-readout" aria-live="polite">
        {activeLine ? (
          <>
            <span
              className={`line-kind-badge ${
                activeLine.kind === 'adlib' ? 'is-adlib' : 'is-sung'
              }`}
            >
              {activeLine.kind === 'adlib' ? 'Ad-lib' : 'Line'}
            </span>
            <span className="dist-readout-time mono">
              {formatClock(activeLine.startSec, true)} – {formatClock(activeLine.endSec, true)}
            </span>
            <span className="dist-readout-duration mono">
              {lineDuration(activeLine).toFixed(1)}s
            </span>
            <span className="dist-readout-members">
              {activeLine.memberIds.map((memberId) => {
                const member = memberById.get(memberId);
                if (!member) return null;
                return (
                  <span key={memberId} className="dist-readout-member">
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
            {activeLine.memberIds.length > 1 ? (
              <span className="dist-shared-note">full time to each</span>
            ) : null}
            {activeLine.lyric ? (
              <span className="dist-readout-lyric">“{activeLine.lyric}”</span>
            ) : null}
            {activeLine.note ? (
              <span className="dist-readout-note">{activeLine.note}</span>
            ) : null}
          </>
        ) : (
          <span className="dist-readout-empty">
            Hover a block to inspect it · click a block to select and seek
          </span>
        )}
      </div>

      <div className="dist-scroll">
        <div className="dist-chart">
          <div className="dist-axis" aria-hidden="true">
            <span className="dist-axis-label">Member</span>
            <div className="dist-axis-track">
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className={`dist-axis-tick ${
                    tick === 0 ? 'is-start' : tick === spanSec ? 'is-end' : ''
                  }`}
                  style={{ left: `${(tick / spanSec) * 100}%` }}
                >
                  <span className="dist-axis-tick-label mono">{formatClock(tick)}</span>
                </span>
              ))}
              <span
                className="dist-axis-playhead"
                style={{ left: `${playheadPercent}%` }}
              />
            </div>
            <span className="dist-axis-label is-right">Profile · share</span>
          </div>

          {sortedRows.map((row) => {
            const member = memberById.get(row.memberId);
            if (!member) return null;
            const isPlaying = activeMemberIds.has(row.memberId);
            const trackHeight =
              row.laneCount > 0
                ? row.laneCount * (LANE_HEIGHT + LANE_GAP) - LANE_GAP
                : LANE_HEIGHT;
            const averagePercent =
              row.averageSec === null ? null : clamp(row.averageSec / spanSec, 0, 1) * 100;
            const firstPercent =
              row.firstSec === null ? null : clamp(row.firstSec / spanSec, 0, 1) * 100;
            const lastPercent =
              row.lastSec === null ? null : clamp(row.lastSec / spanSec, 0, 1) * 100;

            return (
              <div
                className={['dist-row', isPlaying ? 'is-playing' : '']
                  .filter(Boolean)
                  .join(' ')}
                key={row.memberId}
                style={{ '--member-color': member.color } as CSSProperties}
              >
                <div className="dist-member">
                  <Avatar
                    name={member.name}
                    face={member.face}
                    color={member.color}
                    size={30}
                  />
                  <span className="dist-member-copy">
                    <span className="dist-member-name">
                      <span className="dist-member-name-text">
                        {member.name || 'Unnamed member'}
                      </span>
                      {isPlaying ? (
                        <>
                          <span className="dist-live-dot" aria-hidden="true" />
                          <span className="sr-only">singing now</span>
                        </>
                      ) : null}
                    </span>
                    <span className="dist-member-sub mono">
                      {row.lineCount} {row.lineCount === 1 ? 'line' : 'lines'}
                      {row.adlibCount > 0 ? ` · ${row.adlibCount} ad-lib` : ''}
                    </span>
                  </span>
                </div>

                <div
                  className="dist-track-column"
                  onClick={handleTrackClick}
                  title="Click to seek"
                >
                  <div
                    className={`dist-track ${row.laneCount === 0 ? 'is-empty' : ''}`}
                    style={{ height: `${trackHeight}px` }}
                  >
                    {ticks.slice(1, -1).map((tick) => (
                      <span
                        key={tick}
                        className="dist-gridline"
                        style={{ left: `${(tick / spanSec) * 100}%` }}
                        aria-hidden="true"
                      />
                    ))}

                    {row.segments.map((segment) => {
                      const line = segment.line;
                      const selected = line.id === selectedLineId;
                      const playing = activeLineIds.has(line.id);
                      const style = {
                        left: `${(line.startSec / spanSec) * 100}%`,
                        width: `${(lineDuration(line) / spanSec) * 100}%`,
                        top: `${segment.lane * (LANE_HEIGHT + LANE_GAP)}px`,
                        height: `${LANE_HEIGHT}px`,
                        '--member-color': member.color,
                      } as CSSProperties;
                      return (
                        <button
                          key={`${line.id}-${row.memberId}`}
                          type="button"
                          className={[
                            'dist-segment',
                            line.kind === 'adlib' ? 'is-adlib' : 'is-sung',
                            selected ? 'is-selected' : '',
                            playing ? 'is-playing' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          style={style}
                          aria-label={describeLine(line)}
                          aria-pressed={selected}
                          title={`${formatClock(line.startSec, true)} – ${formatClock(
                            line.endSec,
                            true,
                          )} · ${line.memberIds
                            .map(
                              (memberId) =>
                                memberById.get(memberId)?.name || 'Unknown member',
                            )
                            .join(', ')}`}
                          onMouseEnter={() => setHoveredLineId(line.id)}
                          onMouseLeave={() => setHoveredLineId(null)}
                          onFocus={() => setHoveredLineId(line.id)}
                          onBlur={() => setHoveredLineId(null)}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectLine(line.id);
                            onSeek(line.startSec);
                          }}
                        />
                      );
                    })}
                  </div>

                  <div className="dist-average-lane">
                    {firstPercent !== null && lastPercent !== null ? (
                      <span
                        className="dist-range-bar"
                        style={{
                          left: `${firstPercent}%`,
                          width: `${Math.max(0, lastPercent - firstPercent)}%`,
                          backgroundColor: member.color,
                        }}
                        aria-hidden="true"
                      />
                    ) : null}

                    {averagePercent !== null && row.averageSec !== null ? (
                      <>
                        <span
                          className="dist-average-stem"
                          style={{
                            left: `${averagePercent}%`,
                            backgroundColor: member.color,
                          }}
                          aria-hidden="true"
                        />
                        <span
                          className="dist-average-marker"
                          style={{ left: `${averagePercent}%` }}
                          title={`Average position · ${formatClock(row.averageSec)}`}
                        >
                          <Avatar
                            name={member.name}
                            face={member.face}
                            color={member.color}
                            size={28}
                          />
                          <span className="dist-average-label mono">
                            avg {formatClock(row.averageSec)}
                          </span>
                        </span>
                      </>
                    ) : (
                      <span className="dist-average-empty">No lines yet</span>
                    )}
                  </div>

                  <span
                    className="dist-row-playhead"
                    style={{ left: `${playheadPercent}%` }}
                    aria-hidden="true"
                  />
                </div>

                <div className="dist-row-stats">
                  <span className="dist-row-total mono">
                    {formatClock(row.totalSeconds)}
                  </span>
                  <span className="dist-row-share mono">
                    {formatPercent(row.share)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="dist-foot">
        <span>Solid = line · outline = ad-lib.</span>
        <span>Every credited member gets the full duration of a shared line.</span>
        <span>Playback lights up whoever is singing.</span>
        <span>Overlaps stack so ad-libs stay visible.</span>
      </footer>
    </section>
  );
}
