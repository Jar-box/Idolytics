import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Section } from '../../domain/schema';
import { formatClock } from '../../lib/time';

interface SectionTimelineProps {
  sections: Section[];
  selectedSectionId: string | null;
  selectedFormationId: string | null;
  onSelectSection: (sectionId: string) => void;
  onSelectFormation: (sectionId: string, formationId: string) => void;
  onAddSection: () => void;
  onEditSection: (section: Section) => void;
  onDeleteSection: (section: Section) => void;
  onAddFormation: (sectionId: string) => void;
}

export function SectionTimeline({
  sections,
  selectedSectionId,
  selectedFormationId,
  onSelectSection,
  onSelectFormation,
  onAddSection,
  onEditSection,
  onDeleteSection,
  onAddFormation,
}: SectionTimelineProps) {
  const sorted = [...sections].sort((a, b) => a.startSec - b.startSec);

  return (
    <section className="panel timeline-panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Song map</p>
          <h2>Sections</h2>
        </div>
        <button type="button" className="btn btn-ghost btn-small" onClick={onAddSection}>
          <Plus size={14} />
          Section
        </button>
      </header>

      {sorted.length === 0 ? (
        <div className="timeline-empty">
          <Layers size={22} />
          <p>Split the song into sections, then plot formations inside each one.</p>
          <button type="button" className="btn btn-primary btn-small" onClick={onAddSection}>
            Add first section
          </button>
        </div>
      ) : (
        <div className="timeline-list">
          {sorted.map((section) => {
            const formations = [...section.formations].sort((a, b) => a.startSec - b.startSec);
            const isSelected = section.id === selectedSectionId;
            return (
              <article
                key={section.id}
                className={`timeline-section ${isSelected ? 'is-selected' : ''}`}
              >
                <div className="timeline-section-head">
                  <button
                    type="button"
                    className="timeline-section-title"
                    onClick={() => onSelectSection(section.id)}
                  >
                    <span className="timeline-section-name">
                      {section.label.trim() || 'Untitled section'}
                    </span>
                    <span className="timeline-section-time mono">
                      {formatClock(section.startSec)} – {formatClock(section.endSec)}
                    </span>
                  </button>
                  <div className="timeline-section-actions">
                    <button
                      type="button"
                      className="icon-button icon-button-small"
                      onClick={() => onEditSection(section)}
                      title="Edit section"
                      aria-label={`Edit section ${section.label || ''}`}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-button icon-button-small"
                      onClick={() => onDeleteSection(section)}
                      title="Delete section"
                      aria-label={`Delete section ${section.label || ''}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="formation-list">
                  {formations.map((formation, index) => (
                    <button
                      key={formation.id}
                      type="button"
                      className={`formation-pill ${
                        formation.id === selectedFormationId ? 'is-active' : ''
                      }`}
                      onClick={() => onSelectFormation(section.id, formation.id)}
                    >
                      <span className="formation-pill-index mono">
                        F{String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="formation-pill-time mono">
                        {formatClock(formation.startSec)} – {formatClock(formation.endSec)}
                      </span>
                      <span className="formation-pill-meta">
                        {formation.placements.length} placed
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="formation-pill formation-pill-add"
                    onClick={() => onAddFormation(section.id)}
                  >
                    <Plus size={13} />
                    Add formation
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
