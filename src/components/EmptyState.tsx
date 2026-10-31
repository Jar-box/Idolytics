import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  eyebrow?: string;
  title: string;
  message: string;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon, eyebrow, title, message, action, compact }: EmptyStateProps) {
  return (
    <div className={`empty-state ${compact ? 'empty-compact' : ''}`}>
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h3>{title}</h3>
      <p className="empty-message">{message}</p>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}
