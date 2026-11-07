import { useCallback, useMemo } from "react";
import type { MouseEvent } from "react";
import type { Section, TranscriptSegmentView } from "../types";
import { useTranscriptStore, selectSortedSegments } from "../stores/transcriptStore";
import { SectionEditor } from "./SectionEditor";

// ----------------------------------------------------------------
// SectionHeader
// ----------------------------------------------------------------
// Renders a saved section divider with title, description,
// numbering, time range, and edit/delete controls.

interface Props {
  section: Section;
  index: number;
}

export function SectionHeader({ section, index }: Props) {
  const sectionEditingId = useTranscriptStore((s) => s.sectionEditingId);
  const setSectionEditingId = useTranscriptStore((s) => s.setSectionEditingId);
  const removeSection = useTranscriptStore((s) => s.removeSection);
  const sections = useTranscriptStore((s) => s.sections);
  const segments = useTranscriptStore(selectSortedSegments);

  const isEditing = sectionEditingId === section.id;

  const handleEdit = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      setSectionEditingId(section.id);
    },
    [section.id, setSectionEditingId]
  );

  const handleDelete = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      removeSection(section.id);
    },
    [section.id, removeSection]
  );

  // Compute the time range for this section
  const timeRange = useMemo(() => {
    return computeSectionTimeRange(section, sections, segments);
  }, [section, sections, segments]);

  if (isEditing) {
    return (
      <SectionEditor
        mode="edit"
        sectionId={section.id}
        initialTitle={section.title}
        initialDescription={section.description}
      />
    );
  }

  return (
    <div className="section-header" onClick={(e) => e.stopPropagation()}>
      <div className="section-header-top">
        <span className="section-number">{index + 1}</span>
        <h2 className="section-title">{section.title}</h2>
        {timeRange && (
          <span className="section-time-range">{timeRange}</span>
        )}
        <div className="section-header-actions">
          <button
            type="button"
            className="section-action-btn"
            onClick={handleEdit}
            aria-label="Edit section"
          >
            ✏️
          </button>
          <button
            type="button"
            className="section-action-btn"
            onClick={handleDelete}
            aria-label="Delete section"
          >
            🗑
          </button>
        </div>
      </div>
      {section.description && (
        <p className="section-description">{section.description}</p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function computeSectionTimeRange(
  section: Section,
  allSections: Section[],
  segments: TranscriptSegmentView[]
): string | null {
  if (segments.length === 0) return null;

  const sorted = [...allSections].sort(
    (a, b) => a.beforeSequenceId - b.beforeSequenceId
  );
  const sectionIndex = sorted.findIndex((s) => s.id === section.id);

  // Find the next section's beforeSequenceId (if any)
  const nextSection = sorted[sectionIndex + 1];

  // Get segments that belong to this section
  const sectionSegments = segments.filter((seg) => {
    if (seg.sequenceId < section.beforeSequenceId) return false;
    if (nextSection && seg.sequenceId >= nextSection.beforeSequenceId) return false;
    return true;
  });

  if (sectionSegments.length === 0) return null;

  const first = sectionSegments[0];
  const last = sectionSegments[sectionSegments.length - 1];
  return `${first.timestamp} – ${last.timestamp}`;
}
