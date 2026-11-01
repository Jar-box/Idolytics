import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import * as path from 'node:path';
import type {
  MediaCopyResponse,
  MediaImportCancelResponse,
  MediaImportJob,
  MediaImportQuality,
  MediaImportRequest,
  MediaImportStartResponse,
  MediaImportTools,
  MediaKind,
  MediaProbeResponse,
  MediaToolStatus,
} from '../src/lib/mediaTypes.ts';

const JOB_PREFIX = 'imp_';
const JOB_ID_PATTERN = /^imp_[a-f0-9]{16}$/;
const JOB_TTL_MS = 10 * 60 * 1000;
const TOOLS_CACHE_MS = 60 * 1000;
const MAX_ACTIVE_JOBS = 2;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 140;
const MAX_IMPORT_BYTES = 8 * 1024 * 1024 * 1024;
const DEFAULT_METADATA_TIMEOUT_MS = 90 * 1000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_LINK_PROBE_TIMEOUT_MS = 45 * 1000;
const PROBE_TIMEOUT_MS = 8 * 1000;
const OUTPUT_CAP_BYTES = 16 * 1024 * 1024;
const ERROR_CAP_BYTES = 64 * 1024;
const PROGRESS_MARKER = 'IDLYTDLPROGRESS:';
const IMPORT_DIR_PREFIX = 'import-';

const MEDIA_EXTENSIONS = new Set([
  '.aac',
  '.flac',
  '.m4a',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.oga',
  '.ogg',
  '.ogv',
  '.opus',
  '.wav',
  '.weba',
  '.webm',
]);

export class MediaImportError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'MediaImportError';
    this.statusCode = statusCode;
  }
}

export interface MediaImportLibrary {
  readonly root: string;
  saveImport(input: {
    groupId: string;
    groupName: string;
    songId: string;
    songTitle: string;
    kind: MediaKind;
    filename: string;
    tempPath: string;
    size: number;
  }): Promise<MediaCopyResponse>;
}

export interface MediaImportLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

interface ToolCommand {
  command: string;
  prefixArgs: string[];
}

interface ResolvedTool extends ToolCommand {
  available: boolean;
  version: string | null;
}

interface ResolvedTools {
  ytDlp: ResolvedTool;
  ffmpeg: ResolvedTool;
  jsRuntimes: boolean;
  cookies: 'browser' | 'file' | null;
}

interface InternalJob {
  job: MediaImportJob;
  request: MediaImportRequest;
  abort: AbortController;
  tempDir: string;
  child: import('node:child_process').ChildProcess | null;
  expiryTimer: NodeJS.Timeout | null;
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

interface CommandRunOptions {
  cwd?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}

export interface MediaImporterOptions {
  root: string;
  library: MediaImportLibrary;
  mediaRoot?: string;
  tempRoot?: string;
  ytDlp?: ToolCommand | string;
  ffmpeg?: ToolCommand | string;
  env?: NodeJS.ProcessEnv;
  logger?: MediaImportLogger;
  metadataTimeoutMs?: number;
  probeTimeoutMs?: number;
  downloadTimeoutMs?: number;
}

const silentLogger: MediaImportLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | null {
  return isRecord(error) && typeof error.code === 'string' ? error.code : null;
}

function truncate(value: string, max: number): string {
  const characters = Array.from(value);
  return characters.length <= max ? value : characters.slice(0, max).join('');
}

function displayName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return truncate(value.trim(), 80) || fallback;
}

function isValidId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value);
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isValidId(value)) {
    throw new MediaImportError(400, `${label} is not valid.`);
  }
  return value;
}

function isMediaKind(value: unknown): value is MediaKind {
  return value === 'audio' || value === 'video';
}

function isMediaImportQuality(value: unknown): value is MediaImportQuality {
  return value === '720' || value === '1080' || value === 'best';
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }
  if (host === '::1' || host === '0.0.0.0') return true;
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const first = Number(ipv4[1]);
  const second = Number(ipv4[2]);
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
}

function isPlaylistLink(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (url.pathname === '/playlist') return true;
    if (url.pathname === '/watch' && url.searchParams.has('list') && !url.searchParams.get('v')) {
      return true;
    }
  }
  if (host === 'youtu.be' && url.searchParams.has('list')) {
    return !url.pathname || url.pathname === '/';
  }
  return false;
}

