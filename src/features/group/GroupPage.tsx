import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Crown,
  Music2,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { buildGroupLeaderboard, scoreSong } from '../../domain/scoring';
import { choreoCounts, groupStats as computeGroupStats } from '../../domain/stats';
import type { Member, Song } from '../../domain/schema';
import { Avatar } from '../../components/Avatar';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Leaderboard } from '../../components/Leaderboard';
import { StatsRow } from '../../components/StatsRow';
import { formatClock, roundTo } from '../../lib/time';
import { useNavStore } from '../../store/navStore';
import { useToastStore } from '../../store/toastStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { MemberModal } from './MemberModal';
import { SongModal } from '../song/SongModal';

interface GroupPageProps {
  groupId: string;
}

export function GroupPage({ groupId }: GroupPageProps) {
  const workspace = useWorkspaceStore((state) => state.workspace);
  const updateGroup = useWorkspaceStore((state) => state.updateGroup);
  const deleteGroup = useWorkspaceStore((state) => state.deleteGroup);
  const deleteMember = useWorkspaceStore((state) => state.deleteMember);
  const deleteSong = useWorkspaceStore((state) => state.deleteSong);
  const goWorkspace = useNavStore((state) => state.goWorkspace);
  const goSong = useNavStore((state) => state.goSong);
  const pushToast = useToastStore((state) => state.push);

  const group = workspace.groups.find((entry) => entry.id === groupId);

  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [songModalOpen, setSongModalOpen] = useState(false);
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [memberToDelete, setMemberToDelete] = useState<Member | null>(null);
  const [songToDelete, setSongToDelete] = useState<Song | null>(null);
  const [groupDeleteOpen, setGroupDeleteOpen] = useState(false);

  const stats = useMemo(
    () => (group ? computeGroupStats(group) : null),
    [group],
  );
  const leaderboard = useMemo(
    () => (group ? buildGroupLeaderboard(group, workspace.settings.postures) : []),
    [group, workspace.settings.postures],
  );
  const leaderboardByMember = useMemo(
    () => new Map(leaderboard.map((row, index) => [row.memberId, { ...row, rank: index + 1 }])),
    [leaderboard],
  );
  const songSummaries = useMemo(() => {
    if (!group) return [];
    const memberById = new Map(group.members.map((member) => [member.id, member]));
    return group.songs.map((song) => {
      const counts = choreoCounts(song);
      const score = scoreSong(song, workspace.settings.postures);
      const topRow = score.rows[0];
      const topMember = topRow ? memberById.get(topRow.memberId) : undefined;
      return {
        song,
        counts,
        topRow,
        topMember,
      };
    });
  }, [group, workspace.settings.postures]);

  if (!group || !stats) {
    return (
      <div className="page">
        <EmptyState
          icon={<Users size={28} />}
          eyebrow="Missing group"
          title="This group is no longer here"
          message="It may have been deleted or was not part of the imported workspace."
          action={
            <button type="button" className="btn btn-primary" onClick={goWorkspace}>
              <ArrowLeft size={16} />
              Back to workspace
            </button>
          }
        />
      </div>
    );
  }

  const openAddMember = () => {
    setEditingMember(null);
    setMemberModalOpen(true);
  };

  const openEditMember = (member: Member) => {
    setEditingMember(member);
    setMemberModalOpen(true);
  };

  const openAddSong = () => {
    setEditingSong(null);
    setSongModalOpen(true);
  };

  const openEditSong = (song: Song) => {
    setEditingSong(song);
    setSongModalOpen(true);
  };

  return (
    <div className="page group-page">
      <section className="group-hero">
        <div className="group-hero-copy">
          <p className="eyebrow">
            <span className="live-dot" aria-hidden="true" />
            Group dossier
          </p>
          <input
            className="hero-title-input"
            value={group.name}
            onChange={(event) => updateGroup(group.id, { name: event.target.value })}
            placeholder="Untitled group"
            aria-label="Group name"
            maxLength={80}
          />
          <div className="hero-meta-row">
            <span>
              {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
            </span>
            <span>
              {group.songs.length} {group.songs.length === 1 ? 'song' : 'songs'}
            </span>
            <span>{formatClock(stats.choreoSeconds)} choreo logged</span>
            <span>
              {stats.formations} {stats.formations === 1 ? 'formation' : 'formations'}
            </span>
          </div>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary" onClick={openAddMember}>
              <UserPlus size={16} />
              Add member
            </button>
            <button type="button" className="btn btn-ghost" onClick={openAddSong}>
              <Music2 size={16} />
              Add song
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon-label btn-danger-text"
              onClick={() => setGroupDeleteOpen(true)}
            >
              <Trash2 size={16} />
              Delete group
            </button>
          </div>
        </div>
        <div className="group-hero-roster" aria-hidden="true">
          {group.members.slice(0, 8).map((member) => (
            <Avatar
              key={member.id}
              name={member.name}
              face={member.face}
              color={member.color}
              size={72}
            />
          ))}
          {group.members.length === 0 ? (
            <div className="roster-placeholder">
              <Users size={30} />
              <span>No roster yet</span>
            </div>
          ) : null}
        </div>
      </section>

      <StatsRow
        items={[
          { label: 'Members', value: String(stats.members).padStart(2, '0') },
          { label: 'Songs', value: String(stats.songs).padStart(2, '0') },
          { label: 'Formations', value: String(stats.formations).padStart(2, '0') },
          { label: 'Choreo logged', value: formatClock(stats.choreoSeconds), accent: true },
        ]}
      />

      <div className="group-layout">
        <section className="panel members-panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">Roster</p>
              <h2>Members</h2>
            </div>
            <button type="button" className="btn btn-ghost btn-small" onClick={openAddMember}>
              <Plus size={15} />
              Add member
            </button>
          </header>

          {group.members.length === 0 ? (
            <EmptyState
              compact
              icon={<UserPlus size={24} />}
              title="No members yet"
              message="Add the lineup before plotting formations."
              action={
                <button type="button" className="btn btn-primary btn-small" onClick={openAddMember}>
                  Add member
                </button>
              }
            />
          ) : (
            <div className="member-grid">
              {group.members.map((member) => {
                const ranking = leaderboardByMember.get(member.id);
                return (
                  <article key={member.id} className="member-card">
                    <Avatar
                      name={member.name}
                      face={member.face}
                      color={member.color}
                      size={64}
                    />
                    <div className="member-card-copy">
                      <h3>{member.name.trim() || 'Unnamed member'}</h3>
                      {ranking ? (
                        <p className="mono">
                          <Crown size={12} aria-hidden="true" /> #{ranking.rank} ·{' '}
                          {roundTo(ranking.percentage, 1).toFixed(1)}%
                        </p>
                      ) : (
                        <p className="is-muted">No choreo logged</p>
                      )}
                    </div>
                    <div className="member-card-actions">
                      <button
                        type="button"
                        className="icon-button icon-button-small"
                        onClick={() => openEditMember(member)}
                        aria-label={`Edit ${member.name || 'member'}`}
                        title="Edit member"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-button icon-button-small"
                        onClick={() => setMemberToDelete(member)}
                        aria-label={`Delete ${member.name || 'member'}`}
                        title="Delete member"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <span
                      className="member-card-color"
                      style={{ backgroundColor: member.color }}
                      aria-hidden="true"
                    />
                  </article>
                );
              })}
              <button type="button" className="member-card member-card-new" onClick={openAddMember}>
                <span className="member-add-icon">
                  <Plus size={20} />
                </span>
                <span>Add member</span>
              </button>
            </div>
          )}
        </section>

        <Leaderboard
          rows={leaderboard}
          title="Group leaderboard"
          eyebrow="Choreo · normalized"
          emptyMessage="Log formations for this group to build its ranking."
          compact
        />
      </div>

      <section className="panel songs-panel">
        <header className="panel-header">
          <div>
            <p className="eyebrow">Discography log</p>
            <h2>Songs</h2>
          </div>
          <button type="button" className="btn btn-ghost btn-small" onClick={openAddSong}>
            <Plus size={15} />
            Add song
          </button>
        </header>

        {group.songs.length === 0 ? (
          <EmptyState
            compact
            icon={<Music2 size={24} />}
            title="No songs logged"
            message="Add a track, split it into sections, and start plotting."
            action={
              <button type="button" className="btn btn-primary btn-small" onClick={openAddSong}>
                Add song
              </button>
            }
          />
        ) : (
          <div className="song-list">
            {songSummaries.map(({ song, counts, topRow, topMember }, index) => (
              <div key={song.id} className="song-row">
                <button
                  type="button"
                  className="song-row-main"
                  onClick={() => goSong(group.id, song.id)}
                >
                  <span className="song-index mono">{String(index + 1).padStart(2, '0')}</span>
                  <span className="song-copy">
                    <h3>{song.title.trim() || 'Untitled song'}</h3>
                    <span className="song-meta">
                      {formatClock(song.durationSec)} · {counts.sections}{' '}
                      {counts.sections === 1 ? 'section' : 'sections'} · {counts.formations}{' '}
                      {counts.formations === 1 ? 'formation' : 'formations'}
                    </span>
                  </span>
                  <span className="song-choreo mono">
                    {formatClock(counts.seconds)}
                    <small>choreo</small>
                  </span>
                  <span className="song-leader">
                    {topMember && topRow ? (
                      <>
                        <Avatar
                          name={topMember.name}
                          face={topMember.face}
                          color={topMember.color}
                          size={28}
                        />
                        <span>
                          {topMember.name}
                          <small>{roundTo(topRow.percentage, 1).toFixed(1)}%</small>
                        </span>
                      </>
                    ) : (
                      <span className="is-muted">No scores</span>
                    )}
                  </span>
                  <ChevronRight size={17} className="song-row-arrow" />
                </button>
                <div className="song-row-actions">
                  <button
                    type="button"
                    className="icon-button icon-button-small"
                    onClick={() => openEditSong(song)}
                    aria-label={`Edit ${song.title || 'song'}`}
                    title="Edit song"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button-small"
                    onClick={() => setSongToDelete(song)}
                    aria-label={`Delete ${song.title || 'song'}`}
                    title="Delete song"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <MemberModal
        open={memberModalOpen}
        groupId={group.id}
        member={editingMember}
        onClose={() => setMemberModalOpen(false)}
      />
      <SongModal
        open={songModalOpen}
        groupId={group.id}
        song={editingSong}
        onClose={() => setSongModalOpen(false)}
        onCreated={(songId) => goSong(group.id, songId)}
      />

      <ConfirmDialog
        open={memberToDelete !== null}
        title="Delete this member?"
        message={
          memberToDelete
            ? `${memberToDelete.name || 'This member'} will be removed from the roster, every formation, and every logged line in this group. This cannot be undone except with Undo.`
            : ''
        }
        confirmLabel="Delete member"
        tone="danger"
        onCancel={() => setMemberToDelete(null)}
        onConfirm={() => {
          if (!memberToDelete) return;
          deleteMember(group.id, memberToDelete.id);
          setMemberToDelete(null);
          pushToast('Member deleted.', 'success');
        }}
      />

      <ConfirmDialog
        open={songToDelete !== null}
        title="Delete this song?"
        message={
          songToDelete
            ? `${songToDelete.title || 'This song'} and all of its sections, formations, logged lines, and scores will be removed.`
            : ''
        }
        confirmLabel="Delete song"
        tone="danger"
        onCancel={() => setSongToDelete(null)}
        onConfirm={() => {
          if (!songToDelete) return;
          deleteSong(group.id, songToDelete.id);
          setSongToDelete(null);
          pushToast('Song deleted.', 'success');
        }}
      />

      <ConfirmDialog
        open={groupDeleteOpen}
        title="Delete this group?"
        message={`${group.name || 'This group'} and all of its members and songs will be removed from this workspace. Export a backup first if you need one.`}
        confirmLabel="Delete group"
        tone="danger"
        onCancel={() => setGroupDeleteOpen(false)}
        onConfirm={() => {
          deleteGroup(group.id);
          setGroupDeleteOpen(false);
          goWorkspace();
          pushToast('Group deleted.', 'success');
        }}
      />
    </div>
  );
}
