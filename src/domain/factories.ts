import {
  DEFAULT_GRID,
  memberColorPalette,
  type Formation,
  type Group,
  type LineKind,
  type Member,
  type Section,
  type Song,
  type VocalLine,
} from './schema';
import { newId } from '../lib/id';

export function createGroup(name: string): Group {
  return { id: newId('grp'), name, members: [], songs: [] };
}

export function createMember(name: string, colorIndex = 0): Member {
  return {
    id: newId('mem'),
    name,
    face: null,
    color: memberColorPalette[colorIndex % memberColorPalette.length],
  };
}

export function createSong(
  title: string,
  durationSec: number,
  sourceUrl: string | null = null,
): Song {
  return {
    id: newId('sng'),
    title,
    durationSec,
    videoFileName: null,
    audioFileName: null,
    sourceUrl,
    grid: { ...DEFAULT_GRID },
    sections: [],
    lines: [],
  };
}

export function createSection(label: string, startSec: number, endSec: number): Section {
  return {
    id: newId('sec'),
    label,
    startSec,
    endSec,
    formations: [],
  };
}

export function createFormation(startSec: number, endSec: number): Formation {
  return {
    id: newId('frm'),
    startSec,
    endSec,
    anchors: [],
    placements: [],
  };
}

export function createLine(
  startSec: number,
  endSec: number,
  memberIds: string[],
  kind: LineKind = 'sung',
  lyric?: string,
  note?: string,
): VocalLine {
  const line: VocalLine = {
    id: newId('lin'),
    startSec,
    endSec,
    memberIds: [...memberIds],
    kind,
  };
  if (lyric) line.lyric = lyric;
  if (note) line.note = note;
  return line;
}
