import { useEffect, useMemo, useState, type RefObject } from 'react';
import {
  Clock3,
  Copy,
  Grid3X3,
  Layers,
  Plus,
  Timer,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type { Formation, Group, Section, Song } from '../../domain/schema';
import type { FormationScore } from '../../domain/scoring';
import { scoreFormation } from '../../domain/scoring';
import { choreoCounts } from '../../domain/stats';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import type { MediaCopyState, MediaSource } from '../../lib/mediaTypes';
import { formatClock } from '../../lib/time';
import { useNavStore } from '../../store/navStore';
import { useToastStore } from '../../store/toastStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { VideoPanel } from './VideoPanel';
import { SectionTimeline } from './SectionTimeline';
import { StageGrid } from './StageGrid';
import { MemberTray } from './MemberTray';
import { LiveScoreboard } from './LiveScoreboard';
import { SectionModal } from './SectionModal';
import { FormationTimesModal } from './FormationTimesModal';
import { GridSettingsModal } from './GridSettingsModal';

interface ChoreoEditorProps {
  group: Group;
  song: Song;
  videoUrl: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  videoDuration: number;
  currentTime: number;
  videoResolving?: boolean;
  videoSource?: MediaSource | null;
  videoCopyState?: MediaCopyState | null;
  onVideoFile: (file: File) => void;
  onTimeUpdate: (time: number) => void;
  onLoadedMetadata: (duration: number) => void;
  onRetryVideoCopy?: () => void;
  onImportVideoUrl?: () => void;
}

type SectionModalState =
  | { mode: 'create'; label: string; start: number; end: number }
  | { mode: 'edit'; section: Section }
  | null;

export function ChoreoEditor({
  group,
  song,
  videoUrl,
  videoRef,
  videoDuration,
  currentTime,
  videoResolving = false,
  videoSource = null,
  videoCopyState = null,
  onVideoFile,
  onTimeUpdate,
  onLoadedMetadata,
  onRetryVideoCopy,
  onImportVideoUrl,
}: ChoreoEditorProps) {
  const postures = useWorkspaceStore((state) => state.workspace.settings.postures);
  const addFormation = useWorkspaceStore((state) => state.addFormation);
  const duplicateFormation = useWorkspaceStore((state) => state.duplicateFormation);
  const deleteFormation = useWorkspaceStore((state) => state.deleteFormation);
  const deleteSection = useWorkspaceStore((state) => state.deleteSection);
  const placeMember = useWorkspaceStore((state) => state.placeMember);
  const removePlacement = useWorkspaceStore((state) => state.removePlacement);
  const setPosture = useWorkspaceStore((state) => state.setPosture);
  const toggleAnchor = useWorkspaceStore((state) => state.toggleAnchor);
  const goGroup = useNavStore((state) => state.goGroup);
  const pushToast = useToastStore((state) => state.push);

  const sections = useMemo(
    () => [...song.sections].sort((a, b) => a.startSec - b.startSec),
    [song.sections],
  );
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    sections[0]?.id ?? null,
  );
  const [selectedFormationId, setSelectedFormationId] = useState<string | null>(() => {
    const firstSection = sections[0];
    if (!firstSection) return null;
    const formations = [...firstSection.formations].sort((a, b) => a.startSec - b.startSec);
    return formations[0]?.id ?? null;
  });
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [sectionModal, setSectionModal] = useState<SectionModalState>(null);
  const [timesModalOpen, setTimesModalOpen] = useState(false);
  const [gridModalOpen, setGridModalOpen] = useState(false);
  const [sectionToDelete, setSectionToDelete] = useState<Section | null>(null);
  const [formationToDelete, setFormationToDelete] = useState<Formation | null>(null);

  useEffect(() => {
    const section = sections.find((entry) => entry.id === selectedSectionId) ?? sections[0];
    if (!section) {
      if (selectedSectionId) setSelectedSectionId(null);
      if (selectedFormationId) setSelectedFormationId(null);
      return;
    }
    if (section.id !== selectedSectionId) setSelectedSectionId(section.id);
    const formations = [...section.formations].sort((a, b) => a.startSec - b.startSec);
    const formation =
      formations.find((entry) => entry.id === selectedFormationId) ?? formations[0];
    if ((formation?.id ?? null) !== selectedFormationId) {
      setSelectedFormationId(formation?.id ?? null);
    }
  }, [sections, selectedSectionId, selectedFormationId]);

  useEffect(() => {
    if (selectedMemberId && !group.members.some((member) => member.id === selectedMemberId)) {
      setSelectedMemberId(null);
    }
  }, [group.members, selectedMemberId]);

  const selectedSection =
    sections.find((section) => section.id === selectedSectionId) ?? sections[0] ?? null;
  const sortedFormations = useMemo(
    () =>
      selectedSection
        ? [...selectedSection.formations].sort((a, b) => a.startSec - b.startSec)
        : [],
    [selectedSection],
  );
  const selectedFormation =
    sortedFormations.find((formation) => formation.id === selectedFormationId) ??
    sortedFormations[0] ??
    null;
  const selectedFormationIndex = selectedFormation
    ? sortedFormations.findIndex((formation) => formation.id === selectedFormation.id)
    : -1;

  const formationScore: FormationScore | null = useMemo(
    () => (selectedFormation ? scoreFormation(selectedFormation, postures) : null),
    [selectedFormation, postures],
  );

  const counts = useMemo(() => choreoCounts(song), [song]);
  const songLength = song.durationSec > 0 ? song.durationSec : videoDuration || 180;
  const hasVideo = videoUrl !== null;

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'Escape') {
        setSelectedMemberId(null);
        return;
      }
      if (!selectedSection || !selectedFormation || !selectedMemberId) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removePlacement(
          group.id,
          song.id,
          selectedSection.id,
          selectedFormation.id,
          selectedMemberId,
        );
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [group.id, song.id, selectedSection, selectedFormation, selectedMemberId, removePlacement]);

  const openAddSection = () => {
    const lastEnd = sections.reduce(
      (latest, section) => Math.max(latest, section.endSec),
      0,
    );
    const start = sections.length > 0 ? lastEnd : 0;
    let end = start + 15;
    if (songLength > start) end = Math.min(end, songLength);
    if (end <= start) end = start + 15;
    setSectionModal({
      mode: 'create',
      label: `Section ${sections.length + 1}`,
      start,
      end,
    });
  };

  const selectSection = (sectionId: string) => {
    const section = sections.find((entry) => entry.id === sectionId);
    const formations = section
      ? [...section.formations].sort((a, b) => a.startSec - b.startSec)
      : [];
    setSelectedSectionId(sectionId);
    setSelectedFormationId(formations[0]?.id ?? null);
  };

  const handleAddFormation = (sectionId: string) => {
    const id = addFormation(group.id, song.id, sectionId);
    if (!id) {
      pushToast('Not enough room. Extend the section end time first.', 'error');
      return;
    }
    setSelectedSectionId(sectionId);
    setSelectedFormationId(id);
  };

  const handleDuplicateFormation = () => {
    if (!selectedSection || !selectedFormation) return;
    const id = duplicateFormation(
      group.id,
      song.id,
      selectedSection.id,
      selectedFormation.id,
    );
    if (!id) {
      pushToast('Not enough room at the end of this section to duplicate.', 'error');
      return;
    }
    setSelectedFormationId(id);
    pushToast('Formation duplicated.', 'success');
  };

  const handlePlace = (memberId: string, col: number, row: number) => {
    if (!selectedSection || !selectedFormation) return;
    const ok = placeMember(
      group.id,
      song.id,
      selectedSection.id,
      selectedFormation.id,
      memberId,
      col,
      row,
    );
    if (!ok) {
      pushToast('That cell is occupied. Move that member first, or drop onto an empty cell.', 'error');
      return;
    }
    setSelectedMemberId(memberId);
  };

  const handleRemoveSelected = (memberId: string) => {
    if (!selectedSection || !selectedFormation) return;
    removePlacement(group.id, song.id, selectedSection.id, selectedFormation.id, memberId);
  };

  if (group.members.length === 0) {
    return (
      <div className="choreo-editor">
        <section className="panel">
          <EmptyState
            icon={<UserPlus size={28} />}
            eyebrow="Roster required"
            title="Add members before plotting"
            message="Formations need faces. Build the group roster first, then come back to the stage."
            action={
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => goGroup(group.id)}
              >
                Go to roster
              </button>
            }
          />
        </section>
      </div>
    );
  }

  return (
    <div className="choreo-editor">
      <div className="editor-toolbar">
        <div className="editor-toolbar-copy">
          <p className="eyebrow">Formation lab</p>
          <h2>
            {selectedSection?.label.trim() || 'No section'} ·{' '}
            {selectedFormation ? `F${String(selectedFormationIndex + 1).padStart(2, '0')}` : '—'}
          </h2>
        </div>
        <div className="editor-toolbar-stats">
          <span className="mono">
            {counts.formations} {counts.formations === 1 ? 'formation' : 'formations'}{' '}
            <small>·</small> {formatClock(counts.seconds)} logged
          </span>
          <span className="editor-toolbar-hint">Drag · click · score live</span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => setGridModalOpen(true)}
        >
          <Grid3X3 size={14} />
          Grid {song.grid.cols}×{song.grid.rows}
        </button>
      </div>

      <div className="editor-layout">
        <div className="editor-left">
          <VideoPanel
            fileName={song.videoFileName}
            videoUrl={videoUrl}
            videoRef={videoRef}
            currentTime={currentTime}
            initialTime={currentTime}
            mediaResolving={videoResolving}
            mediaSource={videoSource}
            copyState={videoCopyState}
            onTimeUpdate={onTimeUpdate}
            onFile={onVideoFile}
            onLoadedMetadata={onLoadedMetadata}
            onRetryCopy={onRetryVideoCopy}
            onImportUrl={onImportVideoUrl}
          />
          <SectionTimeline
            sections={sections}
            selectedSectionId={selectedSectionId}
            selectedFormationId={selectedFormation?.id ?? null}
            onSelectSection={selectSection}
            onSelectFormation={(sectionId, formationId) => {
              setSelectedSectionId(sectionId);
              setSelectedFormationId(formationId);
            }}
            onAddSection={openAddSection}
            onEditSection={(section) => setSectionModal({ mode: 'edit', section })}
            onDeleteSection={setSectionToDelete}
            onAddFormation={handleAddFormation}
          />
        </div>

        <div className="editor-main">
          {!selectedSection ? (
            <section className="panel">
              <EmptyState
                icon={<Layers size={28} />}
                eyebrow="No sections"
                title="Split the song before plotting"
                message="Add a section with start and end times, then place members into formations."
                action={
                  <button type="button" className="btn btn-primary" onClick={openAddSection}>
                    <Plus size={16} />
                    Add first section
                  </button>
                }
              />
            </section>
          ) : !selectedFormation || !formationScore ? (
            <section className="panel">
              <EmptyState
                icon={<Timer size={28} />}
                eyebrow={selectedSection.label || 'Section'}
                title="No formation in this section"
                message="Add a formation to give this range a stage picture."
                action={
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleAddFormation(selectedSection.id)}
                  >
                    <Plus size={16} />
                    Add formation
                  </button>
                }
              />
            </section>
          ) : (
            <div className="formation-workbench">
              <section className="panel stage-panel">
                <header className="stage-header">
                  <div>
                    <p className="eyebrow">
                      {selectedSection.label.trim() || 'Section'} ·{' '}
                      {formatClock(selectedFormation.startSec)} –{' '}
                      {formatClock(selectedFormation.endSec)}
                    </p>
                    <div className="stage-header-row">
                      <h2>
                        Formation {String(selectedFormationIndex + 1).padStart(2, '0')}
                      </h2>
                      <span className="status-chip mono">
                        {formationScore.durationSec.toFixed(1)}s
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        onClick={() => setTimesModalOpen(true)}
                      >
                        <Clock3 size={13} />
                        Timing
                      </button>
                    </div>
                  </div>
                  <div className="stage-header-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={handleDuplicateFormation}
                    >
                      <Copy size={14} />
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => setFormationToDelete(selectedFormation)}
                      title="Delete formation"
                      aria-label="Delete formation"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </header>

                <StageGrid
                  song={song}
                  formation={selectedFormation}
                  members={group.members}
                  postures={postures}
                  score={formationScore}
                  selectedMemberId={selectedMemberId}
                  onSelectMember={(memberId) => setSelectedMemberId(memberId)}
                  onPlaceMember={handlePlace}
                />

                <MemberTray
                  members={group.members}
                  placedMemberIds={selectedFormation.placements.map(
                    (placement) => placement.memberId,
                  )}
                  selectedMemberId={selectedMemberId}
                  onSelectMember={(memberId) =>
                    setSelectedMemberId((current) => (current === memberId ? null : memberId))
                  }
                />
              </section>

              <LiveScoreboard
                formation={selectedFormation}
                members={group.members}
                postures={postures}
                score={formationScore}
                selectedMemberId={selectedMemberId}
                onSelectMember={setSelectedMemberId}
                onToggleAnchor={(memberId) =>
                  toggleAnchor(group.id, song.id, selectedSection.id, selectedFormation.id, memberId)
                }
                onSetPosture={(memberId, postureId) =>
                  setPosture(group.id, song.id, selectedSection.id, selectedFormation.id, memberId, postureId)
                }
                onRemoveMember={handleRemoveSelected}
              />
            </div>
          )}
        </div>
      </div>

      <SectionModal
        open={sectionModal !== null}
        groupId={group.id}
        songId={song.id}
        section={sectionModal?.mode === 'edit' ? sectionModal.section : null}
        defaultLabel={sectionModal?.mode === 'create' ? sectionModal.label : 'Section'}
        defaultStart={sectionModal?.mode === 'create' ? sectionModal.start : 0}
        defaultEnd={sectionModal?.mode === 'create' ? sectionModal.end : 15}
        currentTime={currentTime}
        hasVideo={hasVideo}
        onClose={() => setSectionModal(null)}
        onSaved={(sectionId) => {
          setSelectedSectionId(sectionId);
          if (sectionModal?.mode === 'create') setSelectedFormationId(null);
          pushToast('Section saved.', 'success');
        }}
      />

      {selectedSection && selectedFormation ? (
        <FormationTimesModal
          open={timesModalOpen}
          groupId={group.id}
          songId={song.id}
          section={selectedSection}
          formation={selectedFormation}
          currentTime={currentTime}
          hasVideo={hasVideo}
          onClose={() => setTimesModalOpen(false)}
        />
      ) : null}

      <GridSettingsModal
        open={gridModalOpen}
        groupId={group.id}
        song={song}
        onClose={() => setGridModalOpen(false)}
      />

      <ConfirmDialog
        open={sectionToDelete !== null}
        title="Delete this section?"
        message={
          sectionToDelete
            ? `"${sectionToDelete.label || 'Untitled section'}" and all of its formations and scores will be removed.`
            : ''
        }
        confirmLabel="Delete section"
        tone="danger"
        onCancel={() => setSectionToDelete(null)}
        onConfirm={() => {
          if (!sectionToDelete) return;
          deleteSection(group.id, song.id, sectionToDelete.id);
          setSectionToDelete(null);
          setSelectedMemberId(null);
          pushToast('Section deleted.', 'success');
        }}
      />

      <ConfirmDialog
        open={formationToDelete !== null}
        title="Delete this formation?"
        message={
          formationToDelete
            ? `The formation from ${formatClock(formationToDelete.startSec)} to ${formatClock(
                formationToDelete.endSec,
              )} and all of its placements will be removed.`
            : ''
        }
        confirmLabel="Delete formation"
        tone="danger"
        onCancel={() => setFormationToDelete(null)}
        onConfirm={() => {
          if (!formationToDelete || !selectedSection) return;
          deleteFormation(group.id, song.id, selectedSection.id, formationToDelete.id);
          setFormationToDelete(null);
          setSelectedMemberId(null);
          pushToast('Formation deleted.', 'success');
        }}
      />
    </div>
  );
}
