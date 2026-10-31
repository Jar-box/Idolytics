import { useEffect, useRef, useState, type FormEvent } from 'react';
import Cropper from 'react-easy-crop';
import { ImagePlus, Trash2, UserRound } from 'lucide-react';
import type { Member } from '../../domain/schema';
import { memberColorPalette } from '../../domain/schema';
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

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export function MemberModal({ open, groupId, member, onClose }: MemberModalProps) {
  const createMember = useWorkspaceStore((state) => state.createMember);
  const updateMember = useWorkspaceStore((state) => state.updateMember);
  const pushToast = useToastStore((state) => state.push);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [face, setFace] = useState<string | null>(null);
  const [color, setColor] = useState<string>(memberColorPalette[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropPixels, setCropPixels] = useState<CropArea | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(member?.name ?? '');
    setFace(member?.face ?? null);
    setColor(member?.color ?? memberColorPalette[0]);
    setError(null);
    setSaving(false);
    setCropSource(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCropPixels(null);
  }, [open, member]);

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
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCropPixels(null);
      setError(null);
    } catch {
      setError('Could not read that image.');
    }
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
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
      } else {
        createMember(groupId, trimmed, nextFace, color);
        pushToast('Member added.', 'success');
      }
      onClose();
    } catch {
      setError('Could not save this member.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={member ? 'Edit member' : 'Add member'}
      eyebrow={member ? 'Roster' : 'New profile'}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="member-form"
            className="btn btn-primary"
            disabled={saving}
          >
            {saving ? 'Saving…' : member ? 'Save changes' : 'Add member'}
          </button>
        </>
      }
    >
      <form id="member-form" onSubmit={(event) => void handleSave(event)} className="member-form">
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
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Minji"
                maxLength={80}
                autoComplete="off"
              />
            </label>

            <div className="field">
              <span className="field-label">Signature color</span>
              <div className="color-swatches" role="group" aria-label="Member color">
                {memberColorPalette.map((paletteColor) => (
                  <button
                    key={paletteColor}
                    type="button"
                    className={`color-swatch ${paletteColor === color ? 'is-selected' : ''}`}
                    style={{ backgroundColor: paletteColor }}
                    onClick={() => setColor(paletteColor)}
                    aria-label={`Use color ${paletteColor}`}
                    aria-pressed={paletteColor === color}
                  />
                ))}
              </div>
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

        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Modal>
  );
}