export function validateImportUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new MediaImportError(400, 'Paste a video or audio URL.');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new MediaImportError(400, 'Paste a video or audio URL.');
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new MediaImportError(400, 'That URL is too long.');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new MediaImportError(400, 'That does not look like a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new MediaImportError(400, 'Only http and https links are supported.');
  }
  if (url.username || url.password) {
    throw new MediaImportError(400, 'Links with embedded credentials are not supported.');
  }
  if (isPrivateHostname(url.hostname)) {
    throw new MediaImportError(400, 'Local and private network links are not supported.');
  }
  if (isPlaylistLink(url)) {
    throw new MediaImportError(400, 'Paste a single video link, not a playlist.');
  }
  return url.toString();
}

export function parseMediaImportRequest(value: unknown): MediaImportRequest {
  if (!isRecord(value)) {
    throw new MediaImportError(400, 'The import request is not valid.');
  }
  return {
    url: validateImportUrl(value.url),
    groupId: requiredId(value.groupId, 'Group id'),
    groupName: displayName(value.groupName, 'Untitled group'),
    songId: requiredId(value.songId, 'Song id'),
    songTitle: displayName(value.songTitle, 'Untitled song'),
    kind: isMediaKind(value.kind)
      ? value.kind
      : (() => {
          throw new MediaImportError(400, 'Media kind must be audio or video.');
        })(),
    quality: isMediaImportQuality(value.quality) ? value.quality : '1080',
  };
}

export function buildVideoFormatSelector(quality: MediaImportQuality): string {
  const cap = quality === 'best' ? '' : `[height<=${quality}]`;
  return [
    `bv*${cap}[ext=mp4][vcodec^=avc1]+ba[ext=m4a]`,
    `bv*${cap}[ext=mp4]+ba[ext=m4a]`,
    `b${cap}[ext=mp4]`,
    `bv*${cap}+ba`,
    `b${cap}`,
    'bv*+ba',
    'b',
  ].join('/');
}

function formatSelector(kind: MediaKind, quality: MediaImportQuality): string {
  return kind === 'audio' ? 'ba[ext=m4a]/ba/b' : buildVideoFormatSelector(quality);
}

export interface ParsedImportProgress {
  progress: number | null;
  status: string | null;
}

