import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Cropper from 'react-easy-crop';
import { ImagePlus, List, Shuffle, Trash2, UserRound } from 'lucide-react';
import type { Member } from '../../domain/schema';
import { memberColorPalette } from '../../domain/schema';
import { randomUnusedMemberColor } from '../../domain/colors';
import { Avatar } from '../../components/Avatar';
import { Modal } from '../../components/Modal';
import { cropImage, readFileAsDataUrl, type CropArea } from '../../lib/image';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useToastStore } from '../../store/toastStore';

interface MemberModalProps {
  open: boolean;
  groupId: string;
  member: Member | null;
  onClose: () => void;
}

type AddMode = 'single' | 'quick';

interface AddedMember {
  id: string;
  name: string;
  color: string;
}

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_GROUP_MEMBERS = 60;
const MAX_NAME_LENGTH = 80;
const INITIAL_CROP = { x: 0, y: 0 };

function parseMemberNames(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => name.slice(0, MAX_NAME_LENGTH));
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export function MemberModal({ open, groupId, member, onClose }: MemberModalProps) {
  const group = useWorkspaceStore((state) =>
    state.workspace.groups.find((entry) => entry.id === groupId),
  );
  const createMember = useWorkspaceStore((state) => state.createMember);
  const createMembers = useWorkspaceStore((state) => state.createMembers);
  const updateMember = useWorkspaceStore((state) => state.updateMember);
  const pushToast = useToastStore((state) => state.push);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const quickNamesInputRef = useRef<HTMLTextAreaElement>(null);

  const [name, setName] = useState('');
  const [face, setFace] = useState<string | null>(null);
  const [color, setColor] = useState<string>(memberColorPalette[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [crop, setCrop] = useState(INITIAL_CROP);
  const [zoom, setZoom] = useState(1);
  const [cropPixels, setCropPixels] = useState<CropArea | null>(null);
  const [mode, setMode] = useState<AddMode>('single');
  const [quickNamesValue, setQuickNamesValue] = useState('');
  const [quickError, setQuickError] = useState<string | null>(null);
  const [added, setAdded] = useState<AddedMember[]>([]);

  const groupMembers = group?.members ?? [];
  const quickNames = parseMemberNames(quickNamesValue);
  const remainingSlots = Math.max(0, MAX_GROUP_MEMBERS - groupMembers.length);
  const limitMessage =
    quickNames.length > remainingSlots
      ? remainingSlots === 0
        ? `This group already has the maximum of ${MAX_GROUP_MEMBERS} members.`
        : `This group has room for ${remainingSlots} more ${pluralize(remainingSlots, 'member', 'members')}. Remove some names first.`
      : null;

  const usedColors = useMemo(() => {
    const usage = new Map<string, string[]>();
    for (const entry of groupMembers) {
      if (entry.id === member?.id) continue;
      const key = entry.color.toLowerCase();
      const nameLabel = entry.name.trim() || 'Unnamed member';
      const names = usage.get(key);
      if (names) names.push(nameLabel);
      else usage.set(key, [nameLabel]);
    }
    return usage;
  }, [groupMembers, member?.id]);

  const allColorsUsed = memberColorPalette.every((paletteColor) =>
    usedColors.has(paletteColor.toLowerCase()),
  );

  useEffect(() => {
    if (!open) return;
    const members =
      useWorkspaceStore
        .getState()
        .workspace.groups.find((entry) => entry.id === groupId)?.members ?? [];
    setMode('single');
    setQuickNamesValue('');
    setQuickError(null);
    setAdded([]);
    setName(member?.name ?? '');
    setFace(member?.face ?? null);
    setColor(
      member?.color ?? randomUnusedMemberColor(members, { excludeMemberId: member?.id }),
    );
    setError(null);
    setSaving(false);
    setCropSource(null);
    setCrop(INITIAL_CROP);
    setZoom(1);
    setCropPixels(null);
  }, [open, member, groupId]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      if (!member && mode === 'quick') quickNamesInputRef.current?.focus();
      else nameInputRef.current?.focus();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [open, member, mode]);

  const handleClose = (summaryCount?: number) => {
    const count = summaryCount ?? added.length;
    if (!member && count > 0) {
      pushToast(
        `${count} ${pluralize(count, 'member', 'members')} added.`,
        'success',
      );
    }
    onClose();
  };

  const handleRandomizeColor = () => {
    setColor(
      randomUnusedMemberColor(groupMembers, { excludeMemberId: member?.id }),
    );
  };

  const switchMode = (nextMode: AddMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setError(null);
    setQuickError(null);
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('That image is larger than 15 MB.');
      return;
    }
    try {
      const source = await readFileAsDataUrl(file);
      setCropSource(source);
      setCrop(INITIAL_CROP);
      setZoom(1);
      setCropPixels(null);
      setError(null);
    } catch {
      setError('Could not read that image.');
    }
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give this member a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let nextFace = face;
      if (cropSource && cropPixels) {
        nextFace = await cropImage(cropSource, cropPixels);
      }
      if (member) {
        updateMember(groupId, member.id, { name: trimmed, face: nextFace, color });
        pushToast('Member updated.', 'success');
        handleClose();
        return;
      }

      const createdId = createMember(groupId, trimmed, nextFace, color);
      if (!createdId) {
        setError(
          groupMembers.length >= MAX_GROUP_MEMBERS
            ? `This group already has the maximum of ${MAX_GROUP_MEMBERS} members.`
            : 'Could not add this member.',
        );
        return;
      }

      setAdded((previous) => [
        ...previous,
        { id: createdId, name: trimmed, color },
      ]);
      setName('');
      setFace(null);
      setCropSource(null);
      setCrop(INITIAL_CROP);
      setZoom(1);
      setCropPixels(null);
      const nextMembers =
        useWorkspaceStore
          .getState()
          .workspace.groups.find((entry) => entry.id === groupId)?.members ?? [];
      setColor(randomUnusedMemberColor(nextMembers));
      setError(null);
      window.setTimeout(() => nameInputRef.current?.focus(), 30);
    } catch {
      setError(member ? 'Could not save this member.' : 'Could not add this member.');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickAdd = () => {
    if (saving) return;
    if (quickNames.length === 0) {
      setQuickError('Add at least one name first.');
      return;
    }
    if (limitMessage) {
      setQuickError(limitMessage);
      return;
    }
    setSaving(true);
    setQuickError(null);
    try {
      const created = createMembers(
        groupId,
        quickNames.map((memberName) => ({ name: memberName })),
      );
      if (created.length === 0) {
        setQuickError('Could not add those members.');
        setSaving(false);
        return;
      }
      setQuickNamesValue('');
      setSaving(false);
      handleClose(added.length + created.length);
    } catch {
      setQuickError('Could not add those members.');
      setSaving(false);
    }
  };

  const isAdd = member === null;
  const quickBlocked = remainingSlots === 0 || limitMessage !== null;
  const primaryDisabled =
    saving || (isAdd && mode === 'quick' && (quickNames.length === 0 || quickBlocked));
  const primaryFormId = isAdd && mode === 'quick' ? 'quick-add-form' : 'member-form';
  const primaryLabel = member
    ? saving
      ? 'Saving…'
      : 'Save changes'
    : mode === 'quick'
      ? saving
        ? 'Adding…'
        : quickNames.length > 0
          ? `Add ${quickNames.length} ${pluralize(quickNames.length, 'member', 'members')}`
          : 'Add members'
      : saving
        ? 'Adding…'
        : 'Add & next';

  return (
    <Modal
      open={open}
      onClose={() => handleClose()}
      title={member ? 'Edit member' : 'Add members'}
      eyebrow={member ? 'Roster' : mode === 'quick' ? 'Paste a lineup' : 'New profiles'}
      size="md"
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => handleClose()}
            disabled={saving}
          >
            {member ? 'Cancel' : added.length > 0 ? 'Done' : 'Cancel'}
          </button>
          <button
            type="submit"
            form={primaryFormId}
            className="btn btn-primary"
            disabled={primaryDisabled}
          >
            {primaryLabel}
          </button>
        </>
      }
    >
      {isAdd ? (
        <div className="member-add-modes" role="group" aria-label="Add member mode">
          <button
            type="button"
            className={`member-add-mode ${mode === 'single' ? 'is-active' : ''}`}
            onClick={() => switchMode('single')}
            aria-pressed={mode === 'single'}
          >
            <UserRound size={14} aria-hidden="true" />
            One at a time
          </button>
          <button
            type="button"
            className={`member-add-mode ${mode === 'quick' ? 'is-active' : ''}`}
            onClick={() => switchMode('quick')}
            aria-pressed={mode === 'quick'}
          >
            <List size={14} aria-hidden="true" />
            Paste a list
          </button>
        </div>
      ) : null}

      {isAdd && added.length > 0 ? (
        <div className="member-added" aria-live="polite">
          <div className="member-added-heading">
            <span className="field-label">Added this session</span>
            <span className="member-added-count">{added.length}</span>
          </div>
          <div className="member-added-list">
            {added.map((entry) => (
              <span key={entry.id} className="member-added-chip" title={entry.name}>
                <span
                  className="member-added-dot"
                  style={{ backgroundColor: entry.color }}
                  aria-hidden="true"
                />
                <span className="member-added-name">{entry.name}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {!member && mode === 'quick' ? (
        <form
          id="quick-add-form"
          className="quick-add-form"
          onSubmit={(event) => {
            event.preventDefault();
            handleQuickAdd();
          }}
        >
          <label className="field">
            <span className="field-label">Member names</span>
            <textarea
              ref={quickNamesInputRef}
              className="input quick-add-textarea"
              value={quickNamesValue}
              onChange={(event) => {
                setQuickNamesValue(event.target.value);
                if (quickError) setQuickError(null);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  handleQuickAdd();
                }
              }}
              placeholder={'One name per line, or separated by commas\n\nMinji\nHanni\nDanielle\nHaerin\nHyein'}
              disabled={saving || remainingSlots === 0}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="quick-add-meta"
            />
          </label>
          <div className="quick-add-meta" id="quick-add-meta">
            <span>
              {quickNames.length} {pluralize(quickNames.length, 'name', 'names')} ready
            </span>
            <span>
              {remainingSlots} {pluralize(remainingSlots, 'slot', 'slots')} left
            </span>
          </div>
          <p className="field-hint">
            Colors are assigned automatically and avoid duplicates until the palette runs out.
            Photos can be added later from the roster. Press Ctrl/⌘ + Enter to add.
          </p>
          {limitMessage ? (
            <p className="form-error" role="alert">
              {limitMessage}
            </p>
          ) : null}
          {quickError ? (
            <p className="form-error" role="alert">
              {quickError}
            </p>
          ) : null}
        </form>
      ) : (
        <form
          id="member-form"
          onSubmit={(event) => void handleSave(event)}
          className="member-form"
        >
          <div className="member-form-top">
            <div className="member-preview">
              <Avatar name={name || 'New member'} face={face} color={color} size={104} />
              <div className="member-preview-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus size={15} />
                  {face ? 'Change photo' : 'Upload photo'}
                </button>
                {face ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-small btn-danger-text"
                    onClick={() => {
                      setFace(null);
                      setCropSource(null);
                    }}
                  >
                    <Trash2 size={15} />
                    Remove
                  </button>
                ) : null}
              </div>
              <p className="field-hint">Square crop, resized to 256px.</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  event.target.value = '';
                  void handleFile(file);
                }}
              />
            </div>

            <div className="member-fields">
              <label className="field">
                <span className="field-label">Stage / member name</span>
                <input
                  ref={nameInputRef}
                  className="input"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (error) setError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.nativeEvent.isComposing) {
                      event.preventDefault();
                    }
                  }}
                  placeholder="e.g. Minji"
                  maxLength={MAX_NAME_LENGTH}
                  autoComplete="off"
                  data-autofocus
                  disabled={saving}
                />
              </label>

              <div className="field">
                <div className="color-field-heading">
                  <span className="field-label">Signature color</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-small color-randomize"
                    onClick={handleRandomizeColor}
                    title={
                      allColorsUsed
                        ? 'Randomize among the least-used colors'
                        : 'Randomize among unused colors'
                    }
                  >
                    <Shuffle size={13} aria-hidden="true" />
                    Randomize
                  </button>
                </div>
                <div className="color-swatches" role="group" aria-label="Member color">
                  {memberColorPalette.map((paletteColor) => {
                    const usedBy = usedColors.get(paletteColor.toLowerCase()) ?? [];
                    const inUse = usedBy.length > 0;
                    const selected = paletteColor.toLowerCase() === color.toLowerCase();
                    return (
                      <button
                        key={paletteColor}
                        type="button"
                        className={`color-swatch ${selected ? 'is-selected' : ''} ${inUse ? 'is-used' : ''}`.trim()}
                        style={{ backgroundColor: paletteColor }}
                        onClick={() => setColor(paletteColor)}
                        aria-label={
                          inUse
                            ? `Use color ${paletteColor}, in use by ${usedBy.join(', ')}`
                            : `Use color ${paletteColor}`
                        }
                        aria-pressed={selected}
                        title={inUse ? `In use by ${usedBy.join(', ')}` : undefined}
                      />
                    );
                  })}
                </div>
                {allColorsUsed ? (
                  <p className="field-hint">
                    All palette colors are in use. Randomize picks the least-used color.
                  </p>
                ) : null}
              </div>

              <div className="member-avatar-note">
                <UserRound size={16} aria-hidden="true" />
                <span>Face photos stay inside your workspace file.</span>
              </div>
            </div>
          </div>

          {cropSource ? (
            <div className="crop-section">
              <div className="crop-heading">
                <div>
                  <p className="eyebrow">Crop photo</p>
                  <h3>Frame the face</h3>
                </div>
                <div className="crop-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => setCropSource(null)}
                  >
                    Cancel crop
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    onClick={async () => {
                      if (!cropPixels) {
                        setError('Adjust the crop before using this photo.');
                        return;
                      }
                      try {
                        const cropped = await cropImage(cropSource, cropPixels);
                        setFace(cropped);
                        setCropSource(null);
                        setError(null);
                      } catch {
                        setError('Could not crop that image.');
                      }
                    }}
                  >
                    Use photo
                  </button>
                </div>
              </div>
              <div className="crop-area">
                <Cropper
                  image={cropSource}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  minZoom={1}
                  maxZoom={3}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={(_area, areaPixels) => setCropPixels(areaPixels)}
                />
              </div>
              <label className="field zoom-field">
                <span className="field-label">Zoom</span>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
              </label>
              <p className="field-hint">
                Drag the photo to reposition. Saving the member will use the visible frame.
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </Modal>
  );
}
