import { describe, expect, it } from 'vitest';
import { validateWorkspaceIntegrity } from './integrity';
import { createEmptyWorkspace, defaultPostures, type Workspace } from './schema';

function validWorkspace(): Workspace {
  return {
    format: 'idolytics',
    version: 1,
    settings: { postures: defaultPostures.map((posture) => ({ ...posture })) },
    groups: [
      {
        id: 'g1',
        name: 'Test',
        members: [
          { id: 'm1', name: 'One', face: null, color: '#d7ff3f' },
          { id: 'm2', name: 'Two', face: null, color: '#ff4d9d' },
        ],
        songs: [
          {
            id: 's1',
            title: 'Song',
            durationSec: 120,
            videoFileName: null,
            audioFileName: null,
            sourceUrl: null,
            grid: { cols: 9, rows: 5 },
            lines: [],
            sections: [
              {
                id: 'sec1',
                label: 'Verse',
                startSec: 0,
                endSec: 30,
                formations: [
                  {
                    id: 'f1',
                    startSec: 0,
                    endSec: 10,
                    anchors: ['m1'],
                    placements: [
                      { memberId: 'm1', col: 2, row: 0, postureId: 'standing' },
                      { memberId: 'm2', col: 3, row: 0, postureId: 'standing' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('validateWorkspaceIntegrity', () => {
  it('accepts a valid workspace', () => {
    expect(validateWorkspaceIntegrity(validWorkspace())).toEqual([]);
  });

  it('accepts an empty workspace', () => {
    expect(validateWorkspaceIntegrity(createEmptyWorkspace())).toEqual([]);
  });

  it('rejects overlapping formations', () => {
    const workspace = validWorkspace();
    const section = workspace.groups[0].songs[0].sections[0];
    section.formations.push({
      id: 'f2',
      startSec: 5,
      endSec: 15,
      anchors: [],
      placements: [],
    });
    expect(validateWorkspaceIntegrity(workspace).some((error) => error.includes('overlap'))).toBe(
      true,
    );
  });

  it('rejects out-of-bounds placements', () => {
    const workspace = validWorkspace();
    workspace.groups[0].songs[0].sections[0].formations[0].placements[0].col = 9;
    expect(
      validateWorkspaceIntegrity(workspace).some((error) => error.includes('outside the grid')),
    ).toBe(true);
  });

  it('rejects duplicate cells', () => {
    const workspace = validWorkspace();
    workspace.groups[0].songs[0].sections[0].formations[0].placements[1].col = 2;
    workspace.groups[0].songs[0].sections[0].formations[0].placements[1].row = 0;
    expect(
      validateWorkspaceIntegrity(workspace).some((error) => error.includes('multiple members')),
    ).toBe(true);
  });

  it('rejects anchors that are not placed', () => {
    const workspace = validWorkspace();
    workspace.groups[0].songs[0].sections[0].formations[0].anchors.push('m2');
    workspace.groups[0].songs[0].sections[0].formations[0].placements.pop();
    expect(
      validateWorkspaceIntegrity(workspace).some((error) => error.includes('not placed')),
    ).toBe(true);
  });

  it('rejects unknown postures', () => {
    const workspace = validWorkspace();
    workspace.groups[0].songs[0].sections[0].formations[0].placements[0].postureId = 'flying';
    expect(
      validateWorkspaceIntegrity(workspace).some((error) => error.includes('unknown posture')),
    ).toBe(true);
  });

  it('rejects duplicate global ids', () => {
    const workspace = validWorkspace();
    workspace.groups[0].members[1].id = 'm1';
    expect(
      validateWorkspaceIntegrity(workspace).some((error) => error.includes('duplicate id')),
    ).toBe(true);
  });

  it('accepts valid and overlapping vocal lines', () => {
    const workspace = validWorkspace();
    workspace.groups[0].songs[0].lines.push(
      {
        id: 'l1',
        startSec: 0,
        endSec: 10,
        memberIds: ['m1', 'm2'],
        kind: 'sung',
        lyric: 'Shared opening',
      },
      {
        id: 'l2',
        startSec: 5,
        endSec: 12,
        memberIds: ['m2'],
        kind: 'adlib',
        note: 'Harmony',
      },
    );
    expect(validateWorkspaceIntegrity(workspace)).toEqual([]);
  });

  it('rejects unknown members on a vocal line', () => {
    const workspace = validWorkspace();
    workspace.groups[0].songs[0].lines.push({
      id: 'l1',
      startSec: 0,
      endSec: 10,
      memberIds: ['missing'],
      kind: 'sung',
    });
    expect(
      validateWorkspaceIntegrity(workspace).some((error) => error.includes('unknown member')),
    ).toBe(true);
  });

  it('rejects duplicate members on a vocal line', () => {
    const workspace = validWorkspace();
    workspace.groups[0].songs[0].lines.push({
      id: 'l1',
      startSec: 0,
      endSec: 10,
      memberIds: ['m1', 'm1'],
      kind: 'sung',
    });
    expect(
      validateWorkspaceIntegrity(workspace).some((error) => error.includes('listed twice')),
    ).toBe(true);
  });

  it('rejects invalid vocal line times', () => {
    const workspace = validWorkspace();
    workspace.groups[0].songs[0].lines.push({
      id: 'l1',
      startSec: 20,
      endSec: 10,
      memberIds: ['m1'],
      kind: 'sung',
    });
    expect(
      validateWorkspaceIntegrity(workspace).some((error) => error.includes('end time must be after')),
    ).toBe(true);
  });

  it('rejects duplicate vocal line ids', () => {
    const workspace = validWorkspace();
    workspace.groups[0].songs[0].lines.push(
      {
        id: 'same-line',
        startSec: 0,
        endSec: 10,
        memberIds: ['m1'],
        kind: 'sung',
      },
      {
        id: 'same-line',
        startSec: 20,
        endSec: 30,
        memberIds: ['m2'],
        kind: 'sung',
      },
    );
    expect(
      validateWorkspaceIntegrity(workspace).some((error) => error.includes('duplicate id')),
    ).toBe(true);
  });
});
