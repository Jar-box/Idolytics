import {
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
}

export const lineKindMeta: Record<LineKind, LineKindMeta> = {
  sung: {
    label: 'Line',
    countLabel: 'line',
    className: 'is-sung',
    icon: MicVocal,
  },
  adlib: {
    label: 'Ad-lib',
    countLabel: 'ad-lib',
    className: 'is-adlib',
    icon: Sparkles,
  },
  rap: {
    label: 'Rap',
    countLabel: 'rap',
    className: 'is-rap',
    icon: MicAudioLines,
  },
  highnote: {
    label: 'High note',
    countLabel: 'high note',
    className: 'is-highnote',
    icon: Star,
  },
};

export const lineKindOptions = LINE_KINDS.map((kind) => ({
  kind,
  ...lineKindMeta[kind],
}));

export function formatKindCount(kind: LineKind, count: number): string {
  const { countLabel } = lineKindMeta[kind];
  return `${count} ${countLabel}${count === 1 ? '' : 's'}`;
}
