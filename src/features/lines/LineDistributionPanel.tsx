import { useEffect, useMemo, useState, useCallback, type RefObject } from 'react';
import { MicVocal, UserPlus } from 'lucide-react';
import type { Group, Song, VocalLine } from '../../domain/schema';
import { buildLineDistribution, linesAtTime } from '../../domain/lineDistribution';
import { EmptyState } from '../../components/EmptyState';
import { StatsRow } from '../../components/StatsRow';
import type { MediaCopyState, MediaSource } from '../../lib/mediaTypes';
import { formatClock, formatPercent, roundTime } from '../../lib/time';
import { useNavStore } from '../../store/navStore';
import { useToastStore } from '../../store/toastStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { AudioPanel } from './AudioPanel';
import {
  DistributionChart,
  type DistributionSortMode,
} from './DistributionChart';
import { LineCaptureForm } from './LineCaptureForm';
import { LineLog } from './LineLog';

interface LineDistributionPanelProps {
  group: Group;
  song: Song;
  audioUrl: string | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  currentTime: number;
  audioResolving?: boolean;
  audioSource?: MediaSource | null;
  audioCopyState?: MediaCopyState | null;
  onAudioFile: (file: File) => void;
  onTimeUpdate: (time: number) => void;
  onUseTrackDuration: (duration: number) => void;
  onRetryAudioCopy?: () => void;
  onImportAudioUrl?: () => void;
}

