interface StatItem {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}

interface StatsRowProps {
  items: StatItem[];
  className?: string;
}

export function StatsRow({ items, className = '' }: StatsRowProps) {
  return (
    <div className={`stats-row ${className}`.trim()}>
      {items.map((item) => (
        <div key={item.label} className={`stat-item ${item.accent ? 'is-accent' : ''}`}>
          <span className="stat-label">{item.label}</span>
          <span className="stat-value mono">{item.value}</span>
          {item.hint ? <span className="stat-hint">{item.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}
