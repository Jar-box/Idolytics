import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Group, Song, VocalLine } from '../../domain/schema';
import {
  lineDuration,
  sortDistributionRows,
  type LineKindCounts,
  type MemberDistribution,
} from '../../domain/lineDistribution';
import { Avatar } from '../../components/Avatar';
import { clamp, formatClock, formatPercent, roundTo } from '../../lib/time';
import { formatKindCount, getLineKindMeta, lineKindOptions } from './lineKindMeta';

const LANE_HEIGHT = 15;
const LANE_GAP = 3;

const DRAG_THRESHOLD_PX = 2;
const SNAP_PX = 12;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 8;
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
  soloMemberId?: string | null;
  onToggleSolo?: (memberId: string) => void;
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
  soloMemberId = null,
  onToggleSolo,
}: DistributionChartProps) {
  const [hoveredLineId, setHoveredLineId] = useState<string | null>(null);

  // Clear hover (and thus handles) when clicking outside any dist-segment,
  // since clicking non-focusable elements does not blur/focus or mouseleave.
  useEffect(() => {
    const handle = (event: Event) => {
      const target = (event as unknown as MouseEvent).target as Element | null;
      if (target?.closest('.dist-segment')) return;
      setHoveredLineId(null);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);
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
  const [offScreenTop, setOffScreenTop] = useState<string[]>([]);
  const [offScreenBottom, setOffScreenBottom] = useState<string[]>([]);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const indicatorBoxRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);
  const pendingZoomAnchor = useRef<{ clientX: number; ratio: number } | null>(null);
  const currentTimeRef = useRef(currentTime);
  const spanSecRef = useRef(spanSec);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    spanSecRef.current = spanSec;
  }, [spanSec]);

  useEffect(() => {
    zoomRef.current = 1;
    pendingZoomAnchor.current = null;
    setZoom(1);
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [song.id]);

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
  const activeMemberKey = useMemo(
    () => [...new Set(activeLines.flatMap((line) => line.memberIds))].sort().join('|'),
    [activeLines],
  );
  const activeMemberIds = useMemo(
    () => new Set(activeMemberKey ? activeMemberKey.split('|') : []),
    [activeMemberKey],
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

  const getViewportBounds = useCallback(() => {
    const panel = scrollRef.current?.closest('.dist-panel');
    const zoomBar = panel?.querySelector<HTMLElement>('.dist-zoom-bar');
    const header = document.querySelector('.app-header');
    const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
    const zoomBarRect = zoomBar?.getBoundingClientRect();
    // Only reserve space for the zoom bar while it is actually stuck under the
    // app header; otherwise it sits lower in the panel and overlaps nothing.
    const zoomBarStuck =
      zoomBarRect !== undefined && zoomBarRect.top <= headerBottom + 1;
    const top = Math.max(0, zoomBarStuck && zoomBarRect ? zoomBarRect.bottom : headerBottom);
    const audioPlayer = document.querySelector('.audio-player-bottom');
    const bottom = Math.min(
      window.innerHeight,
      audioPlayer ? audioPlayer.getBoundingClientRect().top : window.innerHeight,
    );
    return { top, bottom };
  }, []);

  const scrollToMemberRow = useCallback(
    (memberId: string) => {
      const el = rowRefs.current.get(memberId);
      if (!el) return;
      const { top, bottom } = getViewportBounds();
      const rect = el.getBoundingClientRect();
      const available = Math.max(0, bottom - top);
      const targetViewportTop = top + Math.max(12, (available - rect.height) / 2);
      const maxScroll = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const nextScroll = Math.min(
        maxScroll,
        Math.max(0, window.scrollY + rect.top - targetViewportTop),
      );
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: nextScroll, behavior: reduceMotion ? 'auto' : 'smooth' });
    },
    [getViewportBounds],
  );

  const recomputeOffScreen = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const panel = root.closest('.dist-panel');
    const { top: topBoundary, bottom: bottomBoundary } = getViewportBounds();
    const panelRect = panel?.getBoundingClientRect();
    const chartInView = panelRect
      ? panelRect.bottom > topBoundary && panelRect.top < bottomBoundary
      : true;

    const nextTop: string[] = [];
    const nextBottom: string[] = [];
    let indicatorLeft: number | null = null;

    if (chartInView) {
      for (const row of sortedRows) {
        if (!activeMemberIds.has(row.memberId)) continue;
        const el = rowRefs.current.get(row.memberId);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.bottom <= topBoundary + 1) nextTop.push(row.memberId);
        else if (rect.top >= bottomBoundary - 1) nextBottom.push(row.memberId);
        if (indicatorLeft === null && (nextTop.length > 0 || nextBottom.length > 0)) {
          const memberEl = el.querySelector<HTMLElement>('.dist-member');
          indicatorLeft = memberEl ? memberEl.getBoundingClientRect().left : rect.left;
        }
      }
    }

    setOffScreenTop((prev) =>
      prev.length === nextTop.length && prev.every((id, i) => id === nextTop[i]) ? prev : nextTop,
    );
    setOffScreenBottom((prev) =>
      prev.length === nextBottom.length && prev.every((id, i) => id === nextBottom[i]) ? prev : nextBottom,
    );

    const box = indicatorBoxRef.current;
    if (box) {
      box.style.top = `${Math.round(topBoundary + 6)}px`;
      box.style.bottom = `${Math.round(window.innerHeight - bottomBoundary + 6)}px`;
      box.style.left = `${Math.round(indicatorLeft ?? root.getBoundingClientRect().left)}px`;
    }
  }, [activeMemberIds, getViewportBounds, sortedRows]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    recomputeOffScreen();
    const onScroll = () => recomputeOffScreen();
    window.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      root.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [sortedRows, recomputeOffScreen]);

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
  const activeLineMeta = activeLine ? getLineKindMeta(activeLine.kind) : null;

  const handleTrackClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    onSeek(ratio * spanSec);
  };

  const applyZoom = useCallback((nextZoom: number, anchorClientX?: number) => {
    const next = roundTo(clamp(nextZoom, ZOOM_MIN, ZOOM_MAX), 2);
    const current = zoomRef.current;
    if (Math.abs(next - current) < 1e-9) return;

    const track = trackRef.current;
    let anchorX = anchorClientX;
    if (anchorX === undefined) {
      const scroll = scrollRef.current;
      if (scroll && track) {
        const scrollRect = scroll.getBoundingClientRect();
        const trackRect = track.getBoundingClientRect();
        const visibleLeft = Math.max(scrollRect.left, trackRect.left);
        const visibleRight = Math.min(scrollRect.right, trackRect.right);
        const span = spanSecRef.current;
        const playheadX =
          span > 0
            ? trackRect.left + (currentTimeRef.current / span) * trackRect.width
            : trackRect.left;
        if (visibleRight > visibleLeft) {
          anchorX =
            playheadX >= visibleLeft && playheadX <= visibleRight
              ? playheadX
              : (visibleLeft + visibleRight) / 2;
        } else {
          anchorX = scrollRect.left + scrollRect.width / 2;
        }
      }
    }

    if (track && anchorX !== undefined) {
      const rect = track.getBoundingClientRect();
      if (rect.width > 0) {
        pendingZoomAnchor.current = {
          clientX: anchorX,
          ratio: clamp((anchorX - rect.left) / rect.width, 0, 1),
        };
      }
    }

    zoomRef.current = next;
    setZoom(next);
  }, []);

  useLayoutEffect(() => {
    const pending = pendingZoomAnchor.current;
    if (!pending) return;
    pendingZoomAnchor.current = null;
    const scroll = scrollRef.current;
    const track = trackRef.current;
    if (!scroll || !track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const delta = rect.left + pending.ratio * rect.width - pending.clientX;
    if (Math.abs(delta) > 0.5) {
      scroll.scrollLeft += delta;
    }
  }, [zoom]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        if (event.deltaY === 0) return;
        applyZoom(
          zoomRef.current + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP),
          event.clientX,
        );
        return;
      }

      if (event.shiftKey && !event.altKey) {
        const delta = event.deltaY || event.deltaX;
        if (delta !== 0) {
          event.preventDefault();
          node.scrollLeft += delta;
        }
      }
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  const describeLine = (line: VocalLine): string => {
    const names = line.memberIds
      .map((memberId) => memberById.get(memberId)?.name || 'Unknown member')
      .join(', ');
    const base = `${getLineKindMeta(line.kind).label} from ${formatClock(
      line.startSec,
      true,
    )} to ${formatClock(line.endSec, true)}. ${names}.`;
    return line.lyric ? `${base} ${line.lyric}` : base;
  };

  const offScreenIndicators = createPortal(
    <div ref={indicatorBoxRef} className="dist-offscreen-indicators">
      <div className="dist-offscreen-indicators__group dist-offscreen-indicators__group--top">
        {offScreenTop.map((memberId) => {
          const member = memberById.get(memberId);
          if (!member) return null;
          return (
            <button
              type="button"
              key={memberId}
              className="dist-offscreen-avatar"
              style={{ '--member-color': member.color } as CSSProperties}
              title={`Scroll to ${member.name || 'Unnamed member'}'s row`}
              aria-label={`Scroll to ${member.name || 'Unnamed member'}'s row`}
              onClick={() => scrollToMemberRow(memberId)}
            >
              <Avatar
                name={member.name}
                face={member.face}
                color={member.color}
                size={24}
              />
            </button>
          );
        })}
      </div>
      <div className="dist-offscreen-indicators__group dist-offscreen-indicators__group--bottom">
        {offScreenBottom.map((memberId) => {
          const member = memberById.get(memberId);
          if (!member) return null;
          return (
            <button
              type="button"
              key={memberId}
              className="dist-offscreen-avatar"
              style={{ '--member-color': member.color } as CSSProperties}
              title={`Scroll to ${member.name || 'Unnamed member'}'s row`}
              aria-label={`Scroll to ${member.name || 'Unnamed member'}'s row`}
              onClick={() => scrollToMemberRow(memberId)}
            >
              <Avatar
                name={member.name}
                face={member.face}
                color={member.color}
                size={24}
              />
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );

  return (
    <section className="panel dist-panel">
      {offScreenIndicators}
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
        {lineKindOptions.map(({ kind, label, color }) => (
          <span key={kind} className="dist-legend-item">
            <span
              className="dist-legend-swatch dist-legend-swatch--kind"
              style={{ '--kind-color': color } as CSSProperties}
              aria-hidden="true"
            />
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

      <div className="dist-zoom-bar" role="group" aria-label="Timeline zoom">
        <div className="dist-zoom-readout">
          <span className="dist-zoom-label mono">Timeline zoom</span>
          <button
            type="button"
            className="dist-zoom-value mono"
            onClick={() => applyZoom(1)}
            title="Reset zoom to 100%"
            aria-label={`Reset zoom to 100% (currently ${Math.round(zoom * 100)}%)`}
          >
            {Math.round(zoom * 100)}%
          </button>
        </div>
        <span className="dist-zoom-hint mono" aria-hidden="true">
          Ctrl / ⌘ + wheel to zoom · Shift + wheel to scroll
        </span>
        <div className="dist-zoom-controls">
          <button
            type="button"
            className="dist-zoom-step"
            onClick={() => applyZoom(zoomRef.current - ZOOM_STEP)}
            title="Zoom out"
            aria-label="Zoom out"
            disabled={zoom <= ZOOM_MIN + 1e-9}
          >
            −
          </button>
          <input
            type="range"
            className="dist-zoom-slider"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            value={zoom}
            aria-label="Timeline zoom"
            aria-valuetext={`${Math.round(zoom * 100)} percent`}
            onChange={(event) => applyZoom(Number(event.target.value))}
          />
          <button
            type="button"
            className="dist-zoom-step"
            onClick={() => applyZoom(zoomRef.current + ZOOM_STEP)}
            title="Zoom in"
            aria-label="Zoom in"
            disabled={zoom >= ZOOM_MAX - 1e-9}
          >
            +
          </button>
        </div>
      </div>

      <div
        className="dist-scroll"
        ref={scrollRef}
        style={{ touchAction: 'pan-x pan-y pinch-zoom', overscrollBehaviorX: 'contain' }}
      >
        <div className="dist-chart" style={{ '--dist-zoom': zoom } as CSSProperties}>
          <div className="dist-axis" aria-hidden="true">
            <span className="dist-axis-label">Member</span>
            <div className="dist-axis-track" ref={trackRef}>
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
                style={{ left: `calc(${playheadPercent}% * min(1, var(--dist-zoom, 1)))` }}
              />
            </div>
            <span className="dist-axis-label is-right">Profile · share</span>
          </div>

          {sortedRows.map((row) => {
            const member = memberById.get(row.memberId);
            if (!member) return null;
            const isPlaying = activeMemberIds.has(row.memberId);
            const isSoloMember = soloMemberId === row.memberId;
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
                ref={(el) => {
                  if (el) rowRefs.current.set(row.memberId, el);
                  else rowRefs.current.delete(row.memberId);
                }}
                className={['dist-row', isPlaying ? 'is-playing' : '', isSoloMember ? 'is-solo' : '']
                  .filter(Boolean)
                  .join(' ')}
                key={row.memberId}
                style={{ '--member-color': member.color } as CSSProperties}
              >
                <div
                  className="dist-member"
                  onClick={() => onToggleSolo?.(row.memberId)}
                  role={onToggleSolo ? 'button' : undefined}
                  tabIndex={onToggleSolo ? 0 : undefined}
                  onKeyDown={(event) => {
                    if (!onToggleSolo) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onToggleSolo(row.memberId);
                    }
                  }}
                  title={onToggleSolo ? `Play only ${member.name || 'this member'}'s parts` : undefined}
                >
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
                      const showHandles = selected || hoveredLineId === line.id;
                      const playing = activeLineIds.has(line.id);
                      const kindMeta = getLineKindMeta(line.kind);
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
'--kind-color': kindMeta.marked ? kindMeta.color : 'transparent',
                      } as CSSProperties;
                      return (
                        <Fragment key={`${line.id}-${row.memberId}`}>
                          <button
                            type="button"
                            className={[
                              'dist-segment',
                              kindMeta.className,
                              selected ? 'is-selected' : '',
                              playing ? 'is-playing' : '',
                              soloMemberId !== null && !line.memberIds.includes(soloMemberId)
                                ? 'is-dimmed'
                                : '',
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
                            {kindMeta.marked ? (
                               <span className="dist-segment-kind" style={{ '--kind-color': kindMeta.color } as CSSProperties} aria-hidden="true">
                                 <kindMeta.icon size={9} strokeWidth={2.4} />
                               </span>
                             ) : null}
{showHandles ? (
                              <>
                                <span
                                  className="dist-segment-handle dist-segment-handle--start"
                                  aria-hidden="true"
                                  onMouseDown={(event) => beginDrag(event, row, line, 'start')}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (didDragRef.current) {
                                      didDragRef.current = false;
                                      return;
                                    }
                                    onSelectLine(line.id);
                                  }}
                                />
                                <span
                                  className="dist-segment-handle dist-segment-handle--end"
                                  aria-hidden="true"
                                  onMouseDown={(event) => beginDrag(event, row, line, 'end')}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (didDragRef.current) {
                                      didDragRef.current = false;
                                      return;
                                    }
                                    onSelectLine(line.id);
                                  }}
                                />
                              </>
                            ) : null}
                          </button>
                          {dragged?.snapTarget !== undefined && dragged?.snapTarget !== null && (dragged.mode === 'start' || dragged.mode === 'end') ? (
                            <span
                              className="dist-snap-guide"
                              style={{
                                left: `calc(${(dragged.snapTarget / spanSec) * 100}% * min(1, var(--dist-zoom, 1)))`,
                                top: '0',
                                bottom: '0',
                              }}
                            />
                          ) : null}
                        </Fragment>
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
                    style={{ left: `calc(${playheadPercent}% * min(1, var(--dist-zoom, 1)))` }}
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


