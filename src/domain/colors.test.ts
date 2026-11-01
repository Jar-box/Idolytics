import { describe, expect, it } from 'vitest';
import { assignRandomMemberColors, randomUnusedMemberColor } from './colors';
import { memberColorPalette } from './schema';

const first = () => 0;
const member = (id: string, color: string) => ({ id, color });

describe('randomUnusedMemberColor', () => {
  it('picks a palette color when the group is empty', () => {
    expect(randomUnusedMemberColor([], { random: first })).toBe(memberColorPalette[0]);
  });

  it('skips colors already used by group members', () => {
    const members = [member('a', memberColorPalette[0]), member('b', memberColorPalette[1])];
    expect(randomUnusedMemberColor(members, { random: first })).toBe(memberColorPalette[2]);
  });

  it('ignores the edited member when excluding their own color', () => {
    const members = [member('a', memberColorPalette[0]), member('b', memberColorPalette[1])];
    expect(
      randomUnusedMemberColor(members, { excludeMemberId: 'a', random: first }),
    ).toBe(memberColorPalette[0]);
  });

  it('matches used colors case-insensitively', () => {
    const members = [member('a', memberColorPalette[0].toUpperCase())];
    expect(randomUnusedMemberColor(members, { random: first })).toBe(memberColorPalette[1]);
  });

  it('ignores custom colors outside the palette', () => {
    const members = [member('a', '#123456')];
    expect(randomUnusedMemberColor(members, { random: first })).toBe(memberColorPalette[0]);
  });

  it('falls back to a least-used color when every palette color is taken', () => {
    const members = memberColorPalette.map((color, index) => member(`m${index}`, color));
    expect(randomUnusedMemberColor(members, { random: first })).toBe(memberColorPalette[0]);
  });

  it('only reuses colors that have the lowest usage count', () => {
    const members = [
      ...memberColorPalette.map((color, index) => member(`m${index}`, color)),
      member('extra-a', memberColorPalette[0]),
      member('extra-b', memberColorPalette[1]),
    ];
    expect(randomUnusedMemberColor(members, { random: first })).toBe(memberColorPalette[2]);
  });

  it('clamps a random value of 1 to the final candidate', () => {
    const members = memberColorPalette
      .slice(0, memberColorPalette.length - 1)
      .map((color, index) => member(`m${index}`, color));
    expect(randomUnusedMemberColor(members, { random: () => 1 })).toBe(
      memberColorPalette[memberColorPalette.length - 1],
    );
  });
});

describe('assignRandomMemberColors', () => {
  it('returns an empty list for a non-positive count', () => {
    expect(assignRandomMemberColors([], 0)).toEqual([]);
    expect(assignRandomMemberColors([], -2)).toEqual([]);
  });

  it('assigns every palette color without duplicates up to the palette size', () => {
    const colors = assignRandomMemberColors([], memberColorPalette.length, first);
    expect(colors).toEqual([...memberColorPalette]);
    expect(new Set(colors).size).toBe(memberColorPalette.length);
  });

  it('avoids colors already used in the group', () => {
    const members = [member('a', memberColorPalette[0]), member('b', memberColorPalette[1])];
    const colors = assignRandomMemberColors(members, 3, first);
    expect(colors).toEqual(memberColorPalette.slice(2, 5));
  });

  it('spreads reuse across the least-used colors after the palette is exhausted', () => {
    const members = memberColorPalette.map((color, index) => member(`m${index}`, color));
    const colors = assignRandomMemberColors(members, 3, first);
    expect(colors).toEqual(memberColorPalette.slice(0, 3));
    expect(new Set(colors).size).toBe(3);
  });
});
