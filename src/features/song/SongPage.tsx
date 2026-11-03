import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Music2, Pencil, Trash2 } from 'lucide-react';
import { choreoCounts } from '../../domain/stats';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { MediaImportModal } from '../../components/MediaImportModal';
import {
  copyMediaFile,
  mediaDestination,
  mediaErrorMessage,
  mediaLibrarySupported,
  resolveMediaCopy,
} from '../../lib/mediaSync';
import {
  emptyMediaCopyState,
  type MediaCopyResponse,
  type MediaCopyState,
  type MediaImportJob,
  type MediaKind,
  type MediaSource,
} from '../../lib/mediaTypes';
import { formatClock } from '../../lib/time';
import { useMediaStore } from '../../store/mediaStore';
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
  const mediaStatus = useMediaStore((state) => state.status);
  const mediaSyncing = useMediaStore((state) => state.syncing);
  const mediaManifest = useMediaStore((state) => state.manifest);
  const mediaLibraryPath = useMediaStore((state) => state.libraryPath);
  const mediaCopyEnabled = useMediaStore((state) => state.copyEnabled);
  const registerMediaCopy = useMediaStore((state) => state.registerCopy);
  const goGroup = useNavStore((state) => state.goGroup);
  const goWorkspace = useNavStore((state) => state.goWorkspace);
  const pushToast = useToastStore((state) => state.push);

  const group = workspace.groups.find((entry) => entry.id === groupId);
  const song = group?.songs.find((entry) => entry.id === songId);
  const [tab, setTab] = useState<Tab>('choreo');
  const [songModalOpen, setSongModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [importKind, setImportKind] = useState<MediaKind | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoObjectUrlRef = useRef<string | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const videoSourceRef = useRef<'none' | MediaSource>('none');
  const audioSourceRef = useRef<'none' | MediaSource>('none');
  const pendingMediaFilesRef = useRef<{ audio: File | null; video: File | null }>({
    audio: null,
    video: null,
  });
  const copyGenerationRef = useRef(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [videoSource, setVideoSource] = useState<MediaSource | null>(null);
  const [audioSource, setAudioSource] = useState<MediaSource | null>(null);
  const [videoCopyState, setVideoCopyState] = useState<MediaCopyState>(() =>
    emptyMediaCopyState(),
  );
  const [audioCopyState, setAudioCopyState] = useState<MediaCopyState>(() =>
    emptyMediaCopyState(),
  );
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    return () => {
      if (videoObjectUrlRef.current) URL.revokeObjectURL(videoObjectUrlRef.current);
      if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
      videoObjectUrlRef.current = null;
      audioObjectUrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (videoObjectUrlRef.current) URL.revokeObjectURL(videoObjectUrlRef.current);
    if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
    videoObjectUrlRef.current = null;
    audioObjectUrlRef.current = null;
    videoSourceRef.current = 'none';
    audioSourceRef.current = 'none';
    pendingMediaFilesRef.current = { audio: null, video: null };
    copyGenerationRef.current += 1;
    setVideoUrl(null);
    setAudioUrl(null);
    setVideoSource(null);
    setAudioSource(null);
    setVideoCopyState(emptyMediaCopyState());
    setAudioCopyState(emptyMediaCopyState());
    setVideoDuration(0);
    setCurrentTime(0);
    setImportKind(null);
  }, [songId]);

  useEffect(() => {
    setTab('choreo');
  }, [songId]);

  useEffect(() => {
    const group = workspace.groups.find((entry) => entry.id === groupId);
    const song = group?.songs.find((entry) => entry.id === songId);
    if (!group || !song || !mediaManifest) return;

    if (videoSourceRef.current !== 'local') {
      const resolved = resolveMediaCopy(
        mediaManifest,
        group.id,
        song.id,
        'video',
        song.videoFileName,
      );
      if (resolved) {
        videoSourceRef.current = 'library';
        setVideoSource('library');
        setVideoUrl(resolved.url);
      } else if (videoSourceRef.current === 'library') {
        videoSourceRef.current = 'none';
        setVideoSource(null);
        setVideoUrl(null);
      }
    }

    if (audioSourceRef.current !== 'local') {
      const resolved = resolveMediaCopy(
        mediaManifest,
        group.id,
        song.id,
        'audio',
        song.audioFileName,
      );
      if (resolved) {
        audioSourceRef.current = 'library';
        setAudioSource('library');
        setAudioUrl(resolved.url);
      } else if (audioSourceRef.current === 'library') {
        audioSourceRef.current = 'none';
        setAudioSource(null);
        setAudioUrl(null);
      }
    }
  }, [mediaManifest, groupId, songId]);

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

  const runMediaCopy = (kind: 'audio' | 'video', file: File) => {
    const setCopyState = kind === 'audio' ? setAudioCopyState : setVideoCopyState;
    if (!mediaCopyEnabled) {
      setCopyState({
        status: 'off',
        progress: 0,
        message:
          'Auto-copy is off. Turn it on in Settings → Media to keep this file for next session.',
        destination: null,
      });
      return;
    }
    if (mediaStatus === 'unavailable') {
      setCopyState({
        status: 'unavailable',
        progress: 0,
        message:
          'The media library is unavailable. This file stays linked for this session.',
        destination: null,
      });
      return;
    }
    const generation = copyGenerationRef.current;
    const copyGroupId = group.id;
    const copyGroupName = group.name;
    const copySongId = song.id;
    const copySongTitle = song.title;
    setCopyState({
      status: 'copying',
      progress: 0,
      message: 'Copying into the project media library…',
      destination: null,
    });
    void copyMediaFile({
      groupId: copyGroupId,
      groupName: copyGroupName,
      songId: copySongId,
      songTitle: copySongTitle,
      kind,
      file,
      onProgress: (progress) => {
        if (copyGenerationRef.current !== generation) return;
        setCopyState((current) =>
          current.status === 'copying' ? { ...current, progress } : current,
        );
      },
    })
      .then((result) => {
        registerMediaCopy({
          groupName: copyGroupName,
          songTitle: copySongTitle,
          result,
        });
        if (copyGenerationRef.current !== generation) return;
        setCopyState({
          status: 'done',
          progress: 1,
          message: result.reused
            ? 'That file was already in the project media library.'
            : 'Copied into the project media library for automatic reload.',
          destination: mediaDestination(result.relativePath, mediaLibraryPath),
        });
        pushToast(
          `${kind === 'audio' ? 'Audio' : 'Video'} ${
            result.reused ? 'already in' : 'copied to'
          } the media library.`,
          'success',
        );
      })
      .catch((error: unknown) => {
        if (copyGenerationRef.current !== generation) return;
        setCopyState({
          status: 'error',
          progress: 0,
          message: mediaErrorMessage(
            error,
            `The ${kind} could not be copied. It is still linked for this session.`,
          ),
          destination: null,
        });
        pushToast(
          `${kind === 'audio' ? 'Audio' : 'Video'} copy failed. The file stays linked for this session.`,
          'error',
        );
      });
  };

  const retryMediaCopy = (kind: 'audio' | 'video') => {
    const file = pendingMediaFilesRef.current[kind];
    if (file) runMediaCopy(kind, file);
  };

  const handleImported = (
    kind: MediaKind,
    result: MediaCopyResponse,
    job: MediaImportJob,
  ) => {
    const fileName = result.copy.originalName || result.copy.fileName;
    updateSong(
      group.id,
      song.id,
      kind === 'video' ? { videoFileName: fileName } : { audioFileName: fileName },
    );
    registerMediaCopy({
      groupName: group.name,
      songTitle: song.title,
      result,
    });
    pendingMediaFilesRef.current[kind] = null;
    copyGenerationRef.current += 1;

    if (kind === 'video') {
      if (videoObjectUrlRef.current) URL.revokeObjectURL(videoObjectUrlRef.current);
      videoObjectUrlRef.current = null;
      videoSourceRef.current = 'library';
      setVideoSource('library');
      setVideoUrl(result.url);
      setVideoDuration(0);
      setVideoCopyState({
        status: 'done',
        progress: 1,
        message: job.title
          ? `Imported “${job.title}” into the project media library.`
          : 'Imported into the project media library.',
        destination: mediaDestination(result.relativePath, mediaLibraryPath),
      });
    } else {
      if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
      audioSourceRef.current = 'library';
      setAudioSource('library');
      setAudioUrl(result.url);
      setAudioCopyState({
        status: 'done',
        progress: 1,
        message: job.title
          ? `Imported “${job.title}” into the project media library.`
          : 'Imported into the project media library.',
        destination: mediaDestination(result.relativePath, mediaLibraryPath),
      });
    }
    setCurrentTime(0);
    setImportKind(null);
    pushToast(
      `${kind === 'video' ? 'Video' : 'Audio'} imported into the media library.`,
      'success',
    );
  };

  const handleVideoFile = (file: File) => {
    if (videoObjectUrlRef.current) URL.revokeObjectURL(videoObjectUrlRef.current);
    const url = URL.createObjectURL(file);
    videoObjectUrlRef.current = url;
    videoSourceRef.current = 'local';
    setVideoSource('local');
    setVideoUrl(url);
    setVideoDuration(0);
    setCurrentTime(0);
    pendingMediaFilesRef.current.video = file;
    setVideoCopyState(emptyMediaCopyState());
    updateSong(group.id, song.id, { videoFileName: file.name });
    runMediaCopy('video', file);
  };

  const handleAudioFile = (file: File) => {
    if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
    const url = URL.createObjectURL(file);
    audioObjectUrlRef.current = url;
    audioSourceRef.current = 'local';
    setAudioSource('local');
    setAudioUrl(url);
    setCurrentTime(0);
    pendingMediaFilesRef.current.audio = file;
    setAudioCopyState(emptyMediaCopyState());
    updateSong(group.id, song.id, { audioFileName: file.name });
    runMediaCopy('audio', file);
  };

  const handleUseTrackDuration = (duration: number) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const next = Math.round(Math.min(duration, 12 * 60 * 60) * 10) / 10;
    updateSong(group.id, song.id, { durationSec: next });
    pushToast('Song length matched to the audio track.', 'success');
  };

  const hasAudio = Boolean(song.audioFileName);
  const hasVideo = Boolean(song.videoFileName);
  const mediaResolving = !mediaManifest && (mediaStatus === 'checking' || mediaSyncing);
  const videoResolving = hasVideo && !videoUrl && mediaResolving;
  const audioResolving = hasAudio && !audioUrl && mediaResolving;
  const mediaStatusLabel =
    hasAudio && hasVideo
      ? 'audio + video linked'
      : hasAudio
        ? 'audio linked'
        : hasVideo
          ? 'video linked'
          : 'no media linked';

  return (
    <div className="page song-page">
      <section className="song-hero">
        <button type="button" className="back-link" onClick={() => goGroup(group.id)}>
          <ArrowLeft size={14} />
          {group.name.trim() || 'Untitled group'}
        </button>
        <div className="song-hero-row">
          <div className="song-hero-copy">
            <p className="eyebrow">Song workspace · {mediaStatusLabel}</p>
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
            videoResolving={videoResolving}
            videoSource={videoSource}
            videoCopyState={videoCopyState}
            onVideoFile={handleVideoFile}
            onTimeUpdate={setCurrentTime}
            onLoadedMetadata={setVideoDuration}
            onRetryVideoCopy={() => retryMediaCopy('video')}
            onImportVideoUrl={
              mediaLibrarySupported() ? () => setImportKind('video') : undefined
            }
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
            audioUrl={audioUrl}
            audioRef={audioRef}
            currentTime={currentTime}
            audioResolving={audioResolving}
            audioSource={audioSource}
            audioCopyState={audioCopyState}
            onAudioFile={handleAudioFile}
            onTimeUpdate={setCurrentTime}
            onUseTrackDuration={handleUseTrackDuration}
            onRetryAudioCopy={() => retryMediaCopy('audio')}
            onImportAudioUrl={
              mediaLibrarySupported() ? () => setImportKind('audio') : undefined
            }
          />
        ) : null}
      </div>

      <SongModal
        open={songModalOpen}
        groupId={group.id}
        song={song}
        onClose={() => setSongModalOpen(false)}
      />

      {mediaLibrarySupported() ? (
        <MediaImportModal
          open={importKind !== null}
          kind={importKind ?? 'video'}
          groupId={group.id}
          groupName={group.name}
          songId={song.id}
          songTitle={song.title}
          initialUrl={importKind === 'audio' ? (song.sourceUrl ?? undefined) : undefined}
          onClose={() => setImportKind(null)}
          onImported={handleImported}
        />
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this song?"
        message={`${song.title || 'This song'} and all of its sections, formations, logged parts, and scores will be removed.`}
        confirmLabel="Delete song"
        tone="danger"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
