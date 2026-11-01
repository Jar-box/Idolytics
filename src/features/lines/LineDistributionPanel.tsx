import { useEffect, useMemo, useState, type RefObject } from 'react';
import { MicVocal, UserPlus } from 'lucide-react';
import type { Group, Song } from '../../domain/schema';
import { buildLineDistribution } from '../../domain/lineDistribution';
import { EmptyState } from '../../components/EmptyState';
import { StatsRow } from '../../components/StatsRow';
import type { MediaCopyState, MediaSource } from '../../lib/mediaTypes';
import { formatClock, formatPercent } from '../../lib/time';
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
  const goGroup = useNavStore((state) => state.goGroup);
  const pushToast = useToastStore((state) => state.push);

  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<DistributionSortMode>('time');

  const distribution = useMemo(
    () => buildLineDistribution(song, group.members),
    [song, group.members],
  );
  const memberById = useMemo(
    () => new Map(group.members.map((member) => [member.id, member])),
    [group.members],
  );
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
  }, [song.lines, selectedLineId, editingLineId]);

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
    pushToast('Line deleted.', 'success');
  };

  if (group.members.length === 0) {
    return (
      <div className="line-page">
        <section className="panel">
          <EmptyState
            icon={<UserPlus size={28} />}
            eyebrow="Roster required"
            title="Add members before logging lines"
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
                ? `${distribution.lineCount} ${distribution.lineCount === 1 ? 'line' : 'lines'} logged`
                : 'No lines logged yet',
            accent: true,
          },
          {
            label: 'Unique line time',
            value: formatClock(distribution.totalUniqueSeconds),
            hint: `${formatClock(distribution.spanSec)} timeline`,
          },
          {
            label: 'Ad-libs',
            value: String(distribution.adlibCount).padStart(2, '0'),
            hint:
              distribution.adlibCount > 0
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
                : 'Log a line to begin',
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
            sortMode={sortMode}
            onSortChange={setSortMode}
            selectedLineId={selectedLineId}
            onSelectLine={setSelectedLineId}
            onSeek={seek}
          />

          <LineLog
            group={group}
            lines={distribution.sortedLines}
            selectedLineId={selectedLineId}
            editingLineId={editingLineId}
            onSelect={setSelectedLineId}
            onEdit={(line) => {
              setEditingLineId(line.id);
              setSelectedLineId(line.id);
            }}
            onDelete={handleDeleteLine}
            onSeek={seek}
          />
        </div>

        <aside className="line-sidebar">
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
            onTimeUpdate={onTimeUpdate}
            onFile={onAudioFile}
            onUseTrackDuration={onUseTrackDuration}
            onRetryCopy={onRetryAudioCopy}
            onImportUrl={onImportAudioUrl}
          />

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
          />
        </aside>
      </div>

      {distribution.lineCount === 0 ? (
        <p className="line-first-hint">
          <MicVocal size={15} />
          {audioUrl
            ? 'Play the song audio, mark a start and end, pick who sings it, and save the first line.'
            : 'Link the song audio in the sidebar, mark a start and end, pick who sings it, and save the first line.'}
        </p>
      ) : null}
    </div>
  );
}
