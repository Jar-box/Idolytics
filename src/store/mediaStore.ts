import { create } from 'zustand';
import type { Workspace } from '../domain/schema';
import {
  chooseNewerManifest,
  getMediaStatus,
  mediaErrorMessage,
  mediaLibrarySupported,
  mediaSnapshotSignature,
  syncMediaLibrary,
  workspaceToMediaSnapshot,
} from '../lib/mediaSync';
import type {
  MediaCopyResponse,
  MediaGroupEntry,
  MediaImportQuality,
  MediaImportTools,
  MediaManifest,
  MediaSongEntry,
} from '../lib/mediaTypes';

export type MediaLibraryStatus = 'checking' | 'ready' | 'unavailable';

const COPY_SETTING_KEY = 'idolytics.media.copyEnabled.v1';
const IMPORT_QUALITY_KEY = 'idolytics.media.importQuality.v1';
const IMPORT_QUALITIES: readonly MediaImportQuality[] = ['720', '1080', 'best'];

function readCopyEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(COPY_SETTING_KEY) !== 'off';
  } catch {
    return true;
  }
}

function readImportQuality(): MediaImportQuality {
  if (typeof window === 'undefined') return '1080';
  try {
    const stored = window.localStorage.getItem(IMPORT_QUALITY_KEY);
    return IMPORT_QUALITIES.includes(stored as MediaImportQuality)
      ? (stored as MediaImportQuality)
      : '1080';
  } catch {
    return '1080';
  }
}

let operationQueue: Promise<unknown> = Promise.resolve();
let queuedSignatures = new Set<string>();
let activeSyncs = 0;
let lastAppliedSignature: string | null = null;

function enqueueMediaOperation<T>(task: () => Promise<T>): Promise<T> {
  const run = operationQueue.then(task, task);
  operationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

interface MediaState {
  status: MediaLibraryStatus;
  manifest: MediaManifest | null;
  libraryPath: string | null;
  absolutePath: string | null;
  lastSyncedAt: string | null;
  error: string | null;
  syncing: boolean;
  copyEnabled: boolean;
  tools: MediaImportTools | null;
  importQuality: MediaImportQuality;
  refresh: () => Promise<void>;
  sync: (workspace: Workspace, force?: boolean) => Promise<void>;
  registerCopy: (input: {
    groupName: string;
    songTitle: string;
    result: MediaCopyResponse;
  }) => void;
  setCopyEnabled: (enabled: boolean) => void;
  setImportQuality: (quality: MediaImportQuality) => void;
  clearError: () => void;
}

export const useMediaStore = create<MediaState>((set, get) => ({
  status: mediaLibrarySupported() ? 'checking' : 'unavailable',
  manifest: null,
  libraryPath: null,
  absolutePath: null,
  lastSyncedAt: null,
  error: null,
  syncing: false,
  copyEnabled: readCopyEnabled(),
  tools: null,
  importQuality: readImportQuality(),

  refresh: () => {
    if (!mediaLibrarySupported()) {
      set({ status: 'unavailable', syncing: false });
      return Promise.resolve();
    }
    return enqueueMediaOperation(async () => {
      try {
        const payload = await getMediaStatus();
        set((state) => ({
          status: 'ready',
          manifest: chooseNewerManifest(state.manifest, payload.manifest),
          libraryPath: payload.libraryPath,
          absolutePath: payload.absolutePath,
          lastSyncedAt: payload.syncedAt,
          tools: payload.tools,
          error: null,
        }));
      } catch (error) {
        set({ status: 'unavailable', error: mediaErrorMessage(error) });
      }
    });
  },

  sync: (workspace, force = false) => {
    if (!mediaLibrarySupported()) {
      set({ status: 'unavailable', syncing: false });
      return Promise.resolve();
    }
    const snapshot = workspaceToMediaSnapshot(workspace);
    const signature = mediaSnapshotSignature(snapshot);
    if (!force && lastAppliedSignature === signature && get().status === 'ready') {
      return Promise.resolve();
    }
    if (!force && queuedSignatures.has(signature)) return Promise.resolve();
    queuedSignatures.add(signature);
    activeSyncs += 1;
    set({ syncing: true });

    return enqueueMediaOperation(async () => {
      try {
        const payload = await syncMediaLibrary(snapshot);
        lastAppliedSignature = signature;
        set((state) => ({
          status: 'ready',
          manifest: chooseNewerManifest(state.manifest, payload.manifest),
          libraryPath: payload.libraryPath,
          absolutePath: payload.absolutePath,
          lastSyncedAt: payload.syncedAt,
          tools: payload.tools,
          error: null,
        }));
      } catch (error) {
        set({ status: 'unavailable', error: mediaErrorMessage(error) });
      } finally {
        queuedSignatures.delete(signature);
        activeSyncs = Math.max(0, activeSyncs - 1);
        if (activeSyncs === 0) set({ syncing: false });
      }
    });
  },

  registerCopy: (input) => {
    const state = get();
    const manifest = state.manifest;
    if (!manifest) {
      void state.refresh();
      return;
    }
    const group = manifest.groups[input.result.groupId];
    const song = group?.songs[input.result.songId];
    const nextSong: MediaSongEntry = song
      ? {
          ...song,
          title: input.songTitle,
          folder: input.result.songFolder,
          copies: { ...song.copies, [input.result.kind]: input.result.copy },
        }
      : {
          title: input.songTitle,
          folder: input.result.songFolder,
          copies: { [input.result.kind]: input.result.copy },
        };
    const nextGroup: MediaGroupEntry = {
      name: group?.name ?? input.groupName,
      folder: input.result.groupFolder,
      songs: { ...(group?.songs ?? {}), [input.result.songId]: nextSong },
    };
    set({
      manifest: {
        ...manifest,
        revision: Math.max(manifest.revision, input.result.manifestRevision),
        updatedAt: new Date().toISOString(),
        groups: { ...manifest.groups, [input.result.groupId]: nextGroup },
      },
      error: null,
    });
  },

  setCopyEnabled: (enabled) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(COPY_SETTING_KEY, enabled ? 'on' : 'off');
      } catch {
        // The preference is still kept for this session.
      }
    }
    set({ copyEnabled: enabled });
  },

  setImportQuality: (quality) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(IMPORT_QUALITY_KEY, quality);
      } catch {
        // The preference is still kept for this session.
      }
    }
    set({ importQuality: quality });
  },

  clearError: () => set({ error: null }),
}));
