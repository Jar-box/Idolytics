import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';
import type { Plugin } from 'vite';
import { workspaceSchema, type Workspace } from '../src/domain/schema.ts';
import { workspaceStats, type WorkspaceStats } from '../src/domain/stats.ts';
import {
  WORKSPACE_BACKUP_BASE_PATH,
  WORKSPACE_BACKUP_DIRECTORY,
  WORKSPACE_BACKUP_INDEX_FORMAT,
  WORKSPACE_BACKUP_INDEX_VERSION,
  WORKSPACE_BACKUP_LIMIT,
  WORKSPACE_BACKUP_RECORD_FORMAT,
  WORKSPACE_BACKUP_RECORD_VERSION,
  isWorkspaceBackupSource,
  type WorkspaceBackupCreateResponse,
  type WorkspaceBackupIndex,
  type WorkspaceBackupRecord,
  type WorkspaceBackupSource,
  type WorkspaceBackupStatus,
  type WorkspaceBackupSummary,
} from '../src/lib/workspaceBackupTypes.ts';

const INDEX_FILE = '.index.json';
const MAX_JSON_BODY = 64 * 1024 * 1024;
const BACKUP_FILE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(autosave|manual|pre-reset|pre-import|pre-restore)-[a-f0-9]{6}\.json$/;

export class WorkspaceBackupError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'WorkspaceBackupError';
    this.statusCode = statusCode;
  }
}

export interface WorkspaceBackupStoreOptions {
  limit?: number;
  now?: () => Date;
}

export interface WorkspaceBackupCreateInput {
  workspace: unknown;
  source: string;
  origin?: string;
}

export class WorkspaceBackupStore {
  readonly rootDir: string;
  readonly relativeDir: string;
  readonly limit: number;

