import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { Download, HardDrive, Link2, LoaderCircle, Music2, Pause, Play } from 'lucide-react';
import { MediaCopyNote } from '../../components/MediaCopyNote';
import type { MediaCopyState, MediaSource } from '../../lib/mediaTypes';
import { clamp, formatClock } from '../../lib/time';

interface AudioPanelProps {
  fileName: string | null;
  audioUrl: string | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  currentTime: number;
  initialTime?: number;
  songDuration: number;
  mediaResolving?: boolean;
  mediaSource?: MediaSource | null;
  copyState?: MediaCopyState | null;
  onTimeUpdate: (time: number) => void;
  onFile: (file: File) => void;
  onUseTrackDuration: (duration: number) => void;
  onRetryCopy?: () => void;
  onImportUrl?: () => void;
}

const speeds = [0.5, 0.75, 1, 1.25, 1.5];

export function AudioPanel({
  fileName,
  audioUrl,
  audioRef,
  currentTime,
  initialTime = 0,
  songDuration,
  mediaResolving = false,
  mediaSource = null,
  copyState = null,
  onTimeUpdate,
  onFile,
  onUseTrackDuration,
  onRetryCopy,
  onImportUrl,
}: AudioPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rate, setRate] = useState(1);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioError, setAudioError] = useState(false);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, audioRef, audioUrl]);

  useEffect(() => {
    setDuration(0);
    setPlaying(false);
    setAudioError(false);
  }, [audioUrl]);

  useEffect(() => {
    if (!playing || !audioUrl) return;
    let rafId = 0;
    const tick = () => {
      const el = audioRef.current;
      if (el) onTimeUpdate(el.currentTime);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, audioUrl, audioRef, onTimeUpdate]);

  const safeCurrent = duration > 0 ? clamp(currentTime, 0, duration) : 0;
  const progress = duration > 0 ? (safeCurrent / duration) * 100 : 0;
  const scrubStyle = { '--audio-progress': `${progress}%` } as CSSProperties;
  const lengthMismatch =
    duration > 0 && songDuration > 0 && Math.abs(duration - songDuration) >= 1;

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setAudioError(true);
      }
    } else {
      audio.pause();
    }
  }, [audioRef]);

  useEffect(() => {
    if (!audioUrl) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSpace = event.code === 'Space' || event.key === ' ';
      if (
        !isSpace ||
        event.repeat ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.defaultPrevented
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      void togglePlayback();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [audioUrl, togglePlayback]);

  const nudge = (delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const max = Number.isFinite(audio.duration) ? audio.duration : duration;
    const next = clamp(audio.currentTime + delta, 0, max || 0);
    audio.currentTime = next;
    onTimeUpdate(next);
  };

  const handleScrub = (value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const max = Number.isFinite(audio.duration) ? audio.duration : duration;
    const next = clamp(value, 0, max || 0);
    audio.currentTime = next;
    onTimeUpdate(next);
  };

  return (
    <section className="panel audio-panel">
      <header className="panel-header audio-panel-header">
        <div>
          <p className="eyebrow">Reference track</p>
          <h2>Song audio</h2>
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
            {audioUrl ? 'Relink' : 'Link audio'}
          </button>
        </div>
      </header>

      {audioUrl ? (
        <>
          <div className="audio-deck">
            <div className="audio-art" aria-hidden="true">
              <Music2 size={25} />
            </div>
            <div className="audio-deck-copy">
              <span className="field-label">Linked track</span>
              <span className="audio-file-name" title={fileName ?? undefined}>
                {fileName ?? 'Song audio'}
              </span>
              <span className="audio-deck-meta mono">
                {playing ? 'Playing' : 'Ready'} · {rate}×
              </span>
            </div>
            <span
              className={`audio-bars ${playing ? 'is-playing' : ''}`}
              aria-hidden="true"
            >
              <span />
              <span />
              <span />
              <span />
            </span>
          </div>

          <div className="audio-player">
            <input
              className="audio-scrub"
              type="range"
              min={0}
              max={duration || 0}
              step={0.01}
              value={safeCurrent}
              onChange={(event) => handleScrub(Number(event.target.value))}
              style={scrubStyle}
              aria-label="Seek song audio"
              disabled={duration <= 0}
            />
            <div className="audio-time-row mono">
              <span>{formatClock(safeCurrent, true)}</span>
              <span>{formatClock(duration, true)}</span>
            </div>

            <div className="audio-controls">
              <button
                type="button"
                className="audio-skip"
                onClick={() => nudge(-5)}
                title="Back 5 seconds"
                aria-label="Back 5 seconds"
              >
                −5s
              </button>
              <button
                type="button"
                className="audio-play"
                onClick={() => void togglePlayback()}
                title={playing ? 'Pause song audio (Space)' : 'Play song audio (Space)'}
                aria-label={playing ? 'Pause song audio' : 'Play song audio'}
                aria-keyshortcuts="Space"
              >
                {playing ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <button
                type="button"
                className="audio-skip"
                onClick={() => nudge(5)}
                title="Forward 5 seconds"
                aria-label="Forward 5 seconds"
              >
                +5s
              </button>
              <label className="audio-speed">
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

            {lengthMismatch ? (
              <div className="audio-length-note">
                <span>
                  Track {formatClock(duration)} · timeline {formatClock(songDuration)}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => onUseTrackDuration(duration)}
                >
                  Use track length
                </button>
              </div>
            ) : null}

            {audioError ? (
              <p className="audio-note is-warning">
                This browser could not play the selected file. Try an MP3, M4A, WAV, or OGG file.
              </p>
            ) : null}
          </div>
          <MediaCopyNote state={copyState} onRetry={onRetryCopy} />
        </>
      ) : fileName && mediaResolving ? (
        <div className="audio-empty">
          <div className="audio-empty-icon">
            <LoaderCircle className="is-spinning" size={24} />
          </div>
          <h3>Restoring from the media library</h3>
          <p>Looking for the saved copy of “{fileName}” in the project media folder.</p>
        </div>
      ) : (
        <div className="audio-empty">
          <div className="audio-empty-icon">
            <Music2 size={26} />
          </div>
          <h3>{fileName ? 'Relink your audio' : 'Link the song audio'}</h3>
          <p>
            {fileName
              ? `Last session used "${fileName}". Audio files stay on your device, so choose it again.`
              : 'Choose a local audio file to scrub through the track while you log vocal lines.'}
          </p>
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => fileInputRef.current?.click()}
          >
            <Music2 size={15} />
            {fileName ? 'Re-link audio file' : 'Choose audio file'}
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

      <p className="audio-note">
        Press Space to play or pause. Audio stays on your device and is never embedded in the
        workspace. Timestamps are saved.
      </p>

      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        preload="metadata"
        onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
        onSeeked={(event) => onTimeUpdate(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(event) => {
          setPlaying(false);
          if (Number.isFinite(event.currentTarget.duration)) {
            onTimeUpdate(event.currentTarget.duration);
          }
        }}
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          if (Number.isFinite(nextDuration)) setDuration(nextDuration);
          event.currentTarget.playbackRate = rate;
          if (!Number.isFinite(initialTime)) return;
          const max = Number.isFinite(nextDuration) ? nextDuration : initialTime;
          const target = clamp(initialTime, 0, max);
          if (target > 0.05) {
            try {
              event.currentTarget.currentTime = target;
              onTimeUpdate(target);
            } catch {
              // Ignore a seek that arrives before the browser is ready.
            }
          }
        }}
        onError={() => {
          setAudioError(true);
          setPlaying(false);
        }}
        hidden
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = '';
          if (file) {
            setAudioError(false);
            setDuration(0);
            onFile(file);
          }
        }}
      />
    </section>
  );
}
