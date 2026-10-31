import { set } from 'idb-keyval';
import { workspaceSchema, type Workspace } from '../domain/schema';
import { validateWorkspaceIntegrity } from '../domain/integrity';
import { migrateLegacyMemberColors } from '../domain/migrations';
import { STORAGE_KEY } from './workspaceStore';

export interface WorkspaceParseResult {
  ok: boolean;
  workspace?: Workspace;
  errors: string[];
}

export async function saveWorkspaceToIdb(workspace: Workspace): Promise<void> {
  await set(STORAGE_KEY, workspace);
}

export function serializeWorkspace(workspace: Workspace): string {
  return JSON.stringify({ ...workspace, savedAt: new Date().toISOString() }, null, 2);
}

export function parseWorkspaceJson(text: string): WorkspaceParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['The file is not valid JSON.'] };
  }
  const parsed = workspaceSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 8).map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
        return `${path}${issue.message}`;
      }),
    };
  }
  const integrityErrors = validateWorkspaceIntegrity(parsed.data);
  if (integrityErrors.length > 0) {
    return { ok: false, errors: integrityErrors.slice(0, 8) };
  }
  return { ok: true, workspace: migrateLegacyMemberColors(parsed.data), errors: [] };
}

interface WritableFileLike {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}

interface FileHandleLike {
  createWritable: () => Promise<WritableFileLike>;
}

type SaveFilePicker = (options?: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<FileHandleLike>;

function suggestedFileName(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `idolytics-${date}.json`;
}

export function downloadWorkspace(workspace: Workspace): void {
  const blob = new Blob([serializeWorkspace(workspace)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedFileName();
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveWorkspaceToDisk(
  workspace: Workspace,
): Promise<'saved' | 'downloaded' | 'cancelled'> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (!picker) {
    downloadWorkspace(workspace);
    return 'downloaded';
  }
  try {
    const handle = await picker({
      suggestedName: suggestedFileName(),
      types: [{ description: 'Idolytics workspace', accept: { 'application/json': ['.json'] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(
      new Blob([serializeWorkspace(workspace)], { type: 'application/json' }),
    );
    await writable.close();
    return 'saved';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    throw error;
  }
}
