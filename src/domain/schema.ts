import { z } from 'zod';

export const WORKSPACE_FORMAT = 'idolytics' as const;
export const WORKSPACE_VERSION = 1 as const;

export const memberColorPalette = [
  '#b9a7e8',
  '#f2a7c3',
  '#9ccfe8',
  '#f2c49a',
  '#c7b3f2',
  '#9edcc4',
  '#f0a6a0',
  '#e5cf9c',
  '#aab5ec',
  '#e8b3e2',
] as const;

const idSchema = z.string().min(1).max(120);
const labelSchema = z.string().max(80);

export const postureSchema = z.object({
  id: idSchema,
  label: labelSchema,
  height: z.number().int().min(0).max(20),
});

export const memberSchema = z.object({
  id: idSchema,
  name: labelSchema,
  face: z.string().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const placementSchema = z.object({
  memberId: idSchema,
  col: z.number().int().min(0).max(40),
  row: z.number().int().min(0).max(20),
  postureId: idSchema,
});

export const formationSchema = z.object({
  id: idSchema,
  startSec: z.number().min(0).max(60 * 60 * 12),
  endSec: z.number().min(0).max(60 * 60 * 12),
  anchors: z.array(idSchema).max(60),
  placements: z.array(placementSchema).max(60),
});

export const sectionSchema = z.object({
  id: idSchema,
  label: labelSchema,
  startSec: z.number().min(0).max(60 * 60 * 12),
  endSec: z.number().min(0).max(60 * 60 * 12),
  formations: z.array(formationSchema).max(200),
});

export const lineKindSchema = z.enum(['sung', 'adlib']);

export const vocalLineSchema = z.object({
  id: idSchema,
  startSec: z.number().min(0).max(60 * 60 * 12),
  endSec: z.number().min(0).max(60 * 60 * 12),
  memberIds: z.array(idSchema).min(1).max(60),
  kind: lineKindSchema,
  lyric: z.string().max(300).optional(),
  note: z.string().max(300).optional(),
});

export const gridSchema = z.object({
  cols: z.number().int().min(3).max(21),
  rows: z.number().int().min(1).max(9),
});

export const songSchema = z.object({
  id: idSchema,
  title: labelSchema,
  durationSec: z.number().min(0).max(60 * 60 * 12),
  videoFileName: z.string().nullable(),
  grid: gridSchema,
  sections: z.array(sectionSchema).max(100),
  lines: z.array(vocalLineSchema).max(4000).default([]),
});

export const groupSchema = z.object({
  id: idSchema,
  name: labelSchema,
  members: z.array(memberSchema).max(60),
  songs: z.array(songSchema).max(300),
});

export const workspaceSchema = z.object({
  format: z.literal(WORKSPACE_FORMAT),
  version: z.literal(WORKSPACE_VERSION),
  savedAt: z.string().optional(),
  settings: z.object({
    postures: z.array(postureSchema).min(1).max(20),
  }),
  groups: z.array(groupSchema).max(100),
});

export type Posture = z.infer<typeof postureSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type Formation = z.infer<typeof formationSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Grid = z.infer<typeof gridSchema>;
export type LineKind = z.infer<typeof lineKindSchema>;
export type VocalLine = z.infer<typeof vocalLineSchema>;
export type Song = z.infer<typeof songSchema>;
export type Group = z.infer<typeof groupSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;

export const defaultPostures: Posture[] = [
  { id: 'standing', label: 'Standing', height: 3 },
  { id: 'half', label: 'Half standing', height: 2 },
  { id: 'sitting', label: 'Sitting', height: 1 },
];

export const DEFAULT_GRID: Grid = { cols: 9, rows: 5 };

export function createEmptyWorkspace(): Workspace {
  return {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    settings: { postures: defaultPostures.map((posture) => ({ ...posture })) },
    groups: [],
  };
}