function parseOptionalNumber(value: string): number | null {
  const parsed = Number(value);
  return value !== '' && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseImportProgressLine(line: string): ParsedImportProgress | null {
  const markerIndex = line.indexOf(PROGRESS_MARKER);
  if (markerIndex === -1) return null;
  const payload = line.slice(markerIndex + PROGRESS_MARKER.length).trim();
  const [downloadedRaw = '', totalRaw = '', estimateRaw = '', statusRaw = ''] =
    payload.split('|');
  const status = statusRaw.trim() || null;
  if (status === 'finished') return { progress: 1, status };
  const downloaded = parseOptionalNumber(downloadedRaw.trim());
  const totalBytes = parseOptionalNumber(totalRaw.trim());
  const estimateBytes = parseOptionalNumber(estimateRaw.trim());
  const total =
    totalBytes !== null && totalBytes > 0
      ? totalBytes
      : estimateBytes !== null && estimateBytes > 0
        ? estimateBytes
        : null;
  if (downloaded === null || total === null) {
    return { progress: null, status };
  }
  return { progress: Math.max(0, Math.min(1, downloaded / total)), status };
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function lastMeaningfulLine(value: string): string {
  const lines = stripAnsi(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

function libraryFailureMessage(error: unknown): string | null {
  if (
    isRecord(error) &&
    typeof error.statusCode === 'number' &&
    typeof error.message === 'string' &&
    error.message
  ) {
    return error.message;
  }
  return null;
}

export function describeImportFailure(
  stderr: string,
  fallback = 'The media could not be downloaded.',
): string {
  const cleaned = stripAnsi(stderr);
  const text = cleaned.toLowerCase();
  if (!text.trim()) return fallback;
  if (
    text.includes('sign in to confirm') ||
    text.includes('not a bot') ||
    text.includes('confirm you') ||
    text.includes('use --cookies') ||
    text.includes('cookies-from-browser')
  ) {
    return 'The site asked for a sign-in. Set IDOLYTICS_YTDLP_COOKIES_FROM_BROWSER (for example, chrome) or IDOLYTICS_YTDLP_COOKIES_FILE, then restart the dev server.';
  }
  if (text.includes('private video')) {
    return 'That video is private.';
  }
  if (text.includes('members-only') || text.includes('members only')) {
    return 'That video is only available to channel members.';
  }
  if (text.includes('age-restricted') || text.includes('age restricted')) {
    return 'That video is age-restricted. Cookies from a signed-in browser are required.';
  }
  if (
    text.includes('video unavailable') ||
    text.includes('has been removed') ||
    text.includes('no longer available')
  ) {
    return 'That video is unavailable. It may have been removed or blocked.';
  }
  if (text.includes('unsupported url') || text.includes('no suitable extractor')) {
    return 'That link is not supported by yt-dlp.';
  }
  if (text.includes('requested format is not available')) {
    return 'No compatible format was available for that link.';
  }
  if (text.includes('http error 403') || text.includes('forbidden')) {
    return 'The site blocked the download (403). Cookies may be required.';
  }
  if (text.includes('http error 429') || text.includes('too many requests')) {
    return 'The site is rate-limiting downloads. Wait a moment and try again.';
  }
  if (text.includes('timed out') || text.includes('timeout')) {
    return 'The download timed out. Try again.';
  }
  if (
    text.includes('no space left') ||
    text.includes('enospc') ||
    text.includes('disk full')
  ) {
    return 'The download could not be saved because the disk is full.';
  }
  if (text.includes('ffmpeg not found') || text.includes('ffprobe not found')) {
    return 'ffmpeg is required to finish this import. Install ffmpeg or set IDOLYTICS_FFMPEG_PATH.';
  }
  const detail = truncate(lastMeaningfulLine(cleaned), 320);
  return detail ? `The download failed: ${detail}` : fallback;
}

function parseYtDlpVersion(stdout: string): string | null {
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return line ?? null;
}

function parseFfmpegVersion(stdout: string): string | null {
  const match = /ffmpeg version\s+(\S+)/i.exec(stdout);
  if (match?.[1]) return match[1];
  return parseYtDlpVersion(stdout);
}

function normalizeToolCommand(
  value: ToolCommand | string | undefined,
): ToolCommand | null {
  if (!value) return null;
  if (typeof value === 'string') return { command: value, prefixArgs: [] };
  return { command: value.command, prefixArgs: [...(value.prefixArgs ?? [])] };
}

function commandLabel(command: ToolCommand): string {
  return [command.command, ...command.prefixArgs].join(' ');
}

function createLineCollector(onLine: (line: string) => void): {
  push: (chunk: string) => void;
  flush: () => void;
} {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      const parts = buffer.split(/\r\n|\n|\r/);
      buffer = parts.pop() ?? '';
      for (const part of parts) onLine(part);
    },
    flush() {
      if (buffer) onLine(buffer);
      buffer = '';
    },
  };
}

function runCommand(
  command: ToolCommand,
  args: string[],
  options: CommandRunOptions,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let child: import('node:child_process').ChildProcess;
    try {
      child = spawn(command.command, [...command.prefixArgs, ...args], {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | null = null;

    const stdoutLines = createLineCollector((line) => {
      options.onStdoutLine?.(line);
    });

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', handleAbort);
      stdoutLines.flush();
      resolve(result);
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', handleAbort);
      child.stdout?.destroy();
      child.stderr?.destroy();
      reject(error);
    };

    const stop = (reason: 'timeout' | 'abort') => {
      if (settled) return;
      if (reason === 'timeout') timedOut = true;
      else cancelled = true;
      child.kill();
    };

    const handleAbort = () => stop('abort');

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < OUTPUT_CAP_BYTES) {
        stdout = (stdout + chunk).slice(0, OUTPUT_CAP_BYTES);
      }
      stdoutLines.push(chunk);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-ERROR_CAP_BYTES);
    });
    child.once('error', (error) => {
      fail(error);
    });
    child.once('close', (code) => {
      finish({ code, stdout, stderr, timedOut, cancelled });
    });

    if (options.signal) {
      if (options.signal.aborted) {
        stop('abort');
      } else {
        options.signal.addEventListener('abort', handleAbort, { once: true });
      }
    }

    timer = setTimeout(() => {
      stop('timeout');
    }, options.timeoutMs);
    timer.unref?.();
  });
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function cookieStatus(env: NodeJS.ProcessEnv): 'browser' | 'file' | null {
  if (readEnv(env, 'IDOLYTICS_YTDLP_COOKIES_FROM_BROWSER')) return 'browser';
  if (readEnv(env, 'IDOLYTICS_YTDLP_COOKIES_FILE')) return 'file';
  return null;
}

function cookieArguments(env: NodeJS.ProcessEnv): string[] {
  const browser = readEnv(env, 'IDOLYTICS_YTDLP_COOKIES_FROM_BROWSER');
  if (browser) return ['--cookies-from-browser', browser];
  const file = readEnv(env, 'IDOLYTICS_YTDLP_COOKIES_FILE');
  if (file) return ['--cookies', file];
  return [];
}