export function LineDistributionPanel({
  group,
  song,
  audioUrl,
  audioRef,
  currentTime,
  audioResolving = false,
  audioSource = null,
  audioCopyState = null,
  onAudioFile,
  onTimeUpdate,
  onUseTrackDuration,
  onRetryAudioCopy,
  onImportAudioUrl,
}: LineDistributionPanelProps) {
  const deleteLine = useWorkspaceStore((state) => state.deleteLine);
  const updateLine = useWorkspaceStore((state) => state.updateLine);
  const goGroup = useNavStore((state) => state.goGroup);
  const pushToast = useToastStore((state) => state.push);

  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<DistributionSortMode>('time');
  const [soloMemberId, setSoloMemberId] = useState<string | null>(null);

  const distribution = useMemo(
    () => buildLineDistribution(song, group.members),
    [song, group.members],
  );
  const activeLines = useMemo(
    () => linesAtTime(song.lines, currentTime),
    [song.lines, currentTime],
  );
  const memberById = useMemo(
    () => new Map(group.members.map((member) => [member.id, member])),
    [group.members],
  );
  const soloMember = soloMemberId
    ? group.members.find((member) => member.id === soloMemberId) ?? null
    : null;
  const soloParts = useMemo(() => {
    if (!soloMemberId) return [];
    return song.lines
      .filter((line) => line.memberIds.includes(soloMemberId))
      .sort((a, b) => a.startSec - b.startSec);
  }, [soloMemberId, song.lines]);
  const editingLine = editingLineId
    ? song.lines.find((line) => line.id === editingLineId) ?? null
    : null;

  useEffect(() => {
    if (selectedLineId && !song.lines.some((line) => line.id === selectedLineId)) {
      setSelectedLineId(null);
    }
    if (editingLineId && !song.lines.some((line) => line.id === editingLineId)) {
      setEditingLineId(null);
    }
    if (soloMemberId && !group.members.some((member) => member.id === soloMemberId)) {
      setSoloMemberId(null);
    }
  }, [song.lines, group.members, selectedLineId, editingLineId, soloMemberId]);

  const leader = useMemo(
    () =>
      distribution.rows.reduce<(typeof distribution.rows)[number] | null>(
        (best, row) => (!best || row.totalSeconds > best.totalSeconds ? row : best),
        null,
      ),
    [distribution.rows],
  );
  const leaderMember = leader ? memberById.get(leader.memberId) : null;

  const seek = (time: number) => {
    const next = Math.max(0, Math.min(time, distribution.spanSec));
    onTimeUpdate(next);
    const audio = audioRef.current;
    if (audio && audioUrl) {
      audio.pause();
      try {
        const max = Number.isFinite(audio.duration) ? audio.duration : next;
        audio.currentTime = Math.min(next, max);
      } catch {
        // Metadata may not be ready yet; the panel seeks on load instead.
      }
    }
  };

  const handleDeleteLine = (lineId: string) => {
    deleteLine(group.id, song.id, lineId);
    setSelectedLineId((current) => (current === lineId ? null : current));
    setEditingLineId((current) => (current === lineId ? null : current));
    pushToast('Part deleted.', 'success');
  };

  const handleSelectLine = (lineId: string) => {
    setSelectedLineId(lineId);
    setEditingLineId(lineId);
  };

  const handleMoveLine = (lineId: string, startSec: number, endSec: number) => {
    const ok = updateLine(group.id, song.id, lineId, {
      startSec: roundTime(startSec),
      endSec: roundTime(endSec),
    });
    if (ok) pushToast('Part moved.', 'success');
  };

  const handleToggleSolo = (memberId: string) => {
    if (soloMemberId === memberId) {
      setSoloMemberId(null);
      return;
    }
    const parts = song.lines
      .filter((line) => line.memberIds.includes(memberId))
      .sort((a, b) => a.startSec - b.startSec);
    if (parts.length === 0) {
      pushToast('No parts logged for this member.', 'info');
      return;
    }
    setSoloMemberId(memberId);
    const audio = audioRef.current;
    if (audio && audioUrl) {
      const now = audio.currentTime;
      const next =
        parts.find((part) => part.endSec > now + 0.05) ?? parts[0];
      try {
        audio.currentTime = next.startSec;
      } catch {
        // ignore
      }
      onTimeUpdate(next.startSec);
      void audio.play().catch(() => {});
    } else if (!audioUrl) {
      pushToast('Link audio to listen to parts.', 'info');
    }
  };

  const handleTimeUpdate = useCallback(
    (time: number) => {
      if (soloMemberId && audioRef.current && !audioRef.current.paused) {
        const parts = soloParts;
        const eps = 0.05;
        let current: VocalLine | null = null;
        for (const part of parts) {
          if (time >= part.startSec - eps && time <= part.endSec + eps) {
            current = part;
            break;
          }
        }
        if (current) {
          if (time < current.endSec - eps) {
            onTimeUpdate(time);
            return;
          }
          // If the next part is adjacent/overlapping, let playback flow
          // naturally into it instead of skipping or pausing.
          const adjacent = parts.find(
            (part) => part !== current && part.startSec <= current.endSec + eps,
          );
          if (adjacent) {
            onTimeUpdate(time);
            return;
          }
          const next = parts.find((part) => part.startSec > current.endSec + eps);
          if (next) {
            audioRef.current.currentTime = next.startSec;
            onTimeUpdate(next.startSec);
            return;
          }
          audioRef.current.pause();
          audioRef.current.currentTime = current.endSec;
          onTimeUpdate(current.endSec);
          return;
        }
        const next = parts.find((part) => part.startSec > time + eps);
        if (next) {
          audioRef.current.currentTime = next.startSec;
          onTimeUpdate(next.startSec);
          return;
        }
        if (parts.length && time < parts[0].startSec - eps) {
          audioRef.current.currentTime = parts[0].startSec;
          onTimeUpdate(parts[0].startSec);
          return;
        }
        const last = parts[parts.length - 1];
        if (last && time > last.endSec + eps) {
          audioRef.current.pause();
          audioRef.current.currentTime = last.endSec;
          onTimeUpdate(last.endSec);
          return;
        }
      }
      onTimeUpdate(time);
    },
    [soloMemberId, soloParts, audioRef, onTimeUpdate],
  );

  useEffect(() => {
    setSoloMemberId(null);
  }, [song.id]);

  useEffect(() => {
    if (!editingLineId) return;

    const handleClick = (event: MouseEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }
      const target = event.target as Element | null;
      if (target?.closest('.dist-segment, .line-log-row, .line-capture-panel, .audio-panel, .modal-backdrop, .modal-panel')) {
        return;
      }
      setEditingLineId(null);
      setSelectedLineId(null);
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setEditingLineId(null);
        setSelectedLineId(null);
      }
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [editingLineId, pushToast]);

  // Keep DOM focus from lingering on a dist-segment after clicking elsewhere:
  // clicking a non-focusable element does not move focus, so the segment
  // button would otherwise keep its focus ring (and handles) indefinitely.
  useEffect(() => {
    const handleBlurFocus = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.dist-segment')) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && active.closest && active.closest('.dist-segment')) {
        active.blur();
      }
      // Clear the selected (focused) segment when clicking anywhere that is
      // not a dist-segment / log row / exempt panel.
      if (
        !target?.closest(
          '.dist-segment, .line-log-row, .line-capture-panel, .audio-panel, .modal-backdrop, .modal-panel',
        )
      ) {
        setSelectedLineId(null);
      }
    };
    document.addEventListener('mousedown', handleBlurFocus);
    return () => document.removeEventListener('mousedown', handleBlurFocus);
  }, []);

  if (group.members.length === 0) {
    return (
      <div className="line-page">
        <section className="panel">
          <EmptyState
            icon={<UserPlus size={28} />}
            eyebrow="Roster required"
            title="Add members before logging parts"
            message="Line distribution needs a roster to assign each part. Build the group first, then come back."
            action={
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => goGroup(group.id)}
              >
                Go to roster
              </button>
            }
          />
        </section>
      </div>
    );
  }

  return (
    <div className="line-page">
      <StatsRow
        items={[
          {
            label: 'Member time',
            value: formatClock(distribution.totalMemberSeconds),
            hint:
              distribution.lineCount > 0
                ? `${distribution.lineCount} ${
                    distribution.lineCount === 1 ? 'part' : 'parts'
                  } logged`
                : 'No parts logged yet',
            accent: true,
          },
          {
            label: 'Unique part time',
            value: formatClock(distribution.totalUniqueSeconds),
            hint: `${formatClock(distribution.spanSec)} timeline`,
          },
          {
            label: 'Ad-libs',
            value: String(distribution.kindCounts.adlib).padStart(2, '0'),
            hint:
              distribution.kindCounts.adlib > 0
                ? 'Included in totals'
                : 'No ad-libs logged',
          },
          {
            label: 'Most time',
            value:
              leader && leader.totalSeconds > 0
                ? formatClock(leader.totalSeconds)
                : '—',
            hint:
              leader && leaderMember && leader.totalSeconds > 0
                ? `${leaderMember.name || 'Unnamed member'} · ${formatPercent(leader.share)}`
                : 'Log a part to begin',
          },
        ]}
      />

      <div className="line-layout">
        <div className="line-main">
          <DistributionChart
            group={group}
            song={song}
            rows={distribution.rows}
            spanSec={distribution.spanSec}
            currentTime={currentTime}
            activeLines={activeLines}
            kindCounts={distribution.kindCounts}
            sortMode={sortMode}
            onSortChange={setSortMode}
            selectedLineId={selectedLineId}
            onSelectLine={handleSelectLine}
            onSeek={seek}
            onMoveLine={handleMoveLine}
            soloMemberId={soloMemberId}
            onToggleSolo={handleToggleSolo}
          />

          <LineLog
            group={group}
            lines={distribution.sortedLines}
            activeLines={activeLines}
            selectedLineId={selectedLineId}
            editingLineId={editingLineId}
            onSelect={handleSelectLine}
            onEdit={(line) => {
              setEditingLineId(line.id);
              setSelectedLineId(line.id);
            }}
            onDelete={handleDeleteLine}
            onSeek={seek}
          />
        </div>

        <aside className="line-sidebar">
          <LineCaptureForm
            group={group}
            song={song}
            line={editingLine}
            currentTime={currentTime}
            spanSec={distribution.spanSec}
            onSaved={(lineId) => {
              setSelectedLineId(lineId);
              setEditingLineId(null);
            }}
            onCancelEdit={() => setEditingLineId(null)}
            onDelete={handleDeleteLine}
          />
        </aside>
      </div>

      {soloMember ? (
        <div className="solo-banner">
          <span>
            Playing only {soloMember.name || 'this member'}'s parts
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => setSoloMemberId(null)}
          >
            Clear
          </button>
        </div>
      ) : null}

      <section className="audio-player-bottom">
        <AudioPanel
          fileName={song.audioFileName}
          audioUrl={audioUrl}
          audioRef={audioRef}
          currentTime={currentTime}
          initialTime={currentTime}
          songDuration={song.durationSec}
          mediaResolving={audioResolving}
          mediaSource={audioSource}
          copyState={audioCopyState}
          onTimeUpdate={handleTimeUpdate}
          onFile={onAudioFile}
          onUseTrackDuration={onUseTrackDuration}
          onRetryCopy={onRetryAudioCopy}
          onImportUrl={onImportAudioUrl}
        />
      </section>

      {distribution.lineCount === 0 ? (
        <p className="line-first-hint">
          <MicVocal size={15} />
          {audioUrl
            ? 'Play the song audio, mark a start and end, pick who sings it, and save the first part.'
            : 'Link the song audio in the sidebar, mark a start and end, pick who sings it, and save the first part.'}
        </p>
      ) : null}
    </div>
  );
}
