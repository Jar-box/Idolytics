import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CircleCheck,
  Download,
  LoaderCircle,
  Music2,
  TriangleAlert,
  Video,
} from 'lucide-react';
import { Modal } from './Modal';
import {
  cancelMediaImport,
  mediaErrorMessage,
  startMediaImport,
  watchMediaImport,
} from '../lib/mediaSync';
import {
  isTerminalMediaImportState,
  type MediaCopyResponse,
  type MediaImportJob,
  type MediaImportQuality,
  type MediaKind,
} from '../lib/mediaTypes';
import { useMediaStore } from '../store/mediaStore';

interface MediaImportModalProps {
  open: boolean;
  kind: MediaKind;
  groupId: string;
  groupName: string;
  songId: string;
  songTitle: string;
  initialUrl?: string;
  onClose: () => void;
  onImported: (kind: MediaKind, copy: MediaCopyResponse, job: MediaImportJob) => void;
}

const QUALITY_OPTIONS: Array<{
  value: MediaImportQuality;
  label: string;
  hint: string;
}> = [
  { value: '1080', label: '1080p', hint: 'Full HD · recommended' },
  { value: '720', label: '720p', hint: 'Smaller download' },
  { value: 'best', label: 'Best', hint: 'Largest available' },
];

const STATE_LABELS: Record<MediaImportJob['state'], string> = {
  queued: 'Queued',
  resolving: 'Reading the link…',
  downloading: 'Downloading…',
  processing: 'Finalizing the download…',
  saving: 'Saving to the media library…',
  done: 'Import complete',
  error: 'Import failed',
  cancelled: 'Import cancelled',
};