  private readonly indexPath: string;
  private readonly now: () => Date;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    projectRoot: string,
    relativeDir: string = WORKSPACE_BACKUP_DIRECTORY,
    options: WorkspaceBackupStoreOptions = {},
  ) {
    const normalized = relativeDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (
      normalized.length === 0 ||
      path.isAbsolute(normalized) ||
      normalized.split('/').some((segment) => segment === '' || segment === '..')
    ) {
      throw new Error('The workspace backup directory must stay inside the project.');
    }
    this.rootDir = path.resolve(projectRoot, normalized);
    this.relativeDir = normalized;
    this.indexPath = path.join(this.rootDir, INDEX_FILE);
    const requestedLimit = Math.floor(options.limit ?? WORKSPACE_BACKUP_LIMIT);
    this.limit = Math.min(Math.max(requestedLimit, 1), 100);
    this.now = options.now ?? (() => new Date());
  }

  async status(): Promise<WorkspaceBackupStatus> {
    return this.runExclusive(async () => {
      let index = await this.loadIndex();
      const existing: WorkspaceBackupSummary[] = [];
      let changed = index.backups.length > this.limit;

      for (const entry of index.backups.slice(0, this.limit)) {
        try {
          const info = await stat(path.join(this.rootDir, entry.file));
          if (!info.isFile()) {
            changed = true;
            continue;
          }
          if (info.size !== entry.size) changed = true;
          existing.push(info.size === entry.size ? entry : { ...entry, size: info.size });
        } catch {
          changed = true;
        }
      }

      if (changed) {
        index = { ...index, backups: existing };
        await this.writeIndex(index);
      }

      return {
        available: true,
        directory: this.relativeDir,
        limit: this.limit,
        backups: existing,
      };
    });
  }

  async create(input: WorkspaceBackupCreateInput): Promise<WorkspaceBackupCreateResponse> {
    return this.runExclusive(async () => {
      if (!isWorkspaceBackupSource(input.source)) {
        throw new WorkspaceBackupError(400, 'That workspace backup source is not supported.');
      }

      const parsed = workspaceSchema.safeParse(input.workspace);
      if (!parsed.success) {
        throw new WorkspaceBackupError(400, 'The workspace snapshot is not valid.');
      }
      const workspace = parsed.data;

      if (workspace.groups.length === 0) {
        return { created: false, deduplicated: false, skipped: true, backup: null };
      }

      let index = await this.loadIndex();
      const signature = workspaceSignature(workspace);
      const existing = index.backups.find((entry) => entry.signature === signature);
      if (existing) {
        try {
          await stat(path.join(this.rootDir, existing.file));
          return {
            created: false,
            deduplicated: true,
            skipped: false,
            backup: existing,
          };
        } catch {
          index = {
            ...index,
            backups: index.backups.filter((entry) => entry.file !== existing.file),
          };
        }
      }

      const createdAt = this.now().toISOString();
      const file = backupFileName(createdAt, input.source);
      const record: WorkspaceBackupRecord = {
        format: WORKSPACE_BACKUP_RECORD_FORMAT,
        version: WORKSPACE_BACKUP_RECORD_VERSION,
        createdAt,
        source: input.source,
        origin: normalizeOrigin(input.origin),
        stats: workspaceStats(workspace),
        signature,
        workspace,
      };
      const text = `${JSON.stringify(record, null, 2)}\n`;
      const target = path.join(this.rootDir, file);
      const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;

      await mkdir(this.rootDir, { recursive: true });
      await writeFile(temp, text, 'utf8');
      await replaceFile(temp, target);

      const summary: WorkspaceBackupSummary = {
        file,
        createdAt,
        source: input.source,
        origin: record.origin,
        stats: record.stats,
        size: Buffer.byteLength(text),
        signature,
      };
      const ordered = sortBackups([summary, ...index.backups]);
      const kept = ordered.slice(0, this.limit);
      const removed = ordered.slice(this.limit);

      await this.writeIndex({
        format: WORKSPACE_BACKUP_INDEX_FORMAT,
        version: WORKSPACE_BACKUP_INDEX_VERSION,
        backups: kept,
      });

      for (const entry of removed) {
        await rm(path.join(this.rootDir, entry.file), { force: true }).catch(() => undefined);
      }

      return {
        created: true,
        deduplicated: false,
        skipped: false,
        backup: summary,
      };
    });
  }

  async read(file: string): Promise<WorkspaceBackupRecord> {
    return this.runExclusive(async () => {
      const index = await this.loadIndex();
      const entry = index.backups.find((backup) => backup.file === file);
      if (!entry) {
        throw new WorkspaceBackupError(404, 'That workspace backup was not found.');
      }

      let text: string;
      try {
        text = await readFile(path.join(this.rootDir, entry.file), 'utf8');
      } catch {
        throw new WorkspaceBackupError(404, 'That workspace backup file is missing.');
      }

      let raw: unknown;
      try {
        raw = JSON.parse(text) as unknown;
      } catch {
        throw new WorkspaceBackupError(500, 'That workspace backup is not valid JSON.');
      }

      const record = parseRecord(raw);
      if (!record || record.signature !== entry.signature) {
        throw new WorkspaceBackupError(500, 'That workspace backup is damaged.');
      }
      return record;
    });
  }

  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async loadIndex(): Promise<WorkspaceBackupIndex> {
    try {
      const raw = JSON.parse(await readFile(this.indexPath, 'utf8')) as unknown;
      const backups = parseIndex(raw);
      if (backups) {
        return {
          format: WORKSPACE_BACKUP_INDEX_FORMAT,
          version: WORKSPACE_BACKUP_INDEX_VERSION,
          backups: sortBackups(backups).slice(0, this.limit),
        };
      }
    } catch {
      // A missing or unreadable index is rebuilt from the backup files below.
    }
    return this.rebuildIndex();
  }

  private async rebuildIndex(): Promise<WorkspaceBackupIndex> {
    const files = await this.listBackupFiles();
    const entries: WorkspaceBackupSummary[] = [];

    for (const file of files) {
      try {
        const fullPath = path.join(this.rootDir, file);
        const raw = JSON.parse(await readFile(fullPath, 'utf8')) as unknown;
        const record = parseRecord(raw);
        if (!record) continue;
        const info = await stat(fullPath);
        entries.push({
          file,
          createdAt: record.createdAt,
          source: record.source,
          origin: record.origin,
          stats: record.stats,
          size: info.size,
          signature: record.signature,
        });
      } catch {
        // A damaged file is left on disk but kept out of the restore list.
      }
    }

    const index: WorkspaceBackupIndex = {
      format: WORKSPACE_BACKUP_INDEX_FORMAT,
      version: WORKSPACE_BACKUP_INDEX_VERSION,
      backups: sortBackups(entries).slice(0, this.limit),
    };
    await this.writeIndex(index);
    return index;
  }

  private async listBackupFiles(): Promise<string[]> {
    try {
      const names = await readdir(this.rootDir);
      return names.filter((name) => BACKUP_FILE_PATTERN.test(name));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
  }

  private async writeIndex(index: WorkspaceBackupIndex): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const temp = `${this.indexPath}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temp, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    await replaceFile(temp, this.indexPath);
  }
}

export interface WorkspaceBackupPluginOptions {
  backupDir?: string;
  limit?: number;
  now?: () => Date;
}

export function workspaceBackupPlugin(options: WorkspaceBackupPluginOptions = {}): Plugin {
  return {
    name: 'idolytics-workspace-backups',
    apply: 'serve',
    configureServer(server) {
      const store = new WorkspaceBackupStore(
        server.config.root,
        options.backupDir ?? WORKSPACE_BACKUP_DIRECTORY,
        { limit: options.limit, now: options.now },
      );
      server.config.logger.info(`[idolytics] workspace backups: ${store.relativeDir}/`);

      server.middlewares.use((request, response, next) => {
        if (!request.url) {
          next();
          return;
        }
        let url: URL;
        try {
          url = new URL(request.url, 'http://localhost');
        } catch {
          next();
          return;
        }
        if (
          url.pathname !== WORKSPACE_BACKUP_BASE_PATH &&
          !url.pathname.startsWith(`${WORKSPACE_BACKUP_BASE_PATH}/`)
        ) {
          next();
          return;
        }
        void handleWorkspaceRequest(request, response, store, url).catch((error: unknown) => {
          if (response.writableEnded || response.destroyed) return;
          if (error instanceof WorkspaceBackupError) {
            sendJson(response, error.statusCode, { error: error.message });
            return;
          }
          server.config.logger.error(`[idolytics] workspace backup request failed: ${String(error)}`);
          sendJson(response, 500, {
            error: 'The workspace backup service could not complete that request.',
          });
        });
      });
    },
  };
}

async function handleWorkspaceRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: WorkspaceBackupStore,
  url: URL,
): Promise<void> {
  if (!isTrustedWorkspaceRequest(request)) {
    sendJson(response, 403, { error: 'Workspace backups only accept local app requests.' });
    return;
  }

  if (url.pathname === `${WORKSPACE_BACKUP_BASE_PATH}/status`) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      methodNotAllowed(response);
      return;
    }
    const status = await store.status();
    sendJson(response, 200, status, request.method === 'HEAD');
    return;
  }

  if (url.pathname === `${WORKSPACE_BACKUP_BASE_PATH}/backup`) {
    if (request.method !== 'POST') {
      methodNotAllowed(response);
      return;
    }
    const body = await readJsonBody(request, MAX_JSON_BODY);
    if (!isRecord(body) || !isWorkspaceBackupSource(body.source)) {
      throw new WorkspaceBackupError(400, 'The request body is not a workspace backup request.');
    }
    const result = await store.create({
      workspace: body.workspace,
      source: body.source,
      origin: request.headers.origin ?? '',
    });
    sendJson(response, 200, result);
    return;
  }

  const prefix = `${WORKSPACE_BACKUP_BASE_PATH}/backups/`;
  if (url.pathname.startsWith(prefix)) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      methodNotAllowed(response);
      return;
    }
    const encoded = url.pathname.slice(prefix.length);
    let file: string;
    try {
      file = decodeURIComponent(encoded);
    } catch {
      throw new WorkspaceBackupError(400, 'That workspace backup name is not valid.');
    }
    if (!file || file.includes('/') || file.includes('\\')) {
      throw new WorkspaceBackupError(404, 'That workspace backup was not found.');
    }
    const record = await store.read(file);
    sendJson(response, 200, record, request.method === 'HEAD');
    return;
  }

  sendJson(response, 404, { error: 'That workspace backup endpoint was not found.' });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isWorkspaceStats(value: unknown): value is WorkspaceStats {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeNumber(value.groups) &&
    isNonNegativeNumber(value.members) &&
    isNonNegativeNumber(value.songs) &&
    isNonNegativeNumber(value.sections) &&
    isNonNegativeNumber(value.formations) &&
    isNonNegativeNumber(value.choreoSeconds)
  );
}

function isWorkspaceBackupSummary(value: unknown): value is WorkspaceBackupSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.file === 'string' &&
    BACKUP_FILE_PATTERN.test(value.file) &&
    typeof value.createdAt === 'string' &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    isWorkspaceBackupSource(value.source) &&
    typeof value.origin === 'string' &&
    value.origin.length <= 200 &&
    isWorkspaceStats(value.stats) &&
    isNonNegativeNumber(value.size) &&
    typeof value.signature === 'string' &&
    /^[a-f0-9]{64}$/.test(value.signature)
  );
}

function parseIndex(value: unknown): WorkspaceBackupSummary[] | null {
  if (!isRecord(value)) return null;
  if (
    value.format !== WORKSPACE_BACKUP_INDEX_FORMAT ||
    value.version !== WORKSPACE_BACKUP_INDEX_VERSION ||
    !Array.isArray(value.backups)
  ) {
    return null;
  }
  const backups = value.backups.filter(isWorkspaceBackupSummary);
  if (backups.length !== value.backups.length) return null;
  if (new Set(backups.map((entry) => entry.file)).size !== backups.length) return null;
  return backups;
}

function parseRecord(value: unknown): WorkspaceBackupRecord | null {
  if (!isRecord(value)) return null;
  if (
    value.format !== WORKSPACE_BACKUP_RECORD_FORMAT ||
    value.version !== WORKSPACE_BACKUP_RECORD_VERSION
  ) {
    return null;
  }
  if (
    typeof value.createdAt !== 'string' ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    !isWorkspaceBackupSource(value.source) ||
    typeof value.origin !== 'string' ||
    value.origin.length > 200 ||
    typeof value.signature !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.signature)
  ) {
    return null;
  }
  const parsed = workspaceSchema.safeParse(value.workspace);
  if (!parsed.success) return null;
  if (workspaceSignature(parsed.data) !== value.signature) return null;

  return {
    format: WORKSPACE_BACKUP_RECORD_FORMAT,
    version: WORKSPACE_BACKUP_RECORD_VERSION,
    createdAt: value.createdAt,
    source: value.source,
    origin: value.origin,
    stats: workspaceStats(parsed.data),
    signature: value.signature,
    workspace: parsed.data,
  };
}

function sortBackups(backups: WorkspaceBackupSummary[]): WorkspaceBackupSummary[] {
  return [...backups].sort((left, right) => {
    const byDate = right.createdAt.localeCompare(left.createdAt);
    return byDate !== 0 ? byDate : right.file.localeCompare(left.file);
  });
}

function backupFileName(createdAt: string, source: WorkspaceBackupSource): string {
  return `${createdAt.replace(/[:.]/g, '-')}-${source}-${randomBytes(3).toString('hex')}.json`;
}

function normalizeOrigin(value: string | undefined): string {
  if (!value) return 'unknown';
  try {
    return new URL(value).origin.slice(0, 200);
  } catch {
    return 'unknown';
  }
}

function workspaceSignature(workspace: Workspace): string {
  const copy = { ...workspace };
  delete copy.savedAt;
  return createHash('sha256').update(canonicalJson(copy)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isRecord(value)) {
    const parts: string[] = [];
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
    }
    return `{${parts.join(',')}}`;
  }
  return 'null';
}

function isLoopbackHostname(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]';
}

function isTrustedWorkspaceRequest(request: IncomingMessage): boolean {
  const host = request.headers.host;
  if (!host) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  if (!isLoopbackHostname(hostname)) return false;
  const origin = request.headers.origin;
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (!isLoopbackHostname(parsed.hostname)) return false;
      if (parsed.host.toLowerCase() !== host.toLowerCase()) return false;
    } catch {
      return false;
    }
  }
  return request.headers['sec-fetch-site'] !== 'cross-site';
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  headOnly = false,
): void {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(headOnly ? undefined : body);
}

function methodNotAllowed(response: ServerResponse): void {
  response.setHeader('Allow', 'GET, HEAD, POST');
  sendJson(response, 405, { error: 'That method is not supported.' });
}

async function readJsonBody(request: IncomingMessage, limit: number): Promise<unknown> {
  const rawLength = request.headers['content-length'];
  if (rawLength !== undefined) {
    const length = Number(rawLength);
    if (Number.isFinite(length) && length > limit) {
      throw new WorkspaceBackupError(413, 'The request body is too large.');
    }
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      throw new WorkspaceBackupError(413, 'The request body is too large.');
    }
    chunks.push(buffer);
  }
  if (size === 0) {
    throw new WorkspaceBackupError(400, 'The request body is empty.');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new WorkspaceBackupError(400, 'The request body must be valid JSON.');
  }
}

async function replaceFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EEXIST' || code === 'EPERM' || code === 'ENOTEMPTY') {
      await rm(to, { force: true });
      await rename(from, to);
      return;
    }
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}
