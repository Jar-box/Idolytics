import { ArrowUpRight, TriangleAlert } from 'lucide-react';
import {
  CANONICAL_DEV_ORIGIN,
  canonicalDevUrl,
  getStorageOrigin,
  isDevOriginMismatch,
} from '../lib/devOrigin';

export function DevOriginBanner() {
  if (!isDevOriginMismatch()) return null;

  return (
    <div className="origin-banner" role="alert">
      <TriangleAlert size={18} aria-hidden="true" />
      <div>
        <strong>This address has separate browser storage.</strong>
        <p>
          You opened <code>{getStorageOrigin()}</code>, but workspace data is pinned to{' '}
          <code>{CANONICAL_DEV_ORIGIN}</code>. Open the pinned URL to see your saved work.
        </p>
      </div>
      <div className="origin-banner-actions">
        <a className="btn btn-ghost btn-small" href={canonicalDevUrl()}>
          Open pinned URL
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
