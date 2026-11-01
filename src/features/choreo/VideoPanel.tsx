import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  HardDrive,
  Link2,
  LoaderCircle,
  Video,
} from 'lucide-react';
import { MediaCopyNote } from '../../components/MediaCopyNote';
import type { MediaCopyState, MediaSource } from '../../lib/mediaTypes';
import { formatClock, clamp } from '../../lib/time';

interface VideoPanelProps {
  fileName: string | null;
  videoUrl: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  currentTime: number;
  initialTime?: number;
  mediaResolving?: boolean;
  mediaSource?: MediaSource | null;
  copyState?: MediaCopyState | null;
  onTimeUpdate: (time: number) => void;
  onFile: (file: File) => void;
  onLoadedMetadata: (duration: number) => void;
  onRetryCopy?: () => void;
  onImportUrl?: () => void;
}

const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5];

export function VideoPanel({
  fileName,
  videoUrl,
  videoRef,
  currentTime,
  initialTime = 0,
  mediaResolving = false,
  mediaSource = null,
  copyState = null,
  onTimeUpdate,
  onFile,
  onLoadedMetadata,
  onRetryCopy,
  onImportUrl,
}: VideoPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rate, setRate] = useState(1);
  const [duration, setDuration] = useState(0);
  const [videoError, setVideoError] = useState(false);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate, videoRef, videoUrl]);

  const nudge = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const max = Number.isFinite(video.duration) ? video.duration : 0;
    const next = clamp(video.currentTime + delta, 0, max);
    video.pause();
    video.currentTime = next;
    onTimeUpdate(next);
  };

  return (
    <section className="panel video-panel">
      <header className="panel-header video-panel-header">
        <div>
          <p className="eyebrow">Reference footage</p>
          <h2>Choreo video</h2>
        </div>
        <div className="media-panel-actions">
          {mediaSource === 'library' ? (
            <span className="media-source-chip">
              <HardDrive size={11} />
              Library
            </span>
          ) : null}
          {onImportUrl ? (
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={onImportUrl}
            >
              <Download size={14} />
              Import URL
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => fileInputRef.current?.click()}
          >
            <Link2 size={14} />
            {videoUrl ? 'Relink' : 'Link video'}
          </button>
        </div>
      </header>

      {videoUrl ? (
        <>
          <div className="video-frame">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              preload="metadata"
              playsInline
              onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
              onSeeked={(event) => onTimeUpdate(event.currentTarget.currentTime)}
              onLoadedMetadata={(event) => {
                const duration = event.currentTarget.duration;
                setDuration(duration);
                event.currentTarget.playbackRate = rate;
                const target = Number.isFinite(initialTime)
                  ? Math.max(0, Math.min(initialTime, duration || initialTime))
                  : 0;
                if (target > 0.05) {
                  event.currentTarget.currentTime = target;
                  onTimeUpdate(target);
                }
                onLoadedMetadata(duration);
              }}
              onError={() => setVideoError(true)}
            />
          </div>
          <div className="video-controls">
            <span className="video-time mono">{formatClock(currentTime, true)}</span>
            <span className="video-duration mono">/ {formatClock(duration, true)}</span>
            <div className="video-step-buttons">
              <button
                type="button"
                className="icon-button icon-button-small"
                onClick={() => nudge(-1 / 30)}
                title="Back one frame"
                aria-label="Back one frame"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                className="icon-button icon-button-small"
                onClick={() => nudge(1 / 30)}
                title="Forward one frame"
                aria-label="Forward one frame"
              >
                <ChevronRight size={15} />
              </button>
            </div>
            <label className="speed-field">
              <span className="sr-only">Playback speed</span>
              <select
                className="select select-small mono"
                value={rate}
                onChange={(event) => setRate(Number(event.target.value))}
              >
                {speeds.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}×
                  </option>
                ))}
              </select>
            </label>
          </div>
          {videoError ? (
            <p className="video-note is-warning">
              This browser could not play the selected file. Try an MP4 encoded with H.264.
            </p>
          ) : null}
          <MediaCopyNote state={copyState} onRetry={onRetryCopy} />
        </>
      ) : fileName && mediaResolving ? (
        <div className="video-empty">
          <div className="video-empty-icon">
            <LoaderCircle className="is-spinning" size={24} />
          </div>
          <h3>Restoring from the media library</h3>
          <p>Looking for the saved copy of “{fileName}” in the project media folder.</p>
        </div>
      ) : (
        <div className="video-empty">
          <div className="video-empty-icon">
            <Film size={26} />
          </div>
          <h3>{fileName ? 'Relink your video' : 'Link the dance practice'}</h3>
          <p>
            {fileName
              ? `Last session used "${fileName}". Videos are never embedded in the workspace file, so choose it again.`
              : 'Choose a local video file to scrub through the choreo while you plot formations.'}
          </p>
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => fileInputRef.current?.click()}
          >
            <Video size={15} />
            {fileName ? 'Re-link video file' : 'Choose video file'}
          </button>
          {onImportUrl ? (
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={onImportUrl}
            >
              <Download size={15} />
              Import from URL
            </button>
          ) : null}
        </div>
      )}

      <p className="video-note">
        Videos stay on your device and are never embedded in the workspace. Timestamps are saved.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = '';
          if (file) {
            setVideoError(false);
            setDuration(0);
            onFile(file);
          }
        }}
      />
    </section>
  );
}
