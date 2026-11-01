import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Link2, LoaderCircle } from 'lucide-react';
import type { Song } from '../../domain/schema';
import { ClockInput } from '../../components/ClockInput';
import { Modal } from '../../components/Modal';
import { mediaErrorMessage, mediaLibrarySupported, probeMediaUrl } from '../../lib/mediaSync';
import { formatClock } from '../../lib/time';
import { useMediaStore } from '../../store/mediaStore';
import { useToastStore } from '../../store/toastStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

interface SongModalProps {
  open: boolean;
  groupId: string;
  song: Song | null;
  onClose: () => void;
  onCreated?: (songId: string) => void;
}

const TITLE_MAX_LENGTH = 80;
const SOURCE_URL_MAX_LENGTH = 2048;
const MAX_SONG_SECONDS = 12 * 60 * 60;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function cleanFetchedTitle(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  const characters = Array.from(collapsed);
  if (characters.length <= TITLE_MAX_LENGTH) return collapsed;
  return characters.slice(0, TITLE_MAX_LENGTH).join('').trim();
}

export function SongModal({ open, groupId, song, onClose, onCreated }: SongModalProps) {
  const createSong = useWorkspaceStore((state) => state.createSong);
  const updateSong = useWorkspaceStore((state) => state.updateSong);
  const pushToast = useToastStore((state) => state.push);
  const tools = useMediaStore((state) => state.tools);

  const lookupSupported = mediaLibrarySupported();
  const ytDlpMissing = tools !== null && !tools.ytDlp.available;

  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(180);
  const [sourceUrl, setSourceUrl] = useState('');
  const [probing, setProbing] = useState(false);
  const [probeNote, setProbeNote] = useState<string | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [suggestedDuration, setSuggestedDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const titleRef = useRef('');
  const durationRef = useRef(180);
  const probeControllerRef = useRef<AbortController | null>(null);
  const probeStartDurationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const nextTitle = song?.title ?? '';
    const nextDuration = song?.durationSec || 180;
    setTitle(nextTitle);
    setDuration(nextDuration);
    setSourceUrl(song?.sourceUrl ?? '');
    setError(null);
    setProbing(false);
    setProbeNote(null);
    setProbeError(null);
    setSuggestedDuration(null);
    titleRef.current = nextTitle;
    durationRef.current = nextDuration;
    probeStartDurationRef.current = null;
    probeControllerRef.current?.abort();
    probeControllerRef.current = null;
    return () => {
      probeControllerRef.current?.abort();
      probeControllerRef.current = null;
      probeStartDurationRef.current = null;
    };
  }, [open, song]);

  const handleTitleChange = (value: string) => {
    titleRef.current = value;
    setTitle(value);
  };

  const handleDurationChange = (value: number) => {
    durationRef.current = value;
    setDuration(value);
    setSuggestedDuration(null);
  };

  const resetProbe = () => {
    if (probeControllerRef.current) {
      probeControllerRef.current.abort();
      probeControllerRef.current = null;
    }
    probeStartDurationRef.current = null;
    setProbing(false);
    setProbeNote(null);
    setProbeError(null);
    setSuggestedDuration(null);
  };

  const handleSourceUrlChange = (value: string) => {
    setSourceUrl(value);
    resetProbe();
  };

  const runProbe = async (value?: string) => {
    const target = (value ?? sourceUrl).trim();
    if (!lookupSupported) return;
    if (!target) {
      setProbeError('Paste a song link first.');
      return;
    }
    if (!isHttpUrl(target)) {
      setProbeError('That does not look like a valid link.');
      return;
    }
    if (ytDlpMissing) {
      setProbeError(
        'Length lookup needs yt-dlp. Install it or set IDOLYTICS_YTDLP_PATH, then restart the dev server.',
      );
      return;
    }

    probeControllerRef.current?.abort();
    const controller = new AbortController();
    probeControllerRef.current = controller;
    const durationBeforeProbe = durationRef.current;
    probeStartDurationRef.current = durationBeforeProbe;
    setProbing(true);
    setProbeNote(null);
    setProbeError(null);
    setSuggestedDuration(null);

    try {
      const result = await probeMediaUrl(target, { signal: controller.signal });
      if (controller.signal.aborted || probeControllerRef.current !== controller) return;

      const titleWasEmpty = titleRef.current.trim().length === 0;
      const fetchedTitle = result.title ? cleanFetchedTitle(result.title) : '';
      if (titleWasEmpty && fetchedTitle) {
        titleRef.current = fetchedTitle;
        setTitle(fetchedTitle);
      }

      let lengthApplied = false;
      if (durationRef.current === durationBeforeProbe) {
        durationRef.current = result.durationSec;
        setDuration(result.durationSec);
        lengthApplied = true;
      } else {
        setSuggestedDuration(result.durationSec);
      }

      const filledTitle = titleWasEmpty && fetchedTitle.length > 0;
      const lengthLabel = formatClock(result.durationSec, true);
      setProbeNote(
        lengthApplied
          ? filledTitle
            ? `Title and length read from the link (${lengthLabel}).`
            : `Length read from the link: ${lengthLabel}.`
          : filledTitle
            ? 'Title read from the link. Your length was kept.'
            : 'Your length was kept.',
      );
    } catch (caught) {
      if (controller.signal.aborted) return;
      setProbeError(
        mediaErrorMessage(caught, 'That link could not be read. Enter the length manually.'),
      );
    } finally {
      if (probeControllerRef.current === controller) {
        probeControllerRef.current = null;
        probeStartDurationRef.current = null;
        setProbing(false);
      }
    }
  };

  const handleLinkPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').trim();
    if (!isHttpUrl(pasted)) return;
    event.preventDefault();
    handleSourceUrlChange(pasted);
    void runProbe(pasted);
  };

  const handleLinkKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void runProbe();
  };

  const applySuggestedDuration = () => {
    if (suggestedDuration === null) return;
    durationRef.current = suggestedDuration;
    setDuration(suggestedDuration);
    setProbeNote(`Length set to ${formatClock(suggestedDuration, true)}.`);
    setSuggestedDuration(null);
  };

  const submitBlockedByProbe =
    probing &&
    probeStartDurationRef.current !== null &&
    durationRef.current === probeStartDurationRef.current;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const waitingForLink =
      probeControllerRef.current !== null &&
      probeStartDurationRef.current !== null &&
      durationRef.current === probeStartDurationRef.current;
    if (waitingForLink) {
      setError('Wait for the link lookup to finish, or enter the length manually.');
      return;
    }
    const trimmed = titleRef.current.trim();
    if (!trimmed) {
      setError('Give this song a title.');
      return;
    }
    const nextDuration = durationRef.current;
    if (nextDuration <= 0) {
      setError('Set a song length greater than zero.');
      return;
    }
    if (nextDuration > MAX_SONG_SECONDS) {
      setError('Song length must be 12 hours or less.');
      return;
    }
    const link = sourceUrl.trim();
    if (link && !isHttpUrl(link)) {
      setError('That song link does not look like a valid URL.');
      return;
    }
    const nextSourceUrl = link || null;
    if (song) {
      updateSong(groupId, song.id, {
        title: trimmed,
        durationSec: nextDuration,
        sourceUrl: nextSourceUrl,
      });
      pushToast('Song updated.', 'success');
      onClose();
      return;
    }
    const id = createSong(groupId, trimmed, nextDuration, nextSourceUrl);
    if (!id) {
      setError('Could not create this song.');
      return;
    }
    pushToast('Song created.', 'success');
    onClose();
    onCreated?.(id);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={song ? 'Edit song' : 'Add song'}
      eyebrow={song ? 'Song details' : 'New track'}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="song-form"
            className="btn btn-primary"
            disabled={submitBlockedByProbe}
          >
            {submitBlockedByProbe
              ? 'Reading link…'
              : song
                ? 'Save changes'
                : 'Add song'}
          </button>
        </>
      }
    >
      <form id="song-form" onSubmit={handleSubmit} className="stack-form">
        {lookupSupported ? (
          <label className="field song-link-field">
            <span className="field-label">
              Song link <span className="field-optional">optional</span>
            </span>
            <span className="song-link-row">
              <input
                className="input"
                type="url"
                inputMode="url"
                value={sourceUrl}
                onChange={(event) => handleSourceUrlChange(event.target.value)}
                onPaste={handleLinkPaste}
                onKeyDown={handleLinkKeyDown}
                placeholder="https://www.youtube.com/watch?v=…"
                autoComplete="off"
                spellCheck={false}
                maxLength={SOURCE_URL_MAX_LENGTH}
              />
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => void runProbe()}
                disabled={probing || !sourceUrl.trim() || ytDlpMissing}
                title="Read the song length from this link"
              >
                {probing ? (
                  <LoaderCircle className="is-spinning" size={14} />
                ) : (
                  <Link2 size={14} />
                )}
                {probing ? 'Reading…' : 'Fetch length'}
              </button>
            </span>
            <span className="field-hint">
              Paste a YouTube or other supported link to fill the length. The link is saved for
              the audio import.
            </span>
            <span className="song-link-status" role="status" aria-live="polite">
              {probeError ? (
                <span className="field-error">{probeError}</span>
              ) : probeNote ? (
                <span className="field-hint">{probeNote}</span>
              ) : probing ? (
                <span className="field-hint">Reading the link…</span>
              ) : null}
            </span>
            {suggestedDuration !== null ? (
              <span className="field-hint">
                The link reports {formatClock(suggestedDuration, true)}.{' '}
                <button
                  type="button"
                  className="inline-action"
                  onClick={applySuggestedDuration}
                >
                  Use it
                </button>
              </span>
            ) : null}
            {ytDlpMissing ? (
              <span className="field-hint">
                Length lookup needs yt-dlp. Install it or set IDOLYTICS_YTDLP_PATH, then restart
                the dev server.
              </span>
            ) : null}
          </label>
        ) : null}
        <label className="field">
          <span className="field-label">Song title</span>
          <input
            className="input"
            data-autofocus
            value={title}
            onChange={(event) => handleTitleChange(event.target.value)}
            placeholder="e.g. Supernova"
            maxLength={TITLE_MAX_LENGTH}
            autoComplete="off"
          />
        </label>
        <ClockInput
          label="Song length"
          value={duration}
          onChange={handleDurationChange}
          hint="Used to plan section timestamps. You can change it later."
        />
        <p className="form-note">
          Link the song audio in the Line distribution tab and the dance practice video in the
          Choreo editor. A saved song link prefills the audio import. Media files stay on your
          device and are never embedded in the workspace file.
        </p>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Modal>
  );
}
