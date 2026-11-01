export const CANONICAL_DEV_ORIGIN = 'http://localhost:3000';

export function getStorageOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

export function isDevOriginMismatch(): boolean {
  if (!import.meta.env.DEV) return false;
  const origin = getStorageOrigin();
  return origin !== '' && origin !== CANONICAL_DEV_ORIGIN;
}

export function canonicalDevUrl(): string {
  if (typeof window === 'undefined') return CANONICAL_DEV_ORIGIN;
  const { pathname, search, hash } = window.location;
  return `${CANONICAL_DEV_ORIGIN}${pathname || '/'}${search}${hash}`;
}
