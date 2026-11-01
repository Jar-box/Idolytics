import { describe, expect, it } from 'vitest';
import { createGroup, createSong } from '../domain/factories';
import { createEmptyWorkspace } from '../domain/schema';
import { parseWorkspaceValue } from './persistence';

function workspaceWithGroup() {
  const workspace = createEmptyWorkspace();
  const group = createGroup('A2O Lite');
  group.songs.push(createSong('Neon', 208));
  workspace.groups.push(group);
  return workspace;
}

describe('parseWorkspaceValue', () => {
  it('accepts a valid workspace value', () => {
    const result = parseWorkspaceValue(workspaceWithGroup());

    expect(result.ok).toBe(true);
    expect(result.workspace?.groups[0]?.name).toBe('A2O Lite');
    expect(result.workspace?.groups[0]?.songs[0]?.title).toBe('Neon');
  });

  it('rejects values outside the workspace schema', () => {
    const result = parseWorkspaceValue({ format: 'something-else' });

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects inconsistent workspaces', () => {
    const workspace = workspaceWithGroup();
    workspace.groups.push(structuredClone(workspace.groups[0]));

    const result = parseWorkspaceValue(workspace);

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('duplicate id');
  });
});