function cleanImportTitle(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/g, '');
  return truncate(cleaned, MAX_TITLE_LENGTH).trim() || 'Imported media';
}

function isMediaFile(name: string): boolean {
  return MEDIA_EXTENSIONS.has(path.extname(name).toLowerCase());
}

async function findDownloadedFile(
  directory: string,
  kind: MediaKind,
): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates: Array<{ filePath: string; size: number; extension: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isMediaFile(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile() || info.size <= 0) continue;
    candidates.push({
      filePath,
      size: info.size,
      extension: path.extname(entry.name).toLowerCase(),
    });
  }
  if (candidates.length === 0) return null;
  const preferred =
    kind === 'audio'
      ? new Set(['.m4a', '.mp3', '.aac', '.opus', '.ogg', '.oga', '.flac', '.wav', '.weba'])
      : new Set(['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.ogv']);
  candidates.sort((left, right) => {
    const leftPreferred = preferred.has(left.extension) ? 1 : 0;
    const rightPreferred = preferred.has(right.extension) ? 1 : 0;
    if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;
    return right.size - left.size;
  });
  return candidates[0]?.filePath ?? null;
}

function isPlaylistMetadata(value: Record<string, unknown>): boolean {
  return (
    value._type === 'playlist' ||
    Array.isArray(value.entries) ||
    value._type === 'multi_video'
  );
}

function metadataTitle(value: Record<string, unknown>, fallback: string): string {
  if (typeof value.title === 'string' && value.title.trim()) {
    return truncate(value.title.trim(), 240);
  }
  return fallback;
}

function metadataDuration(value: Record<string, unknown>): number | null {
  const duration = value.duration;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  return Math.round(duration * 10) / 10;
}

export class MediaImporter {
  private readonly root: string;
  private readonly library: MediaImportLibrary;
  private readonly tempRoot: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly logger: MediaImportLogger;
  private readonly explicitYtDlp: ToolCommand | null;
  private readonly explicitFfmpeg: ToolCommand | null;
  private readonly metadataTimeoutMs: number;
  private readonly probeTimeoutMs: number;
  private readonly downloadTimeoutMs: number;
  private readonly jobs = new Map<string, InternalJob>();
  private toolsCache: { at: number; value: ResolvedTools } | null = null;
  private toolsPromise: Promise<ResolvedTools> | null = null;
  private cleanupPromise: Promise<void> | null = null;

  constructor(options: MediaImporterOptions) {
    this.root = path.resolve(options.root);
    this.library = options.library;
    this.tempRoot = path.resolve(
      options.tempRoot ??
        path.join(options.mediaRoot ?? path.join(this.root, 'media'), '.tmp'),
    );
    this.env = options.env ?? process.env;
    this.logger = options.logger ?? silentLogger;
    this.explicitYtDlp = normalizeToolCommand(options.ytDlp);
    this.explicitFfmpeg = normalizeToolCommand(options.ffmpeg);
    this.metadataTimeoutMs = options.metadataTimeoutMs ?? DEFAULT_METADATA_TIMEOUT_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_LINK_PROBE_TIMEOUT_MS;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  }

  async describeTools(): Promise<MediaImportTools> {
    const tools = await this.getResolvedTools();
    return {
      ytDlp: this.publicTool(tools.ytDlp),
      ffmpeg: this.publicTool(tools.ffmpeg),
      cookies: tools.cookies,
    };
  }

  async probe(value: unknown): Promise<MediaProbeResponse> {
    if (!isRecord(value)) {
      throw new MediaImportError(400, 'The link request is not valid.');
    }
    const url = validateImportUrl(value.url);
    const tools = await this.getResolvedTools();
    if (!tools.ytDlp.available) {
      throw new MediaImportError(
        503,
        'Reading a link needs yt-dlp. Install it or set IDOLYTICS_YTDLP_PATH, then restart the dev server.',
      );
    }
    const metadata = await this.readMetadata(url, tools, {
      cwd: this.root,
      timeoutMs: this.probeTimeoutMs,
      fallbackTitle: '',
    });
    const durationSec = metadata.durationSec;
    if (durationSec === null) {
      throw new MediaImportError(
        422,
        'That link does not report a fixed length. Live streams and some videos cannot be measured. Enter the length manually.',
      );
    }
    if (durationSec > 12 * 60 * 60) {
      throw new MediaImportError(422, 'Song length must be 12 hours or less.');
    }
    return {
      title: metadata.title.trim() || null,
      durationSec,
    };
  }

