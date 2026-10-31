import type { Workspace } from './schema';

/**
 * The original neon palette mapped onto its pastel equivalent. Keeping this
 * map stable lets workspaces created before the pastel refresh pick up the new
 * look without losing the identity each color represented.
 */
const legacyMemberColorMap: Record<string, string> = {
  '#d7ff3f': '#b9a7e8',
  '#ff4d9d': '#f2a7c3',
  '#6de3ff': '#9ccfe8',
  '#ffb454': '#f2c49a',
  '#b78cff': '#c7b3f2',
  '#5cffb1': '#9edcc4',
  '#ff7a6b': '#f0a6a0',
  '#f0e6c8': '#e5cf9c',
  '#8fa3ff': '#aab5ec',
  '#ff9ef0': '#e8b3e2',
};

export function migrateLegacyMemberColors(workspace: Workspace): Workspace {
  let changed = false;

  const groups = workspace.groups.map((group) => {
    let groupChanged = false;
    const members = group.members.map((member) => {
      const mapped = legacyMemberColorMap[member.color.toLowerCase()];
      if (!mapped || mapped === member.color) return member;
      groupChanged = true;
      return { ...member, color: mapped };
    });

    if (!groupChanged) return group;
    changed = true;
    return { ...group, members };
  });

  return changed ? { ...workspace, groups } : workspace;
}
