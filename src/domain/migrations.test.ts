import { describe, expect, it } from 'vitest';
import { createEmptyWorkspace, memberColorPalette } from './schema';
import { migrateLegacyMemberColors } from './migrations';

describe('migrateLegacyMemberColors', () => {
  it('maps the original neon palette onto the pastel palette', () => {
    const workspace = createEmptyWorkspace();
    workspace.groups.push({
      id: 'grp-1',
      name: 'Legacy',
      members: [
        { id: 'mem-1', name: 'One', face: null, color: '#d7ff3f' },
        { id: 'mem-2', name: 'Two', face: null, color: '#FF4D9D' },
      ],
      songs: [],
    });

    const migrated = migrateLegacyMemberColors(workspace);

    expect(migrated.groups[0].members[0].color).toBe(memberColorPalette[0]);
    expect(migrated.groups[0].members[1].color).toBe(memberColorPalette[1]);
  });

  it('leaves unknown custom colors untouched and avoids cloning clean data', () => {
    const workspace = createEmptyWorkspace();
    workspace.groups.push({
      id: 'grp-1',
      name: 'Custom',
      members: [{ id: 'mem-1', name: 'One', face: null, color: '#123abc' }],
      songs: [],
    });

    expect(migrateLegacyMemberColors(workspace)).toBe(workspace);
  });
});
