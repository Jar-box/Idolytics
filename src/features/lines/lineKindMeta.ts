import {
  CircleDot,
  MicAudioLines,
  MicVocal,
  Sparkles,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { LINE_KINDS, type LineKind } from '../../domain/schema';

export interface LineKindMeta {
  label: string;
  countLabel: string;
  className: string;
  icon: LucideIcon;
  color: string;
  // Whether this kind gets the marker (dot + icon + top strip) on its
  // dist-segment. Kinds without a marker render as a plain segment.
  marked: boolean;
}

// Presentation-only palette for category markers. Saturated accents that
// stay distinct from the pastel member-color palette. Adding a new category
// only requires one entry here (plus LINE_KINDS in schema) — no CSS changes.
export const lineKindColorFallback = '#94a3b8';

export const lineKindMeta: Record<LineKind, LineKindMeta> = {
  sung: {
    label: 'Line',
    countLabel: 'line',
    className: 'is-sung',
    icon: MicVocal,
    color: '#6f55b8',
    marked: false,
  },
  adlib: {
    label: 'Ad-lib',
    countLabel: 'ad-lib',
    className: 'is-adlib',
    icon: Sparkles,
    color: '#986224',
    marked: false,
  },
  rap: {
    label: 'Rap',
    countLabel: 'rap',
    className: 'is-rap',
    icon: MicAudioLines,
    color: '#2f7d63',
    marked: true,
  },
  highnote: {
    label: 'High note',
    countLabel: 'high note',
    className: 'is-highnote',
    icon: Star,
    color: '#b24d78',
    marked: true,
  },
};

export const lineKindIconFallback: LucideIcon = CircleDot;

export function getLineKindMeta(kind: string): LineKindMeta {
  return (lineKindMeta as Record<string, LineKindMeta>)[kind] ?? {
    label: kind || 'Part',
    countLabel: 'part',
    className: '',
    icon: lineKindIconFallback,
    color: lineKindColorFallback,
    marked: false,
  };
}

export const lineKindOptions = LINE_KINDS.map((kind) => ({
  kind,
  ...lineKindMeta[kind],
}));

export function formatKindCount(kind: LineKind, count: number): string {
  const { countLabel } = lineKindMeta[kind];
  return `${count} ${countLabel}${count === 1 ? '' : 's'}`;
}
