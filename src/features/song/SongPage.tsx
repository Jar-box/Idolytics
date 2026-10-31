import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Music2, Pencil, Trash2 } from 'lucide-react';
import { choreoCounts } from '../../domain/stats';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { formatClock } from '../../lib/time';
import { useNavStore } from '../../store/navStore';
import { useToastStore } from '../../store/toastStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ChoreoEditor } from '../choreo/ChoreoEditor';
import { LineDistributionPanel } from '../lines/LineDistributionPanel';
import { ResultsPanel } from '../results/ResultsPanel';
import { SongModal } from './SongModal';

interface SongPageProps {
  groupId: string;
  songId: string;
}

type Tab = 'choreo' | 'results' | 'lines';

export function SongPage({ groupId, songId }: SongPageProps) {
  const workspace = useWorkspaceStore((state) => state.workspace);
  const updateSong = useWorkspaceStore((state) => state.updateSong);
  const deleteSong = useWorkspaceStore((state) => state.deleteSong);
  const goGroup = useNavStore((state) => state.goGroup);
  const goWorkspace = useNavStore((state) => state.goWorkspace);
  const pushToast = useToastStore((state) => state.push);

  const group = workspace.groups.find((entry) => entry.id === groupId);
  const song = group?.songs.find((entry) => entry.id === songId);
  const [tab, setTab] = useState<Tab>('choreo');
  const [songModalOpen, setSongModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setVideoUrl(null);
    setVideoDuration(0);
    setCurrentTime(0);
  }, [songId]);

  useEffect(() => {
    setTab('choreo');
  }, [songId]);

  const counts = useMemo(() => (song ? choreoCounts(song) : null), [song]);

  if (!group || !song || !counts) {
    return (
      <div className="page">
        <EmptyState
          icon={<Music2 size={28} />}
          eyebrow="Missing song"
          title="This song is no longer here"
          message="It may have been deleted or was not part of the imported workspace."
          action={
            <button type="button" className="btn btn-primary" onClick={goWorkspace}>
              <ArrowLeft size={16} />
              Back to workspace
            </button>
          }
        />
      </div>
    );
  }

  const handleDelete = () => {
    deleteSong(group.id, song.id);
    setDeleteOpen(false);
    goGroup(group.id);
    pushToast('Song deleted.', 'success');
  };

  const handleVideoFile = (file: File) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setVideoUrl(url);
    setVideoDuration(0);
    setCurrentTime(0);
    updateSong(group.id, song.id, { videoFileName: file.name });
  };

  return (
    <div className="page song-page">
      <section className="song-hero">
        <button type="button" className="back-link" onClick={() => goGroup(group.id)}>
          <ArrowLeft size={14} />
          {group.name.trim() || 'Untitled group'}
        </button>
        <div className="song-hero-row">
          <div className="song-hero-copy">
            <p className="eyebrow">
              Song workspace · {song.videoFileName ? 'video linked' : 'video not linked'}
            </p>
            <input
              className="hero-title-input song-title-input"
              value={song.title}
              onChange={(event) => updateSong(group.id, song.id, { title: event.target.value })}
              placeholder="Untitled song"
              aria-label="Song title"
              maxLength={80}
            />
            <div className="hero-meta-row">
              <span>{formatClock(song.durationSec)}</span>
              <span>
                {counts.sections} {counts.sections === 1 ? 'section' : 'sections'}
              </span>
              <span>
                {counts.formations} {counts.formations === 1 ? 'formation' : 'formations'}
              </span>
              <span>{formatClock(counts.seconds)} choreo logged</span>
            </div>
          </div>
          <div className="hero-actions song-hero-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setSongModalOpen(true)}
            >
              <Pencil size={15} />
              Song details
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => setDeleteOpen(true)}
              title="Delete song"
              aria-label="Delete song"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <div className="tabs-row" role="tablist" aria-label="Song workspace views">
          <button
            type="button"
            role="tab"
            id="tab-choreo"
            aria-selected={tab === 'choreo'}
            aria-controls="panel-choreo"
            className={`tab-button ${tab === 'choreo' ? 'is-active' : ''}`}
            onClick={() => setTab('choreo')}
          >
            Choreo editor
          </button>
          <button
            type="button"
            role="tab"
            id="tab-results"
            aria-selected={tab === 'results'}
            aria-controls="panel-results"
            className={`tab-button ${tab === 'results' ? 'is-active' : ''}`}
            onClick={() => setTab('results')}
          >
            Results
          </button>
          <button
            type="button"
            role="tab"
            id="tab-lines"
            aria-selected={tab === 'lines'}
            aria-controls="panel-lines"
            className={`tab-button ${tab === 'lines' ? 'is-active' : ''}`}
            onClick={() => setTab('lines')}
          >
            Line distribution
          </button>
        </div>
      </section>

      <div
        role="tabpanel"
        id="panel-choreo"
        aria-labelledby="tab-choreo"
        hidden={tab !== 'choreo'}
      >
        {tab === 'choreo' ? (
          <ChoreoEditor
            key={song.id}
            group={group}
            song={song}
            videoUrl={videoUrl}
            videoRef={videoRef}
            videoDuration={videoDuration}
            currentTime={currentTime}
            onVideoFile={handleVideoFile}
            onTimeUpdate={setCurrentTime}
            onLoadedMetadata={setVideoDuration}
          />
        ) : null}
      </div>
      <div
        role="tabpanel"
        id="panel-results"
        aria-labelledby="tab-results"
        hidden={tab !== 'results'}
      >
        {tab === 'results' ? (
          <ResultsPanel group={group} song={song} onGoChoreo={() => setTab('choreo')} />
        ) : null}
      </div>
      <div
        role="tabpanel"
        id="panel-lines"
        aria-labelledby="tab-lines"
        hidden={tab !== 'lines'}
      >
        {tab === 'lines' ? (
          <LineDistributionPanel
            key={song.id}
            group={group}
            song={song}
            videoUrl={videoUrl}
            videoRef={videoRef}
            currentTime={currentTime}
            onVideoFile={handleVideoFile}
            onTimeUpdate={setCurrentTime}
            onLoadedMetadata={setVideoDuration}
          />
        ) : null}
      </div>

      <SongModal
        open={songModalOpen}
        groupId={group.id}
        song={song}
        onClose={() => setSongModalOpen(false)}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this song?"
        message={`${song.title || 'This song'} and all of its sections, formations, logged lines, and scores will be removed.`}
        confirmLabel="Delete song"
        tone="danger"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
