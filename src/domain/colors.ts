import { memberColorPalette, type Member } from './schema';

type ColorMember = Pick<Member, 'id' | 'color'>;

const PALETTE: readonly string[] = memberColorPalette.map((color) => color.toLowerCase());

function colorUsage(members: readonly ColorMember[], excludeMemberId?: string): Map<string, number> {
  const usage = new Map<string, number>();
  for (const member of members) {
    if (member.id === excludeMemberId) continue;
    const color = member.color.toLowerCase();
    usage.set(color, (usage.get(color) ?? 0) + 1);
  }
  return usage;
}

function pickIndex(length: number, random: () => number): number {
  const index = Math.floor(random() * length);
  return Math.max(0, Math.min(length - 1, index));
}

function choosePaletteColor(usage: Map<string, number>, random: () => number): string {
  const available = PALETTE.filter((color) => !usage.has(color));
  if (available.length > 0) {
    return available[pickIndex(available.length, random)];
  }

  const minimum = Math.min(...PALETTE.map((color) => usage.get(color) ?? 0));
  const leastUsed = PALETTE.filter((color) => (usage.get(color) ?? 0) === minimum);
  return leastUsed[pickIndex(leastUsed.length, random)];
}

export function randomUnusedMemberColor(
  members: readonly ColorMember[],
  options: { excludeMemberId?: string; random?: () => number } = {},
): string {
  const { excludeMemberId, random = Math.random } = options;
  return choosePaletteColor(colorUsage(members, excludeMemberId), random);
}

export function assignRandomMemberColors(
  members: readonly ColorMember[],
  count: number,
  random: () => number = Math.random,
): string[] {
  if (count <= 0) return [];

  const usage = colorUsage(members);
  const colors: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const color = choosePaletteColor(usage, random);
    usage.set(color, (usage.get(color) ?? 0) + 1);
    colors.push(color);
  }
  return colors;
}
