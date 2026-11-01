import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createEmptyWorkspace } from '../src/domain/schema';
import { createGroup, createSong } from '../src/domain/factories';
import { WorkspaceBackupStore } from './workspaceBackupPlugin';

let projectRoot: string;
let store: WorkspaceBackupStore;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), 'idolytics-workspace-'));
  store = new WorkspaceBackupStore(projectRoot);
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

function workspaceWithGroup(name: string) {
  const workspace = createEmptyWorkspace();
  const group = createGroup(name);
  group.songs.push(createSong('Neon', 208));
  workspace.groups.push(group);
  return workspace;
}

function backupRoot(): string {
  return path.join(projectRoot, 'backups', 'workspace');
}

async function backupFiles(): Promise<string[]> {
  try {
    return (await readdir(backupRoot())).filter(
      (name) => name.endsWith('.json') && name !== '.index.json',
    );
  } catch {
    return [];
  }
}

describe('workspace backups', () => {
  it('stores a workspace snapshot with metadata and lists it', async () => {
    const workspace = workspaceWithGroup('A2O Lite');
    const response = await store.create({
      workspace,
      source: 'manual',
      origin: 'http://localhost:3000',
    });

    expect(response.created).toBe(true);
    expect(response.deduplicated).toBe(false);
    expect(response.skipped).toBe(false);
    expect(response.backup?.stats).toMatchObject({ groups: 1, songs: 1 });
    expect(await backupFiles()).toHaveLength(1);

    const status = await store.status();
    expect(status.directory).toBe('backups/workspace');
    expect(status.limit).toBe(20);
    expect(status.backups).toHaveLength(1);
    expect(status.backups[0].source).toBe('manual');
    expect(status.backups[0].origin).toBe('http://localhost:3000');

    const record = await store.read(status.backups[0].file);
    expect(record.workspace.groups[0]?.name).toBe('A2O Lite');
    expect(record.workspace.groups[0]?.songs[0]?.title).toBe('Neon');
  });

  it('skips empty workspaces', async () => {
    const response = await store.create({
      workspace: createEmptyWorkspace(),
      source: 'autosave',
      origin: 'http://localhost:3000',
    });

    expect(response).toMatchObject({
      created: false,
      deduplicated: false,
      skipped: true,
      backup: null,
    });
    expect(await backupFiles()).toHaveLength(0);
    expect((await store.status()).backups).toHaveLength(0);
  });

  it('deduplicates matching snapshots while ignoring savedAt', async () => {
    const workspace = workspaceWithGroup('A2O Lite');
    const first = await store.create({ workspace, source: 'manual' });
    const second = await store.create({
      workspace: { ...workspace, savedAt: '2026-11-01T12:00:00.000Z' },
      source: 'autosave',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.backup?.file).toBe(first.backup?.file);
    expect(await backupFiles()).toHaveLength(1);
  });

  it('keeps only the newest snapshots', async () => {
    let tick = 0;
    store = new WorkspaceBackupStore(projectRoot, 'backups/workspace', {
      limit: 20,
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + tick++ * 1000),
    });

    for (let index = 0; index < 22; index += 1) {
      await store.create({
        workspace: workspaceWithGroup(`Group ${index}`),
        source: 'manual',
      });
    }

    const status = await store.status();
    expect(status.backups).toHaveLength(20);
    expect((await store.read(status.backups[0].file)).workspace.groups[0]?.name).toBe('Group 21');
    expect((await store.read(status.backups[19].file)).workspace.groups[0]?.name).toBe('Group 2');
    expect(await backupFiles()).toHaveLength(20);
  });

  it('rebuilds a missing index from the backup files', async () => {
    let tick = 0;
    store = new WorkspaceBackupStore(projectRoot, 'backups/workspace', {
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + tick++ * 1000),
    });
    await store.create({ workspace: workspaceWithGroup('First'), source: 'manual' });
    await store.create({ workspace: workspaceWithGroup('Second'), source: 'manual' });
    await rm(path.join(backupRoot(), '.index.json'));

    const status = await store.status();
    expect(status.backups).toHaveLength(2);
    expect((await store.read(status.backups[0].file)).workspace.groups[0]?.name).toBe('Second');
    expect((await store.read(status.backups[1].file)).workspace.groups[0]?.name).toBe('First');
  });

  it('rejects invalid workspaces and sources', async () => {
    await expect(
      store.create({
        workspace: { ...createEmptyWorkspace(), groups: 'not-a-list' },
        source: 'manual',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      store.create({ workspace: workspaceWithGroup('A2O Lite'), source: 'unknown' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses to read backups outside the index', async () => {
    await expect(store.read('../outside.json')).rejects.toMatchObject({ statusCode: 404 });
    await expect(store.read('missing.json')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects a tampered backup file', async () => {
    const response = await store.create({
      workspace: workspaceWithGroup('A2O Lite'),
      source: 'manual',
    });
    const file = response.backup?.file;
    expect(file).toBeDefined();

    const target = path.join(backupRoot(), file as string);
    const raw = JSON.parse(await readFile(target, 'utf8')) as {
      workspace: { groups: { name: string }[] };
    };
    raw.workspace.groups[0].name = 'Tampered';
    await writeFile(target, JSON.stringify(raw), 'utf8');

    await expect(store.read(file as string)).rejects.toMatchObject({ statusCode: 500 });
  });
});