  async start(value: unknown): Promise<MediaImportStartResponse> {
    const request = parseMediaImportRequest(value);
    const tools = await this.getResolvedTools();
    if (!tools.ytDlp.available) {
      throw new MediaImportError(
        503,
        'URL import needs yt-dlp. Install it or set IDOLYTICS_YTDLP_PATH, then restart the dev server.',
      );
    }
    if (!tools.ffmpeg.available) {
      throw new MediaImportError(
        503,
        'URL import needs ffmpeg. Install it or set IDOLYTICS_FFMPEG_PATH, then restart the dev server.',
      );
    }

    await this.ensureTempCleanup();
    this.pruneExpiredJobs();
    for (const internal of this.jobs.values()) {
      if (
        !this.isTerminal(internal) &&
        internal.request.groupId === request.groupId &&
        internal.request.songId === request.songId &&
        internal.request.kind === request.kind
      ) {
        throw new MediaImportError(
          409,
          `An ${request.kind} import is already running for this song.`,
        );
      }
    }
    const activeCount = [...this.jobs.values()].filter(
      (internal) => !this.isTerminal(internal),
    ).length;
    if (activeCount >= MAX_ACTIVE_JOBS) {
      throw new MediaImportError(
        429,
        'Two imports are already running. Wait for one to finish and try again.',
      );
    }

    const id = `${JOB_PREFIX}${randomBytes(8).toString('hex')}`;
    const tempDir = path.join(this.tempRoot, `${IMPORT_DIR_PREFIX}${id}`);
    await mkdir(tempDir, { recursive: true });
    const now = new Date().toISOString();
    const job: MediaImportJob = {
      id,
      state: 'queued',
      progress: 0,
      title: null,
      durationSec: null,
      copy: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const internal: InternalJob = {
      job,
      request,
      abort: new AbortController(),
      tempDir,
      child: null,
      expiryTimer: null,
    };
    this.jobs.set(id, internal);
    this.logger.info(
      `[idolytics] import ${id}: ${request.kind} for ${request.groupId}/${request.songId}`,
    );
    void this.run(internal, tools).catch((error: unknown) => {
      this.logger.error(`[idolytics] import ${id} crashed: ${String(error)}`);
      this.markError(internal, 'The import stopped unexpectedly. Try again.');
      this.scheduleExpiry(internal);
    });
    return { jobId: id };
  }

  get(jobId: string): MediaImportJob | null {
    if (!JOB_ID_PATTERN.test(jobId)) return null;
    const internal = this.jobs.get(jobId);
    return internal ? { ...internal.job } : null;
  }

  async cancel(jobId: string): Promise<MediaImportCancelResponse | null> {
    if (!JOB_ID_PATTERN.test(jobId)) return null;
    const internal = this.jobs.get(jobId);
    if (!internal) return null;
    if (this.isTerminal(internal)) {
      return { cancelled: internal.job.state === 'cancelled', job: { ...internal.job } };
    }
    if (internal.job.state === 'saving') {
      return { cancelled: false, job: { ...internal.job } };
    }
    this.update(internal, { state: 'cancelled', error: 'Import cancelled.' });
    internal.abort.abort();
    internal.child?.kill();
    this.logger.info(`[idolytics] import ${jobId}: cancelled`);
    return { cancelled: true, job: { ...internal.job } };
  }

  dispose(): void {
    for (const internal of this.jobs.values()) {
      if (!this.isTerminal(internal)) {
        internal.abort.abort();
        internal.child?.kill();
      }
      if (internal.expiryTimer) clearTimeout(internal.expiryTimer);
      void rm(internal.tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
    this.jobs.clear();
  }

  private publicTool(tool: ResolvedTool): MediaToolStatus {
    return { available: tool.available, version: tool.version };
  }

  private isTerminal(internal: InternalJob): boolean {
    return (
      internal.job.state === 'done' ||
      internal.job.state === 'error' ||
      internal.job.state === 'cancelled'
    );
  }

  private update(internal: InternalJob, patch: Partial<MediaImportJob>): void {
    internal.job = {
      ...internal.job,
      ...patch,
      progress:
        patch.progress === undefined
          ? internal.job.progress
          : Math.max(0, Math.min(1, patch.progress)),
      updatedAt: new Date().toISOString(),
    };
  }

  private markError(internal: InternalJob, message: string): void {
    if (this.isTerminal(internal)) return;
    this.update(internal, {
      state: 'error',
      error: message,
    });
  }

  private async run(internal: InternalJob, tools: ResolvedTools): Promise<void> {
    try {
      this.update(internal, { state: 'resolving', progress: 0.02 });
      const metadata = await this.fetchMetadata(internal, tools);
      if (internal.abort.signal.aborted) return;
      this.update(internal, {
        state: 'downloading',
        progress: 0.05,
        title: metadata.title,
        durationSec: metadata.durationSec,
      });
      const downloaded = await this.download(internal, tools, metadata.title);
      if (internal.abort.signal.aborted) return;
      const info = await stat(downloaded).catch(() => null);
      if (!info?.isFile() || info.size <= 0) {
        throw new MediaImportError(500, 'The downloaded file was empty.');
      }
      if (info.size > MAX_IMPORT_BYTES) {
        throw new MediaImportError(413, 'That media file is too large for the media library.');
      }
      const extension = path.extname(downloaded).toLowerCase();
      const baseTitle = cleanImportTitle(
        metadata.title || internal.request.songTitle || 'Imported media',
      );
      const filename = `${baseTitle}${extension || (internal.request.kind === 'audio' ? '.m4a' : '.mp4')}`;
      this.update(internal, { state: 'saving', progress: 0.99 });
      const copy = await this.library.saveImport({
        groupId: internal.request.groupId,
        groupName: internal.request.groupName,
        songId: internal.request.songId,
        songTitle: internal.request.songTitle,
        kind: internal.request.kind,
        filename,
        tempPath: downloaded,
        size: info.size,
      });
      if (internal.abort.signal.aborted) return;
      this.update(internal, {
        state: 'done',
        progress: 1,
        copy,
        error: null,
      });
      this.logger.info(`[idolytics] import ${internal.job.id}: saved ${copy.relativePath}`);
    } catch (error) {
      if (internal.job.state === 'cancelled' || internal.abort.signal.aborted) {
        return;
      }
      const message =
        error instanceof MediaImportError
          ? error.message
          : (libraryFailureMessage(error) ??
            describeImportFailure('', 'The media could not be imported.'));
      this.markError(internal, message);
      this.logger.error(`[idolytics] import ${internal.job.id} failed: ${message}`);
    } finally {
      await rm(internal.tempDir, { recursive: true, force: true }).catch(() => undefined);
      this.scheduleExpiry(internal);
    }
  }

  private async fetchMetadata(
    internal: InternalJob,
    tools: ResolvedTools,
  ): Promise<{ title: string; durationSec: number | null }> {
    const metadata = await this.readMetadata(internal.request.url, tools, {
      cwd: internal.tempDir,
      signal: internal.abort.signal,
      timeoutMs: this.metadataTimeoutMs,
      fallbackTitle: internal.request.songTitle,
    });
    if (internal.job.state === 'cancelled') {
      throw new MediaImportError(499, 'Import cancelled.');
    }
    return metadata;
  }

  private async readMetadata(
    url: string,
    tools: ResolvedTools,
    options: {
      cwd: string;
      signal?: AbortSignal;
      timeoutMs: number;
      fallbackTitle: string;
    },
  ): Promise<{ title: string; durationSec: number | null }> {
    const args = [
      ...this.commonArguments(tools),
      '--no-playlist',
      '--dump-single-json',
      '--skip-download',
      '--no-warnings',
      '--',
      url,
    ];
    const result = await this.runYtDlpCommand(tools, args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    if (result.cancelled) {
      throw new MediaImportError(499, 'Import cancelled.');
    }
    if (result.timedOut) {
      throw new MediaImportError(504, 'yt-dlp took too long to read that link. Try again.');
    }
    if (result.code !== 0) {
      throw new MediaImportError(422, describeImportFailure(result.stderr));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch {
      const start = result.stdout.indexOf('{');
      const end = result.stdout.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          parsed = JSON.parse(result.stdout.slice(start, end + 1));
        } catch {
          parsed = null;
        }
      } else {
        parsed = null;
      }
    }
    if (!isRecord(parsed)) {
      throw new MediaImportError(502, 'yt-dlp returned unreadable media information.');
    }
    if (isPlaylistMetadata(parsed)) {
      throw new MediaImportError(400, 'Paste a single video link, not a playlist.');
    }
    if (
      parsed.is_live === true ||
      parsed.live_status === 'is_live' ||
      parsed.live_status === 'is_upcoming'
    ) {
      throw new MediaImportError(
        400,
        'Live streams cannot be measured. Use a finished video.',
      );
    }
    return {
      title: metadataTitle(parsed, options.fallbackTitle),
      durationSec: metadataDuration(parsed),
    };
  }

  private async download(
    internal: InternalJob,
    tools: ResolvedTools,
    title: string,
  ): Promise<string> {
    const quality = internal.request.quality;
    const args = [
      ...this.commonArguments(tools),
      '--no-playlist',
      '--newline',
      '--progress',
      '--progress-template',
      `download:${PROGRESS_MARKER}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.status)s`,
      '--retries',
      '3',
      '--fragment-retries',
      '3',
      '--socket-timeout',
      '30',
      '--concurrent-fragments',
      '4',
      '--no-warnings',
      '-f',
      formatSelector(internal.request.kind, quality),
      ...(internal.request.kind === 'audio'
        ? ['-x', '--audio-format', 'm4a', '--audio-quality', '0']
        : ['--merge-output-format', 'mp4']),
      '-o',
      path.join(internal.tempDir, 'download.%(ext)s'),
      '--',
      internal.request.url,
    ];
    let lastProgress = 0;
    const result = await this.runYtDlp(
      internal,
      tools,
      args,
      this.downloadTimeoutMs,
      (line) => {
        const parsed = parseImportProgressLine(line);
        if (!parsed || parsed.progress === null) return;
        if (internal.job.state !== 'downloading') return;
        const next = 0.05 + parsed.progress * 0.9;
        if (next >= lastProgress + 0.002 || parsed.progress >= 1) {
          lastProgress = next;
          this.update(internal, { progress: Math.min(0.95, next) });
        }
      },
    );
    if (internal.job.state === 'cancelled' || result.cancelled) {
      throw new MediaImportError(499, 'Import cancelled.');
    }
    if (result.timedOut) {
      throw new MediaImportError(504, 'The download timed out. Try again.');
    }
    if (result.code !== 0) {
      throw new MediaImportError(422, describeImportFailure(result.stderr));
    }
    const downloaded = await findDownloadedFile(internal.tempDir, internal.request.kind);
    if (!downloaded) {
      throw new MediaImportError(
        500,
        'The download finished but no media file was found. Try again.',
      );
    }
    this.update(internal, {
      state: 'processing',
      progress: 0.97,
      title: internal.job.title ?? title,
    });
    return downloaded;
  }

  private commonArguments(tools: ResolvedTools): string[] {
    const args: string[] = [];
    args.push(...cookieArguments(this.env));
    if (tools.jsRuntimes) args.push('--js-runtimes', 'node');
    if (
      tools.ffmpeg.available &&
      tools.ffmpeg.prefixArgs.length === 0 &&
      tools.ffmpeg.command !== 'ffmpeg'
    ) {
      args.push('--ffmpeg-location', tools.ffmpeg.command);
    }
    return args;
  }

  private runYtDlp(
    internal: InternalJob,
    tools: ResolvedTools,
    args: string[],
    timeoutMs: number,
    onStdoutLine?: (line: string) => void,
  ): Promise<CommandResult> {
    return this.runYtDlpCommand(
      tools,
      args,
      {
        cwd: internal.tempDir,
        timeoutMs,
        signal: internal.abort.signal,
      },
      onStdoutLine,
    );
  }

  private async runYtDlpCommand(
    tools: ResolvedTools,
    args: string[],
    options: { cwd: string; timeoutMs: number; signal?: AbortSignal },
    onStdoutLine?: (line: string) => void,
  ): Promise<CommandResult> {
    const result = await runCommand(tools.ytDlp, args, {
      cwd: options.cwd,
      env: this.env,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onStdoutLine,
    }).catch((error: unknown) => {
      if (errorCode(error) === 'ENOENT') {
        throw new MediaImportError(
          503,
          'yt-dlp is not installed. Install it or set IDOLYTICS_YTDLP_PATH, then restart the dev server.',
        );
      }
      throw error;
    });
    return result;
  }

  private scheduleExpiry(internal: InternalJob): void {
    if (internal.expiryTimer) clearTimeout(internal.expiryTimer);
    internal.expiryTimer = setTimeout(() => {
      this.jobs.delete(internal.job.id);
      void rm(internal.tempDir, { recursive: true, force: true }).catch(() => undefined);
    }, JOB_TTL_MS);
    internal.expiryTimer.unref?.();
  }

  private pruneExpiredJobs(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, internal] of this.jobs) {
      if (this.isTerminal(internal) && Date.parse(internal.job.updatedAt) < cutoff) {
        if (internal.expiryTimer) clearTimeout(internal.expiryTimer);
        this.jobs.delete(id);
      }
    }
  }

  private ensureTempCleanup(): Promise<void> {
    if (!this.cleanupPromise) {
      this.cleanupPromise = this.removeStaleImportDirs();
    }
    return this.cleanupPromise;
  }

  private async removeStaleImportDirs(): Promise<void> {
    await mkdir(this.tempRoot, { recursive: true }).catch(() => undefined);
    let entries;
    try {
      entries = await readdir(this.tempRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.name.startsWith(IMPORT_DIR_PREFIX)) continue;
      await rm(path.join(this.tempRoot, entry.name), {
        recursive: true,
        force: true,
      }).catch(() => undefined);
    }
  }

  private async getResolvedTools(force = false): Promise<ResolvedTools> {
    if (
      !force &&
      this.toolsCache &&
      Date.now() - this.toolsCache.at < TOOLS_CACHE_MS
    ) {
      return this.toolsCache.value;
    }
    if (!this.toolsPromise) {
      this.toolsPromise = this.detectTools()
        .then((value) => {
          this.toolsCache = { at: Date.now(), value };
          return value;
        })
        .finally(() => {
          this.toolsPromise = null;
        });
    }
    return this.toolsPromise;
  }

  private async detectTools(): Promise<ResolvedTools> {
    const [ytDlp, ffmpeg] = await Promise.all([
      this.resolveTool('ytDlp'),
      this.resolveTool('ffmpeg'),
    ]);
    let jsRuntimes = false;
    if (ytDlp.available) {
      const help = await runCommand(
        ytDlp,
        ['--help'],
        { timeoutMs: PROBE_TIMEOUT_MS, env: this.env },
      ).catch(() => null);
      jsRuntimes = Boolean(help?.stdout.includes('--js-runtimes'));
    }
    return {
      ytDlp,
      ffmpeg,
      jsRuntimes,
      cookies: cookieStatus(this.env),
    };
  }

  private async resolveTool(tool: 'ytDlp' | 'ffmpeg'): Promise<ResolvedTool> {
    const explicit = tool === 'ytDlp' ? this.explicitYtDlp : this.explicitFfmpeg;
    const candidates = explicit
      ? [explicit]
      : await this.defaultToolCandidates(tool);
    for (const candidate of candidates) {
      const version = await this.probeVersion(tool, candidate);
      if (version) {
        return { ...candidate, available: true, version };
      }
    }
    return {
      command:
        candidates[0]?.command ?? (tool === 'ytDlp' ? 'yt-dlp' : 'ffmpeg'),
      prefixArgs: candidates[0]?.prefixArgs ?? [],
      available: false,
      version: null,
    };
  }

  private async defaultToolCandidates(
    tool: 'ytDlp' | 'ffmpeg',
  ): Promise<ToolCommand[]> {
    const candidates: ToolCommand[] = [];
    const envKey =
      tool === 'ytDlp' ? 'IDOLYTICS_YTDLP_PATH' : 'IDOLYTICS_FFMPEG_PATH';
    const fromEnv = readEnv(this.env, envKey);
    if (fromEnv) candidates.push({ command: fromEnv, prefixArgs: [] });
    const binary = tool === 'ytDlp' ? 'yt-dlp' : 'ffmpeg';
    const extensions = process.platform === 'win32' ? ['.exe', ''] : ['', '.exe'];
    for (const extension of extensions) {
      candidates.push({
        command: path.join(this.root, 'bin', `${binary}${extension}`),
        prefixArgs: [],
      });
    }
    candidates.push({ command: binary, prefixArgs: [] });
    return candidates;
  }

  private async probeVersion(
    tool: 'ytDlp' | 'ffmpeg',
    candidate: ToolCommand,
  ): Promise<string | null> {
    if (path.isAbsolute(candidate.command)) {
      const info = await stat(candidate.command).catch(() => null);
      if (!info?.isFile()) return null;
    }
    const args = tool === 'ytDlp' ? ['--version'] : ['-version'];
    const result = await runCommand(candidate, args, {
      timeoutMs: PROBE_TIMEOUT_MS,
      env: this.env,
    }).catch(() => null);
    if (!result || result.code !== 0) return null;
    const version =
      tool === 'ytDlp'
        ? parseYtDlpVersion(result.stdout)
        : parseFfmpegVersion(result.stdout);
    return version || commandLabel(candidate);
  }
}
