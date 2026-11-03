import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type WheelEvent,
} from 'react';
import type { Group, Song, VocalLine } from '../../domain/schema';
import {
  lineDuration,
  sortDistributionRows,
  type LineKindCounts,
  type MemberDistribution,
} from '../../domain/lineDistribution';
import { Avatar } from '../../components/Avatar';
import { clamp, formatClock, formatPercent } from '../../lib/time';
import { formatKindCount, lineKindMeta, lineKindOptions } from './lineKindMeta';

const LANE_HEIGHT = 15;
const LANE_GAP = 3;

const DRAG_THRESHOLD_PX = 2;
const SNAP_PX = 12;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.1;

export type DistributionSortMode = 'time' | 'roster' | 'average';

interface DistributionChartProps {
  group: Group;
  song: Song;
  rows: MemberDistribution[];
  spanSec: number;
  currentTime: number;
  activeLines: VocalLine[];
  kindCounts: LineKindCounts;
  sortMode: DistributionSortMode;
  onSortChange: (mode: DistributionSortMode) => void;
  selectedLineId: string | null;
  onSelectLine: (lineId: string) => void;
  onSeek: (time: number) => void;
  onMoveLine?: (lineId: string, startSec: number, endSec: number) => void;
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
  kindCounts,
  sortMode,
  onSortChange,
  selectedLineId,
  onSelectLine,
  onSeek,
  onMoveLine,
}: DistributionChartProps) {
  const [hoveredLineId, setHoveredLineId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{
    lineId: string;
    memberId: string;
    mode: 'move' | 'start' | 'end';
    startSec: number;
    endSec: number;
    snapTarget?: number | null;
  } | null>(null);
  const dragOrigin = useRef<{
    lineId: string;
    memberId: string;
    mode: 'move' | 'start' | 'end';
    originStart: number;
    originEnd: number;
    originX: number;
    secPerPx: number;
  } | null>(null);
  const dragCurrent = useRef<{ startSec: number; endSec: number } | null>(null);
  const didDragRef = useRef(false);
  const [zoom, setZoom] = useState(1);

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

  const segmentBoundaries = useCallback(
    (excludeLineId: string): number[] =>
      sortedRows.flatMap((row) =>
        row.segments.flatMap((segment) =>
          segment.line.id === excludeLineId ? [] : [segment.line.startSec, segment.line.endSec],
        ),
      ),
    [sortedRows],
  );

  const snapValue = useCallback(
    (value: number, candidates: number[], thresholdSec: number): number => {
      let best = value;
      let bestDist = thresholdSec;
      for (const candidate of candidates) {
        const dist = Math.abs(candidate - value);
        if (dist < bestDist) {
          bestDist = dist;
          best = candidate;
        }
      }
      return best;
    },
    [],
  );

  const beginDrag = useCallback(
    (event: MouseEvent, row: MemberDistribution, line: VocalLine, mode: 'move' | 'start' | 'end') => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      didDragRef.current = false;
      dragCurrent.current = null;

      const button = event.currentTarget as HTMLElement;
      const track = (button.offsetParent as HTMLElement | null)?.offsetParent;
      const rect = track?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;

      dragOrigin.current = {
        lineId: line.id,
        memberId: row.memberId,
        mode,
        originStart: line.startSec,
        originEnd: line.endSec,
        originX: event.clientX,
        secPerPx: spanSec / rect.width,
      };

      const minDuration = 0.05;

      const onMove = (moveEvent: MouseEvent) => {
        const origin = dragOrigin.current;
        if (!origin) return;
        const deltaSec = (moveEvent.clientX - origin.originX) * origin.secPerPx;
        const neighbors = segmentBoundaries(origin.lineId);
        const snapThreshold = SNAP_PX * origin.secPerPx;
        let startSec = origin.originStart;
        let endSec = origin.originEnd;
        let snapTarget: number | null = null;

        if (origin.mode === 'move') {
          const duration = origin.originEnd - origin.originStart;
          startSec = clamp(origin.originStart + deltaSec, 0, spanSec - duration);
          endSec = startSec + duration;
        } else if (origin.mode === 'start') {
          startSec = clamp(origin.originStart + deltaSec, 0, origin.originEnd - minDuration);
          const snapped = snapValue(startSec, [0, ...neighbors], snapThreshold);
          if (Math.abs(snapped - startSec) < snapThreshold + 1e-9) {
            snapTarget = snapped;
            startSec = snapped;
          }
          startSec = clamp(startSec, 0, origin.originEnd - minDuration);
        } else {
          endSec = clamp(origin.originEnd + deltaSec, origin.originStart + minDuration, spanSec);
          const snapped = snapValue(endSec, [...neighbors, spanSec], snapThreshold);
          if (Math.abs(snapped - endSec) < snapThreshold + 1e-9) {
            snapTarget = snapped;
            endSec = snapped;
          }
          endSec = clamp(endSec, origin.originStart + minDuration, spanSec);
        }

        dragCurrent.current = { startSec, endSec };

        if (!didDragRef.current && Math.abs(moveEvent.clientX - origin.originX) > DRAG_THRESHOLD_PX) {
          didDragRef.current = true;
          setDragging({ lineId: origin.lineId, memberId: origin.memberId, mode: origin.mode, startSec, endSec, snapTarget });
        } else if (didDragRef.current) {
          setDragging({ lineId: origin.lineId, memberId: origin.memberId, mode: origin.mode, startSec, endSec, snapTarget });
        }
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove as unknown as EventListener);
        window.removeEventListener('mouseup', onUp as unknown as EventListener);
        const origin = dragOrigin.current;
        const current = dragCurrent.current;
        dragOrigin.current = null;
        dragCurrent.current = null;
        setDragging(null);
        if (!current || !origin || !didDragRef.current) return;
        const changed =
          current.startSec !== origin.originStart || current.endSec !== origin.originEnd;
        if (changed) {
          onMoveLine?.(origin.lineId, current.startSec, current.endSec);
        }
      };

      window.addEventListener('mousemove', onMove as unknown as EventListener);
      window.addEventListener('mouseup', onUp as unknown as EventListener, { once: true });
    },
    [spanSec, segmentBoundaries, snapValue, onMoveLine],
  );

  const playheadPercent = spanSec > 0 ? clamp(currentTime / spanSec, 0, 1) * 100 : 0;
  const inspectedLineId = hoveredLineId ?? selectedLineId ?? playingLine?.id ?? null;
  const activeLine = inspectedLineId ? lineById.get(inspectedLineId) ?? null : null;
  const activeLineMeta = activeLine ? lineKindMeta[activeLine.kind] : null;

  const handleTrackClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    onSeek(ratio * spanSec);
  };

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setZoom((current) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, current + delta)));
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom((current) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, current + delta)));
    },
    [],
  );

  const handleZoomIn = useCallback(() => {
    setZoom((current) => Math.min(ZOOM_MAX, current + ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((current) => Math.max(ZOOM_MIN, current - ZOOM_STEP));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
  }, []);

  const describeLine = (line: VocalLine): string => {
    const names = line.memberIds
      .map((memberId) => memberById.get(memberId)?.name || 'Unknown member')
      .join(', ');
    const base = `${lineKindMeta[line.kind].label} from ${formatClock(
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
            {song.lines.length} {song.lines.length === 1 ? 'PART' : 'PARTS'} ·{' '}
            {formatClock(spanSec)}
          </span>
          <div className="dist-zoom">
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={handleZoomOut}
              title="Zoom out"
              aria-label="Zoom out"
              disabled={zoom <= ZOOM_MIN}
            >
              −
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={handleZoomReset}
              title="Reset zoom"
              aria-label="Reset zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={handleZoomIn}
              title="Zoom in"
              aria-label="Zoom in"
              disabled={zoom >= ZOOM_MAX}
            >
              +
            </button>
          </div>
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
        {lineKindOptions.map(({ kind, label, className }) => (
          <span key={kind} className="dist-legend-item">
            <span className={`dist-legend-swatch ${className}`} aria-hidden="true" />
            {label}
            <span className="dist-legend-count mono">{kindCounts[kind]}</span>
          </span>
        ))}
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
        {activeLine && activeLineMeta ? (
          <>
            <span className={`line-kind-badge ${activeLineMeta.className}`}>
              {activeLineMeta.label}
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

      <div
        className="dist-scroll"
        onWheel={handleWheel}
        style={{ touchAction: 'pan-x pinch-zoom', overscrollBehaviorX: 'contain', overscrollBehaviorY: 'contain' }}
      >
        <div className="dist-chart" style={{ minWidth: `${760 * zoom}px` }}>
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
            const kindBreakdown = lineKindOptions
              .filter(({ kind }) => kind !== 'sung' && row.kindCounts[kind] > 0)
              .map(({ kind }) => formatKindCount(kind, row.kindCounts[kind]))
              .join(' · ');
            const kindTitle = lineKindOptions
              .map(({ kind, label }) => `${label} ${row.kindCounts[kind]}`)
              .join(' · ');
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
                    <span className="dist-member-sub mono" title={kindTitle}>
                      {row.lineCount} {row.lineCount === 1 ? 'part' : 'parts'}
                      {kindBreakdown ? ` · ${kindBreakdown}` : ''}
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
                      const kindMeta = lineKindMeta[line.kind];
                      const dragged = dragging?.lineId === line.id ? dragging : null;
                      const renderStart = dragged ? dragged.startSec : line.startSec;
                      const renderEnd = dragged ? dragged.endSec : line.endSec;
                      const eps = 1e-6;
                      const adjacentLeft = row.segments.some(
                        (other) =>
                          other.line.id !== line.id &&
                          Math.abs(other.line.endSec - line.startSec) < eps,
                      );
                      const adjacentRight = row.segments.some(
                        (other) =>
                          other.line.id !== line.id &&
                          Math.abs(other.line.startSec - line.endSec) < eps,
                      );
                      const style = {
                        left: `${(renderStart / spanSec) * 100}%`,
                        width: `${((renderEnd - renderStart) / spanSec) * 100}%`,
                        top: `${segment.lane * (LANE_HEIGHT + LANE_GAP)}px`,
                        height: `${LANE_HEIGHT}px`,
                        '--member-color': member.color,
                      } as CSSProperties;
                      return (
                        <>
                          <button
                            key={`${line.id}-${row.memberId}`}
                            type="button"
                            className={[
                              'dist-segment',
                              kindMeta.className,
                              selected ? 'is-selected' : '',
                              playing ? 'is-playing' : '',
                              adjacentLeft ? 'is-adjacent-left' : '',
                              adjacentRight ? 'is-adjacent-right' : '',
                              dragged ? 'is-dragging' : '',
                              dragged?.mode === 'start' ? 'is-dragging-start' : '',
                              dragged?.mode === 'end' ? 'is-dragging-end' : '',
                              dragged?.mode === 'move' ? 'is-dragging-move' : '',
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
                            onMouseDown={(event) => beginDrag(event, row, line, 'move')}
                            onClick={(event) => {
                              if (didDragRef.current) {
                                didDragRef.current = false;
                                return;
                              }
                              event.stopPropagation();
                              onSelectLine(line.id);
                              if (!event.ctrlKey && !event.metaKey) {
                                onSeek(line.startSec);
                              }
                            }}
                          >
                            <span
                              className="dist-segment-handle dist-segment-handle--start"
                              aria-label="Resize start"
                              onMouseDown={(event) => beginDrag(event, row, line, 'start')}
                              onClick={(event) => event.stopPropagation()}
                            />
                            <span
                              className="dist-segment-handle dist-segment-handle--end"
                              aria-label="Resize end"
                              onMouseDown={(event) => beginDrag(event, row, line, 'end')}
                              onClick={(event) => event.stopPropagation()}
                            />
                          </button>
                          {dragged?.snapTarget !== undefined && dragged?.snapTarget !== null && (dragged.mode === 'start' || dragged.mode === 'end') ? (
                            <span
                              className="dist-snap-guide"
                              style={{
                                left: `${(dragged.snapTarget / spanSec) * 100}%`,
                                top: '0',
                                bottom: '0',
                              }}
                            />
                          ) : null}
                        </>
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
        <span>Solid = line · outline = ad-lib · hatch = rap · shine = high note.</span>
        <span>Every credited member gets the full duration of a shared part.</span>
        <span>Playback lights up whoever is singing.</span>
        <span>Overlaps stack so layered parts stay visible.</span>
      </footer>
    </section>
  );
}
