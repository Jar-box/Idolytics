import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Activity,
  BookOpen,
  Database,
  Download,
  FolderSync,
  Globe,
  HardDrive,
  Layers,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Modal } from '../../components/Modal';
import { WorkspaceBackupPanel } from '../../components/WorkspaceBackupPanel';
import { WorkspaceDataActions } from '../../components/WorkspaceDataActions';
import { workspaceStats } from '../../domain/stats';
import {
  CANONICAL_DEV_ORIGIN,
  getStorageOrigin,
  isDevOriginMismatch,
} from '../../lib/devOrigin';
import { countMediaCopies, mediaLibrarySupported } from '../../lib/mediaSync';
import { formatClock } from '../../lib/time';
import { useBackupStore } from '../../store/backupStore';
import { useMediaStore } from '../../store/mediaStore';
import { useToastStore } from '../../store/toastStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = 'data' | 'media' | 'postures' | 'rules';

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const workspace = useWorkspaceStore((state) => state.workspace);
  const addPosture = useWorkspaceStore((state) => state.addPosture);
  const updatePosture = useWorkspaceStore((state) => state.updatePosture);
  const deletePosture = useWorkspaceStore((state) => state.deletePosture);
  const mediaStatus = useMediaStore((state) => state.status);
  const mediaManifest = useMediaStore((state) => state.manifest);
  const mediaLibraryPath = useMediaStore((state) => state.libraryPath);
  const mediaLastSyncedAt = useMediaStore((state) => state.lastSyncedAt);
  const mediaError = useMediaStore((state) => state.error);
  const mediaSyncing = useMediaStore((state) => state.syncing);
  const mediaCopyEnabled = useMediaStore((state) => state.copyEnabled);
  const mediaTools = useMediaStore((state) => state.tools);
  const refreshMedia = useMediaStore((state) => state.refresh);
  const syncMedia = useMediaStore((state) => state.sync);
  const setMediaCopyEnabled = useMediaStore((state) => state.setCopyEnabled);
  const refreshBackups = useBackupStore((state) => state.refresh);
  const pushToast = useToastStore((state) => state.push);

  const [tab, setTab] = useState<SettingsTab>('data');
  const [newPostureLabel, setNewPostureLabel] = useState('');
  const [newPostureHeight, setNewPostureHeight] = useState(2);

  const stats = useMemo(() => workspaceStats(workspace), [workspace]);
  const postureUsage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of workspace.groups) {
      for (const song of group.songs) {
        for (const section of song.sections) {
          for (const formation of section.formations) {
            for (const placement of formation.placements) {
              counts.set(placement.postureId, (counts.get(placement.postureId) ?? 0) + 1);
            }
          }
        }
      }
    }
    return counts;
  }, [workspace]);

  const mediaCounts = useMemo(() => countMediaCopies(mediaManifest), [mediaManifest]);
  const mediaGroupCount = mediaManifest
    ? Object.keys(mediaManifest.groups).length
    : 0;
  const mediaSongCount = mediaManifest
    ? Object.values(mediaManifest.groups).reduce(
        (total, group) => total + Object.keys(group.songs).length,
        0,
      )
    : 0;
  const mediaStatusText =
    mediaStatus === 'ready'
      ? mediaSyncing
        ? 'Syncing'
        : 'Ready'
      : mediaStatus === 'checking'
        ? 'Checking'
        : 'Unavailable';
  const mediaLastSyncText =
    mediaLastSyncedAt && new Date(mediaLastSyncedAt).getTime() > 0
      ? new Date(mediaLastSyncedAt).toLocaleString()
      : 'Not yet';
  const mediaToolsReady = Boolean(
    mediaTools?.ytDlp.available && mediaTools?.ffmpeg.available,
  );
  const cookiesText = mediaTools?.cookies === 'browser'
    ? 'Browser export'
    : mediaTools?.cookies === 'file'
      ? 'Cookie file'
      : 'None';
  const storageOrigin = getStorageOrigin();
  const originMismatch = isDevOriginMismatch();

  useEffect(() => {
    if (open && tab === 'media') void refreshMedia();
  }, [open, tab, refreshMedia]);

  useEffect(() => {
    if (open && tab === 'data') void refreshBackups();
  }, [open, tab, refreshBackups]);

  const handleAddPosture = (event: FormEvent) => {
    event.preventDefault();
    const label = newPostureLabel.trim();
    if (!label) {
      pushToast('Give the posture a label.', 'error');
      return;
    }
    if (!Number.isFinite(newPostureHeight) || newPostureHeight < 0 || newPostureHeight > 20) {
      pushToast('Height rank must be between 0 and 20.', 'error');
      return;
    }
    addPosture(label, Math.round(newPostureHeight));
    setNewPostureLabel('');
    setNewPostureHeight(2);
    pushToast('Posture added.', 'success');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      eyebrow="Workspace controls"
      size="lg"
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <button
            type="button"
            className={tab === 'data' ? 'is-active' : ''}
            onClick={() => setTab('data')}
          >
            <Database size={16} />
            Data
          </button>
          <button
            type="button"
            className={tab === 'media' ? 'is-active' : ''}
            onClick={() => setTab('media')}
          >
            <HardDrive size={16} />
            Media
          </button>
          <button
            type="button"
            className={tab === 'postures' ? 'is-active' : ''}
            onClick={() => setTab('postures')}
          >
            <Layers size={16} />
            Postures
          </button>
          <button
            type="button"
            className={tab === 'rules' ? 'is-active' : ''}
            onClick={() => setTab('rules')}
          >
            <BookOpen size={16} />
            Scoring rules
          </button>
        </nav>

        <div className="settings-content">
          {tab === 'data' ? (
            <div className="settings-section">
              <div className="settings-heading">
                <p className="eyebrow">Local-first</p>
                <h3>Workspace data</h3>
              </div>
              <p className="settings-copy">
                Idolytics autosaves every change to this browser. Export a JSON file for backup or
                to move the workspace. Face photos are embedded; video files are not.
              </p>
              <div className="settings-fact-grid">
                <div>
                  <span>Groups</span>
                  <strong className="mono">{stats.groups}</strong>
                </div>
                <div>
                  <span>Songs</span>
                  <strong className="mono">{stats.songs}</strong>
                </div>
                <div>
                  <span>Formations</span>
                  <strong className="mono">{stats.formations}</strong>
                </div>
                <div>
                  <span>Choreo logged</span>
                  <strong className="mono">{formatClock(stats.choreoSeconds)}</strong>
                </div>
              </div>
              <div className={`settings-note ${originMismatch ? 'is-warning' : ''}`}>
                <Globe size={15} />
                <p>
                  Storage origin <code>{storageOrigin}</code>.{' '}
                  {originMismatch ? (
                    <>
                      This is not the pinned dev origin <code>{CANONICAL_DEV_ORIGIN}</code>.
                      Browser data saved here is separate from your main workspace. Local backups
                      are shared across ports.
                    </>
                  ) : (
                    <>Browser data belongs to this exact address.</>
                  )}
                </p>
              </div>
              <WorkspaceDataActions showReset />
              <WorkspaceBackupPanel />
              <div className="settings-note">
                <Activity size={15} />
                <p>
                  Autosave runs while the tab is open. If a save ever fails, the header shows a
                  warning and the last successful data stays in this browser.
                </p>
              </div>
            </div>
          ) : null}

          {tab === 'media' ? (
            <div className="settings-section">
              <div className="settings-heading">
                <p className="eyebrow">Local development</p>
                <h3>Media library</h3>
              </div>
              <p className="settings-copy">
                Linked audio and video are copied into a folder inside this project so songs reopen
                without re-linking. The dev server keeps folders in step with group and song names.
              </p>
              <div className="settings-fact-grid media-status-grid">
                <div>
                  <span>Status</span>
                  <strong className={mediaStatus === 'ready' ? 'is-ready' : ''}>
                    {mediaStatusText}
                  </strong>
                </div>
                <div>
                  <span>Library</span>
                  <strong className="mono media-path" title={mediaLibraryPath ?? 'media'}>
                    {mediaLibraryPath ?? 'media'}/
                  </strong>
                </div>
                <div>
                  <span>Tracked</span>
                  <strong className="mono">
                    {mediaGroupCount} / {mediaSongCount}
                  </strong>
                </div>
                <div>
                  <span>Copied files</span>
                  <strong className="mono">
                    {mediaCounts.audio + mediaCounts.video}
                  </strong>
                </div>
              </div>
              <div className="media-settings-actions">
                <label className="media-toggle">
                  <input
                    type="checkbox"
                    checked={mediaCopyEnabled}
                    onChange={(event) => setMediaCopyEnabled(event.target.checked)}
                  />
                  <span className="media-toggle-track" aria-hidden="true">
                    <span />
                  </span>
                  <span className="media-toggle-copy">
                    <strong>Auto-copy linked media</strong>
                    <small>
                      Copy audio and video into the project library as soon as you link them.
                    </small>
                  </span>
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  disabled={mediaSyncing}
                  onClick={() => void syncMedia(workspace, true)}
                >
                  <RefreshCw
                    size={13}
                    className={mediaSyncing ? 'is-spinning' : undefined}
                  />
                  {mediaSyncing ? 'Syncing…' : 'Sync now'}
                </button>
              </div>
              <div className="media-status-foot mono">
                <span>Last sync · {mediaLastSyncText}</span>
                <span>
                  {mediaCounts.audio} audio · {mediaCounts.video} video
                </span>
              </div>

              <div className="settings-heading media-import-settings-heading">
                <p className="eyebrow">URL imports</p>
                <h3>Download tools</h3>
              </div>
              <p className="settings-copy">
                Paste a link into the video or audio panel to download it straight into this
                project&apos;s media folder. Downloads run locally through yt-dlp and need ffmpeg to
                finish.
              </p>
              <div className="settings-fact-grid media-status-grid">
                <div>
                  <span>yt-dlp</span>
                  <strong className={mediaTools?.ytDlp.available ? 'is-ready' : ''}>
                    {mediaTools
                      ? mediaTools.ytDlp.available
                        ? (mediaTools.ytDlp.version ?? 'Ready')
                        : 'Not found'
                      : 'Checking…'}
                  </strong>
                </div>
                <div>
                  <span>ffmpeg</span>
                  <strong className={mediaTools?.ffmpeg.available ? 'is-ready' : ''}>
                    {mediaTools
                      ? mediaTools.ffmpeg.available
                        ? (mediaTools.ffmpeg.version ?? 'Ready')
                        : 'Not found'
                      : 'Checking…'}
                  </strong>
                </div>
                <div>
                  <span>Cookies</span>
                  <strong className="mono">{cookiesText}</strong>
                </div>
                <div>
                  <span>URL import</span>
                  <strong className={mediaToolsReady ? 'is-ready' : ''}>
                    {mediaToolsReady ? 'Ready' : mediaTools ? 'Unavailable' : 'Checking…'}
                  </strong>
                </div>
              </div>
              {mediaTools && !mediaToolsReady ? (
                <div className="settings-note is-warning">
                  <TriangleAlert size={15} />
                  <p>
                    Install yt-dlp and ffmpeg, make both available on PATH, then restart the dev
                    server. You can also point to custom binaries with{' '}
                    <code>IDOLYTICS_YTDLP_PATH</code> and <code>IDOLYTICS_FFMPEG_PATH</code>.
                  </p>
                </div>
              ) : (
                <div className="settings-note">
                  <Download size={15} />
                  <p>
                    For private or age-restricted links, start the dev server with{' '}
                    <code>IDOLYTICS_YTDLP_COOKIES_FROM_BROWSER=chrome</code> or set{' '}
                    <code>IDOLYTICS_YTDLP_COOKIES_FILE</code> to a cookies.txt file.
                  </p>
                </div>
              )}
              {mediaError ? (
                <div className="settings-note is-warning">
                  <TriangleAlert size={15} />
                  <p>{mediaError}</p>
                </div>
              ) : null}
              <div className="settings-note">
                <FolderSync size={15} />
                <p>
                  Folders follow group and song names: <code>media/groups/&lt;Group&gt;/songs/&lt;Song&gt;</code>.
                  Renames move the folder, while deleting a group or song leaves its media in place.
                  Files are never uploaded or included in workspace exports.
                </p>
              </div>
              {!mediaLibrarySupported() ? (
                <div className="settings-note">
                  <HardDrive size={15} />
                  <p>
                    Media library copying runs only with the local dev server. Production builds use
                    the regular re-link flow and keep files on your device.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'postures' ? (
            <div className="settings-section">
              <div className="settings-heading">
                <p className="eyebrow">Visibility system</p>
                <h3>Posture levels</h3>
              </div>
              <p className="settings-copy">
                Larger height ranks block shorter or equal members standing directly behind them in
                the same column. Posture never changes the score decay, only visibility.
              </p>
              <div className="posture-list">
                {workspace.settings.postures.map((posture) => {
                  const usage = postureUsage.get(posture.id) ?? 0;
                  return (
                    <div key={posture.id} className="posture-row">
                      <label className="field posture-label-field">
                        <span className="field-label">Label</span>
                        <input
                          className="input"
                          value={posture.label}
                          onChange={(event) =>
                            updatePosture(posture.id, { label: event.target.value })
                          }
                          maxLength={80}
                        />
                      </label>
                      <label className="field posture-height-field">
                        <span className="field-label">Height rank</span>
                        <input
                          type="number"
                          className="input mono"
                          min={0}
                          max={20}
                          value={posture.height}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (!Number.isFinite(value)) return;
                            updatePosture(posture.id, {
                              height: Math.max(0, Math.min(20, Math.round(value))),
                            });
                          }}
                        />
                      </label>
                      <span className="posture-usage mono">
                        {usage} {usage === 1 ? 'use' : 'uses'}
                      </span>
                      <button
                        type="button"
                        className="icon-button icon-button-small"
                        disabled={usage > 0 || workspace.settings.postures.length <= 1}
                        onClick={() => {
                          const removed = deletePosture(posture.id);
                          if (!removed) {
                            pushToast(
                              'A posture that is in use cannot be deleted. Reassign those placements first.',
                              'error',
                            );
                          }
                        }}
                        title={
                          usage > 0
                            ? 'In use by placements'
                            : workspace.settings.postures.length <= 1
                              ? 'Keep at least one posture'
                              : 'Delete posture'
                        }
                        aria-label={`Delete posture ${posture.label || ''}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <form className="posture-add-form" onSubmit={handleAddPosture}>
                <label className="field">
                  <span className="field-label">New posture</span>
                  <input
                    className="input"
                    value={newPostureLabel}
                    onChange={(event) => setNewPostureLabel(event.target.value)}
                    placeholder="e.g. Kneeling"
                    maxLength={80}
                  />
                </label>
                <label className="field posture-height-field">
                  <span className="field-label">Height</span>
                  <input
                    type="number"
                    className="input mono"
                    min={0}
                    max={20}
                    value={newPostureHeight}
                    onChange={(event) => setNewPostureHeight(Number(event.target.value))}
                  />
                </label>
                <button type="submit" className="btn btn-primary btn-small">
                  <Plus size={14} />
                  Add
                </button>
              </form>
            </div>
          ) : null}

          {tab === 'rules' ? (
            <div className="settings-section">
              <div className="settings-heading">
                <p className="eyebrow">The math</p>
                <h3>Scoring rules</h3>
              </div>
              <ol className="rules-list">
                <li>
                  <strong>N</strong> is the number of members placed in the formation. Hidden
                  members still count; unplaced members do not.
                </li>
                <li>
                  <strong>Anchors</strong> are selected per formation. Every anchor receives full
                  marks. With more than one anchor, each uses the nearest one.
                </li>
                <li>
                  <strong>Distance</strong> is straight-line distance in grid cells to the nearest
                  anchor.
                </li>
                <li>
                  <strong>Dense ranking</strong> collapses ties and empty gaps: anchors rank 0, the
                  next distinct distance rank 1, and so on.
                </li>
                <li>
                  <strong>Score fraction</strong> = <span className="mono">(N − rank) / N</span>.
                  Hidden members score 0.
                </li>
                <li>
                  <strong>Visibility:</strong> a member is blocked when anyone in front in the same
                  column has a posture height greater than or equal to theirs. Front means a lower
                  row number.
                </li>
                <li>
                  <strong>Time weighting:</strong> a formation's points are its fraction multiplied
                  by its duration in seconds.
                </li>
                <li>
                  <strong>Leaderboards</strong> normalize by total choreo seconds, so a short song
                  cannot beat a long one just by volume.
                </li>
              </ol>
              <div className="settings-note">
                <Activity size={15} />
                <p>
                  Anchors can technically be hidden. The editor shows the blocked state so you can
                  fix the staging.
                </p>
              </div>
              <p className="settings-version mono">IDOLYTICS · WORKSPACE FORMAT V1</p>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
