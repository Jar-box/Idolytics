import type { DragEvent } from 'react';

export const MEMBER_DRAG_MIME = 'application/x-idolytics-member';

export function writeMemberDrag(event: DragEvent<HTMLElement>, memberId: string): void {
  event.dataTransfer.setData(MEMBER_DRAG_MIME, memberId);
  event.dataTransfer.setData('text/plain', memberId);
  event.dataTransfer.effectAllowed = 'move';
}

export function readMemberDrag(event: DragEvent<HTMLElement>): string | null {
  return (
    event.dataTransfer.getData(MEMBER_DRAG_MIME) ||
    event.dataTransfer.getData('text/plain') ||
    null
  );
}
