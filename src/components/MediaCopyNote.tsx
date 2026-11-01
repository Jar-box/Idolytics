import {
  CircleCheck,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import type { MediaCopyState } from '../lib/mediaTypes';

interface MediaCopyNoteProps {
  state: MediaCopyState | null;
  onRetry?: () => void;
}

export function MediaCopyNote({ state, onRetry }: MediaCopyNoteProps) {
  if (!state || state.status === 'idle') return null;
  const progress = Math.round(Math.max(0, Math.min(1, state.progress)) * 100);

  if (state.status === 'copying') {
    return (
      <div className="media-copy-note is-copying" role="status" aria-live="polite">
        <span className="media-copy-icon">
          <LoaderCircle className="is-spinning" size={15} />
        </span>
        <div className="media-copy-body">
          <p>{state.message ?? 'Copying into the project media library…'}</p>
          <div
            className="media-copy-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-label="Media copy progress"
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
        <span className="media-copy-progress-label mono">{progress}%</span>
      </div>
    );
  }

  if (state.status === 'done') {
    return (
      <div className="media-copy-note is-done" role="status">
        <span className="media-copy-icon">
          <CircleCheck size={15} />
        </span>
        <div className="media-copy-body">
          <p>{state.message ?? 'Copied into the project media library.'}</p>
          {state.destination ? (
            <span className="media-copy-destination mono" title={state.destination}>
              {state.destination}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  const isProblem = state.status === 'error' || state.status === 'unavailable';
  return (
    <div
      className={`media-copy-note is-${state.status}`}
      role={isProblem ? 'alert' : 'status'}
    >
      <span className="media-copy-icon">
        {isProblem ? <TriangleAlert size={15} /> : <HardDrive size={15} />}
      </span>
      <div className="media-copy-body">
        <p>
          {state.message ??
            (state.status === 'off'
              ? 'Auto-copy is off. This file will need to be linked again next session.'
              : 'The media library is unavailable. This file stays linked for this session.')}
        </p>
      </div>
      {isProblem && onRetry ? (
        <button type="button" className="btn btn-ghost btn-small" onClick={onRetry}>
          <RefreshCw size={12} />
          Retry copy
        </button>
      ) : null}
    </div>
  );
}
