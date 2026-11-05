import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import {
  Download,
  HardDrive,
  Link2,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { MediaCopyNote } from '../../components/MediaCopyNote';
import type { MediaCopyState, MediaSource } from '../../lib/mediaTypes';
import { clamp, formatClock, roundTime } from '../../lib/time';

const VOLUME_KEY = 'idolytics.audio.volume.v1';

function readVolume(): number {
  if (typeof window === 'undefined') return 1;
  try {
    const stored = window.localStorage.getItem(VOLUME_KEY);
    if (stored === null) return 1;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : 1;
  } catch {
    return 1;
  }
}

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
  const lastAudibleVolume = useRef(1);
  const [rate, setRate] = useState(1);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [volume, setVolume] = useState(readVolume);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, audioRef, audioUrl]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    try {
      window.localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }, [volume, audioRef, audioUrl]);

  const updateVolume = (next: number) => {
    const clamped = clamp(next, 0, 1);
    if (clamped > 0) lastAudibleVolume.current = clamped;
    setVolume(clamped);
  };

  const toggleMute = () => {
    updateVolume(volume > 0 ? 0 : lastAudibleVolume.current || 1);
  };

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

  const nudge = useCallback(
    (delta: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const max = Number.isFinite(audio.duration) ? audio.duration : duration;
      const next = roundTime(clamp(audio.currentTime + delta, 0, max || 0));
      audio.currentTime = next;
      onTimeUpdate(next);
    },
    [audioRef, duration, onTimeUpdate],
  );

  useEffect(() => {
    if (!audioUrl) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.defaultPrevented) return;
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

      const isSpace = event.code === 'Space' || event.key === ' ';
      if (isSpace) {
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        event.preventDefault();
        void togglePlayback();
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // Alt+Arrow is browser history navigation, so leave that combo alone.
        if (event.altKey) return;
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const step = event.ctrlKey || event.metaKey ? 0.01 : event.shiftKey ? 1 : 0.1;
        nudge(direction * step);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [audioUrl, togglePlayback, nudge]);

  const handleScrub = (value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const max = Number.isFinite(audio.duration) ? audio.duration : duration;
    const next = roundTime(clamp(value, 0, max || 0));
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
              step={0.001}
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
              <div className="audio-volume">
                <button
                  type="button"
                  className="audio-volume-toggle"
                  onClick={toggleMute}
                  title={volume > 0 ? 'Mute song audio' : 'Unmute song audio'}
                  aria-label={volume > 0 ? 'Mute song audio' : 'Unmute song audio'}
                  aria-pressed={volume === 0}
                >
                  {volume === 0 ? (
                    <VolumeX size={15} />
                  ) : volume < 0.5 ? (
                    <Volume1 size={15} />
                  ) : (
                    <Volume2 size={15} />
                  )}
                </button>
                <input
                  className="audio-volume-range"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(volume * 100)}
                  onChange={(event) => updateVolume(Number(event.target.value) / 100)}
                  style={
                    { '--audio-volume': `${Math.round(volume * 100)}%` } as CSSProperties
                  }
                  aria-label="Song audio volume"
                  aria-valuetext={`${Math.round(volume * 100)}%`}
                />
                <span className="audio-volume-readout" aria-hidden="true">
                  {Math.round(volume * 100)}%
                </span>
              </div>
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
        Press Space to play or pause · ← / → nudge 0.1s (Shift 1s, Ctrl/Cmd 0.01s). Audio stays
        on your device and is never embedded in the workspace. Timestamps are saved to the
        millisecond.
      </p>

      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        preload="metadata"
        onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
        onSeeked={(event) => onTimeUpdate(event.currentTarget.currentTime)}
        onPlay={(event) => {
          setPlaying(true);
          onTimeUpdate(event.currentTarget.currentTime);
        }}
        onPause={(event) => {
          setPlaying(false);
          // Capture the exact pause position instead of the last animation frame.
          onTimeUpdate(roundTime(event.currentTarget.currentTime));
        }}
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
          event.currentTarget.volume = volume;
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