export function MediaImportModal({
  open,
  kind,
  groupId,
  groupName,
  songId,
  songTitle,
  initialUrl,
  onClose,
  onImported,
}: MediaImportModalProps) {
  const mediaStatus = useMediaStore((state) => state.status);
  const tools = useMediaStore((state) => state.tools);
  const importQuality = useMediaStore((state) => state.importQuality);
  const setImportQuality = useMediaStore((state) => state.setImportQuality);

  const [url, setUrl] = useState('');
  const [job, setJob] = useState<MediaImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const jobIdRef = useRef<string | null>(null);
  const watchControllerRef = useRef<AbortController | null>(null);
  const completionRef = useRef(false);
  const closedRef = useRef(false);

  const active = starting || (job !== null && !isTerminalMediaImportState(job.state));
  const toolsReady =
    mediaStatus === 'ready' &&
    Boolean(tools?.ytDlp.available) &&
    Boolean(tools?.ffmpeg.available);
  const missingTools =
    mediaStatus === 'ready' &&
    Boolean(tools) &&
    (!tools?.ytDlp.available || !tools?.ffmpeg.available);

  useEffect(() => {
    if (!open) return;
    setUrl(initialUrl?.trim() ?? '');
    setJob(null);
    setError(null);
    setStarting(false);
    setCancelling(false);
    jobIdRef.current = null;
    completionRef.current = false;
    closedRef.current = false;
    watchControllerRef.current?.abort();
    watchControllerRef.current = null;
  }, [initialUrl, open, kind]);

  useEffect(() => {
    return () => {
      watchControllerRef.current?.abort();
      const jobId = jobIdRef.current;
      if (jobId) void cancelMediaImport(jobId).catch(() => undefined);
    };
  }, []);

  const finishJob = (finished: MediaImportJob) => {
    if (finished.state !== 'done' || !finished.copy || completionRef.current) return;
    completionRef.current = true;
    onImported(kind, finished.copy, finished);
  };

  const startImport = async (event?: FormEvent) => {
    event?.preventDefault();
    if (active || !toolsReady) return;
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Paste a video or audio URL first.');
      return;
    }
    setStarting(true);
    setError(null);
    setJob(null);
    completionRef.current = false;
    const controller = new AbortController();
    watchControllerRef.current = controller;
    try {
      const { jobId } = await startMediaImport({
        url: trimmed,
        groupId,
        groupName,
        songId,
        songTitle,
        kind,
        quality: kind === 'video' ? importQuality : 'best',
      });
      if (closedRef.current) {
        await cancelMediaImport(jobId).catch(() => undefined);
        return;
      }
      jobIdRef.current = jobId;
      const finished = await watchMediaImport(jobId, {
        signal: controller.signal,
        onUpdate: (next) => {
          if (closedRef.current) return;
          setJob(next);
        },
      });
      if (closedRef.current) return;
      setJob(finished);
      if (finished.state === 'error') {
        setError(finished.error ?? 'The import failed. Try again.');
      } else if (finished.state === 'done') {
        finishJob(finished);
      }
    } catch (caught) {
      if (!controller.signal.aborted && !closedRef.current) {
        setError(mediaErrorMessage(caught, 'The import could not be started.'));
      }
    } finally {
      if (!closedRef.current) {
        setStarting(false);
        setCancelling(false);
      }
      if (watchControllerRef.current === controller) {
        watchControllerRef.current = null;
      }
    }
  };

  const cancelImport = async () => {
    const jobId = jobIdRef.current;
    if (!jobId || cancelling || job?.state === 'saving') return;
    setCancelling(true);
    try {
      const result = await cancelMediaImport(jobId);
      setJob(result.job);
      if (result.job.state === 'done') {
        finishJob(result.job);
      } else if (result.job.state === 'error') {
        setError(result.job.error ?? 'The import failed. Try again.');
      }
      if (isTerminalMediaImportState(result.job.state)) {
        watchControllerRef.current?.abort();
      }
    } catch (caught) {
      setError(mediaErrorMessage(caught, 'The import could not be cancelled.'));
    } finally {
      setCancelling(false);
      setStarting(false);
    }
  };

  const handleClose = () => {
    if (job?.state === 'saving') {
      setError('Finishing the import. Wait a moment before closing.');
      return;
    }
    closedRef.current = true;
    watchControllerRef.current?.abort();
    const jobId = jobIdRef.current;
    if (jobId) void cancelMediaImport(jobId).catch(() => undefined);
    onClose();
  };

  const progress = Math.round(Math.max(0, Math.min(1, job?.progress ?? 0)) * 100);
  const title = kind === 'video' ? 'Import choreo video' : 'Import song audio';
  const Icon = kind === 'video' ? Video : Music2;
  const canStart = toolsReady && !active && url.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      eyebrow="yt-dlp · local download"
      size="md"
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleClose}
            disabled={job?.state === 'saving'}
          >
            {active ? 'Stop and close' : 'Close'}
          </button>
          {active ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void cancelImport()}
              disabled={cancelling || !jobIdRef.current || job?.state === 'saving'}
            >
              {cancelling ? (
                <LoaderCircle className="is-spinning" size={14} />
              ) : null}
              {cancelling ? 'Cancelling…' : 'Cancel import'}
            </button>
          ) : null}
          <button
            type="submit"
            form="media-import-form"
            className="btn btn-primary"
            disabled={!canStart || starting}
          >
            <Download size={15} />
            {active ? 'Importing…' : 'Import'}
          </button>
        </>
      }
    >
      <form id="media-import-form" className="media-import-form" onSubmit={startImport}>
        <div className="media-import-heading">
          <span className="media-import-icon">
            <Icon size={18} />
          </span>
          <div>
            <h3>{kind === 'video' ? 'Download reference footage' : 'Download the reference track'}</h3>
            <p>
              Paste a link from YouTube or any site yt-dlp supports. The file is saved inside
              this project&apos;s media folder and loads automatically on reload.
            </p>
          </div>
        </div>

        <label className="field">
          <span className="field-label">Media URL</span>
          <input
            className="input"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={active}
          />
          {initialUrl && url === initialUrl.trim() ? (
            <span className="field-hint">
              Prefilled from the song link. Change it if you are importing a different file.
            </span>
          ) : null}
        </label>

        {kind === 'video' ? (
          <div className="field">
            <span className="field-label">Video quality</span>
            <div className="media-import-quality" role="group" aria-label="Video quality">
              {QUALITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`media-import-quality-option ${
                    importQuality === option.value ? 'is-active' : ''
                  }`}
                  aria-pressed={importQuality === option.value}
                  onClick={() => setImportQuality(option.value)}
                  disabled={active}
                >
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="media-import-note">
            Audio downloads at the best quality available and is converted to M4A for the player.
          </p>
        )}

        {kind === 'video' ? (
          <p className="media-import-note">
            Audio is kept with the video. The song audio is imported separately so its mix and
            quality stay independent.
          </p>
        ) : null}

        {job ? (
          <div
            className={`media-import-progress ${
              job.state === 'done'
                ? 'is-done'
                : job.state === 'error'
                  ? 'is-error'
                  : job.state === 'cancelled'
                    ? 'is-cancelled'
                    : ''
            }`}
            role="status"
            aria-live="polite"
          >
            <div className="media-import-progress-head">
              <span className="media-import-progress-state">
                {job.state === 'done' ? (
                  <CircleCheck size={15} />
                ) : job.state === 'error' ? (
                  <TriangleAlert size={15} />
                ) : job.state === 'cancelled' ? null : (
                  <LoaderCircle className="is-spinning" size={15} />
                )}
                {STATE_LABELS[job.state]}
              </span>
              {job.state === 'downloading' ? (
                <span className="mono">{progress}%</span>
              ) : null}
            </div>
            <div
              className="media-import-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
            {job.title ? (
              <p className="media-import-title" title={job.title}>
                {job.title}
              </p>
            ) : null}
            {job.state === 'done' && job.copy ? (
              <p className="media-import-destination mono">{job.copy.relativePath}</p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="settings-note is-warning" role="alert">
            <TriangleAlert size={15} />
            <p>{error}</p>
          </div>
        ) : null}

        {missingTools ? (
          <div className="settings-note is-warning">
            <TriangleAlert size={15} />
            <p>
              {!tools?.ytDlp.available
                ? 'yt-dlp was not found. Install it or set IDOLYTICS_YTDLP_PATH, then restart the dev server.'
                : 'ffmpeg was not found. Install it or set IDOLYTICS_FFMPEG_PATH, then restart the dev server.'}
            </p>
          </div>
        ) : null}

        {!toolsReady && !missingTools ? (
          <div className="settings-note">
            <LoaderCircle className="is-spinning" size={15} />
            <p>
              {mediaStatus === 'unavailable'
                ? 'URL import needs the local dev server. Start the app with npm run dev.'
                : 'Checking for yt-dlp and ffmpeg…'}
            </p>
          </div>
        ) : null}

        <p className="media-import-footnote">
          Downloads run on this device only. Private, members-only, and live links may need
          cookies; see Settings → Media for the environment variables.
        </p>
      </form>
    </Modal>
  );
}
