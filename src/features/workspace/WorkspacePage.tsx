import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowUpRight, ChevronRight, Database, Plus, Sparkles, Users } from 'lucide-react';
import { memberColorPalette } from '../../domain/schema';
import { buildGlobalLeaderboard } from '../../domain/scoring';
import { workspaceStats } from '../../domain/stats';
import { Avatar } from '../../components/Avatar';
import { EmptyState } from '../../components/EmptyState';
import { Leaderboard } from '../../components/Leaderboard';
import { Modal } from '../../components/Modal';
import { StatsRow } from '../../components/StatsRow';
import { WorkspaceDataActions } from '../../components/WorkspaceDataActions';
import { formatClock } from '../../lib/time';
import { useNavStore } from '../../store/navStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

interface WorkspacePageProps {
  onOpenSettings: () => void;
}

const demoLine = [
  { label: 'Edge', score: '60%', tone: 'dim' },
  { label: 'Next', score: '80%', tone: 'mid' },
  { label: 'Anchor', score: '100%', tone: 'anchor' },
  { label: 'Next', score: '80%', tone: 'mid' },
  { label: 'Edge', score: '60%', tone: 'dim' },
];

export function WorkspacePage({ onOpenSettings }: WorkspacePageProps) {
  const workspace = useWorkspaceStore((state) => state.workspace);
  const createGroup = useWorkspaceStore((state) => state.createGroup);
  const goGroup = useNavStore((state) => state.goGroup);

  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupError, setGroupError] = useState<string | null>(null);

  const stats = useMemo(() => workspaceStats(workspace), [workspace]);
  const leaderboard = useMemo(() => buildGlobalLeaderboard(workspace), [workspace]);

  const handleCreateGroup = (event: FormEvent) => {
    event.preventDefault();
    const name = groupName.trim();
    if (!name) {
      setGroupError('Give the group a name.');
      return;
    }
    const id = createGroup(name);
    setNewGroupOpen(false);
    setGroupName('');
    setGroupError(null);
    goGroup(id);
  };

  return (
    <div className="page workspace-page">
      <section className="workspace-hero">
        <div className="hero-watermark" aria-hidden="true">
          CENTER
        </div>
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="live-dot" aria-hidden="true" />
            K-pop performance analytics · Choreo module 01
          </p>
          <h1>
            The stage,
            <br />
            <em>quantified.</em>
          </h1>
          <p className="hero-sub">
            Plot every formation, score every second, and settle the center debate with data.
            Then map every vocal line, ad-lib, and shared part across the song.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary btn-large" onClick={() => setNewGroupOpen(true)}>
              <Plus size={17} />
              New group
            </button>
            <button type="button" className="btn btn-ghost btn-large" onClick={onOpenSettings}>
              <Sparkles size={16} />
              Scoring rules
            </button>
          </div>
        </div>

        <aside className="hero-demo" aria-label="Example formation scoring">
          <div className="hero-demo-header">
            <span className="eyebrow">Formation sample</span>
            <span className="status-chip">5 members</span>
          </div>
          <div className="demo-stage">
            <span className="demo-audience">audience</span>
            <div className="demo-line">
              {demoLine.map((slot, index) => (
                <div key={`${slot.label}-${index}`} className={`demo-token ${slot.tone}`}>
                  <span className="demo-avatar">{index + 1}</span>
                  <span className="demo-score mono">{slot.score}</span>
                  <span className="demo-label">{slot.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="hero-demo-footer">
            <div>
              <span className="demo-kicker mono">RULE 01</span>
              <p>Anchor gets 100%. Rank distance decays the rest.</p>
            </div>
            <div>
              <span className="demo-kicker mono">RULE 02</span>
              <p>Hidden behind a taller posture? Score drops to zero.</p>
            </div>
          </div>
        </aside>
      </section>

      <StatsRow
        className="workspace-stats"
        items={[
          { label: 'Groups', value: String(stats.groups).padStart(2, '0') },
          { label: 'Members', value: String(stats.members).padStart(2, '0') },
          { label: 'Songs', value: String(stats.songs).padStart(2, '0') },
          { label: 'Choreo logged', value: formatClock(stats.choreoSeconds), accent: true },
        ]}
      />

      <div className="workspace-grid">
        <section className="panel groups-panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">Your roster</p>
              <h2>Groups</h2>
            </div>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setNewGroupOpen(true)}>
              <Plus size={15} />
              Add group
            </button>
          </header>

          {workspace.groups.length === 0 ? (
            <EmptyState
              icon={<Users size={28} />}
              eyebrow="Empty stage"
              title="Your first group starts here"
              message="Add a group, build its roster, then log the first choreo formation."
              action={
                <button type="button" className="btn btn-primary" onClick={() => setNewGroupOpen(true)}>
                  <Plus size={16} />
                  Create group
                </button>
              }
            />
          ) : (
            <div className="group-grid">
              {workspace.groups.map((group) => {
                const groupStats = workspaceStats({
                  ...workspace,
                  groups: [group],
                });
                const top = buildGlobalLeaderboard({
                  ...workspace,
                  groups: [group],
                })[0];
                const accent = group.members[0]?.color ?? memberColorPalette[0];
                return (
                  <button
                    key={group.id}
                    type="button"
                    className="group-card"
                    onClick={() => goGroup(group.id)}
                  >
                    <div className="group-card-top">
                      <div className="avatar-stack" aria-hidden="true">
                        {group.members.slice(0, 5).map((member) => (
                          <Avatar
                            key={member.id}
                            name={member.name}
                            face={member.face}
                            color={member.color}
                            size={34}
                          />
                        ))}
                        {group.members.length === 0 ? (
                          <span className="avatar avatar-empty" style={{ '--member-color': accent } as CSSProperties}>
                            <Users size={16} />
                          </span>
                        ) : null}
                      </div>
                      <ChevronRight size={17} className="group-card-arrow" />
                    </div>
                    <div className="group-card-body">
                      <h3>{group.name.trim() || 'Untitled group'}</h3>
                      <p className="group-card-meta">
                        {group.members.length} {group.members.length === 1 ? 'member' : 'members'} ·{' '}
                        {group.songs.length} {group.songs.length === 1 ? 'song' : 'songs'}
                      </p>
                    </div>
                    <div className="group-card-foot">
                      <span className="group-card-choreo mono">
                        {formatClock(groupStats.choreoSeconds)} logged
                      </span>
                      {top ? (
                        <span className="group-card-top-member" title="Current group leader">
                          <span className="mini-color-dot" style={{ backgroundColor: top.color }} />
                          {top.memberName} · {top.percentage.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="group-card-top-member is-muted">No choreo yet</span>
                      )}
                    </div>
                    <span className="group-card-accent" style={{ backgroundColor: accent }} aria-hidden="true" />
                  </button>
                );
              })}
              <button type="button" className="group-card group-card-new" onClick={() => setNewGroupOpen(true)}>
                <Plus size={22} />
                <span>New group</span>
              </button>
            </div>
          )}
        </section>

        <Leaderboard
          rows={leaderboard}
          showGroup
          limit={8}
          eyebrow="All groups · choreo"
          title="Global leaderboard"
          emptyMessage="Formations logged across groups will rank here automatically."
          compact
        />
      </div>

      <section className="panel data-panel">
        <div className="data-panel-copy">
          <p className="eyebrow">Workspace file</p>
          <h2>Own your data</h2>
          <p>
            Everything autosaves in this browser. Export a JSON file to back it up or move it to
            another machine. Face photos travel inside the file.
          </p>
          <div className="data-status">
            <Database size={15} aria-hidden="true" />
            <span>
              {stats.groups} {stats.groups === 1 ? 'group' : 'groups'} · {stats.songs}{' '}
              {stats.songs === 1 ? 'song' : 'songs'} · {stats.formations}{' '}
              {stats.formations === 1 ? 'formation' : 'formations'}
            </span>
          </div>
        </div>
        <WorkspaceDataActions />
        <ArrowUpRight size={18} className="data-panel-mark" aria-hidden="true" />
      </section>

      <Modal
        open={newGroupOpen}
        onClose={() => setNewGroupOpen(false)}
        title="New group"
        eyebrow="Start the dossier"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setNewGroupOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="new-group-form" className="btn btn-primary">
              Create group
            </button>
          </>
        }
      >
        <form id="new-group-form" onSubmit={handleCreateGroup} className="stack-form">
          <label className="field">
            <span className="field-label">Group name</span>
            <input
              className="input"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="e.g. aespa, LOONA, IVE"
              maxLength={80}
              autoComplete="off"
            />
          </label>
          {groupError ? <p className="form-error">{groupError}</p> : null}
        </form>
      </Modal>
    </div>
  );
}
