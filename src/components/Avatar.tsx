import type { CSSProperties } from 'react';

interface AvatarProps {
  name: string;
  face: string | null;
  color: string;
  size?: number;
  className?: string;
  dimmed?: boolean;
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '·';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

export function Avatar({ name, face, color, size = 40, className = '', dimmed = false }: AvatarProps) {
  const style = {
    '--avatar-size': `${size}px`,
    '--member-color': color,
  } as CSSProperties;
  return (
    <span
      className={`avatar ${dimmed ? 'is-dimmed' : ''} ${className}`.trim()}
      style={style}
      aria-hidden="true"
    >
      {face ? (
        <img src={face} alt="" draggable={false} />
      ) : (
        <span className="avatar-initials">{initials(name)}</span>
      )}
    </span>
  );
}
