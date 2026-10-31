import type { DragEvent } from 'react';
import { GripVertical, Plus, Users } from 'lucide-react';
import type { Member } from '../../domain/schema';
import { Avatar } from '../../components/Avatar';
import { writeMemberDrag } from '../../lib/dnd';

interface MemberTrayProps {
  members: Member[];
  placedMemberIds: string[];
  selectedMemberId: string | null;
  onSelectMember: (memberId: string) => void;
}

export function MemberTray({
  members,
  placedMemberIds,
  selectedMemberId,
  onSelectMember,
}: MemberTrayProps) {
  const placed = new Set(placedMemberIds);
  const unplaced = members.filter((member) => !placed.has(member.id));

  return (
    <div className="member-tray">
      <div className="member-tray-head">
        <span className="eyebrow">Member tray</span>
        <span className="mono tray-count">
          {placed.size}/{members.length} placed
        </span>
      </div>
      {unplaced.length === 0 ? (
        <div className="tray-empty">
          <Users size={15} />
          <span>Every member is on the stage.</span>
        </div>
      ) : (
        <div className="tray-chips">
          {unplaced.map((member) => (
            <button
              key={member.id}
              type="button"
              className={`tray-chip ${member.id === selectedMemberId ? 'is-selected' : ''}`}
              draggable
              onDragStart={(event: DragEvent<HTMLElement>) => writeMemberDrag(event, member.id)}
              onClick={() => onSelectMember(member.id)}
              title="Drag onto the stage or click to select"
            >
              <Avatar name={member.name} face={member.face} color={member.color} size={30} />
              <span className="tray-chip-name">{member.name || 'Unnamed'}</span>
              <GripVertical size={13} className="tray-grip" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      <p className="tray-hint">
        <Plus size={12} aria-hidden="true" />
        Drag onto the stage, or select a member then click a cell.
      </p>
    </div>
  );
}
