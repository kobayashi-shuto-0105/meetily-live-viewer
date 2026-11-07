import { useCallback } from "react";
import type { MouseEvent } from "react";
import { useTranscriptStore } from "../stores/transcriptStore";

// ----------------------------------------------------------------
// SectionInsertButton
// ----------------------------------------------------------------
// Hover-reveal "+" button rendered between segments.
// Clicking opens the inline section editor at this position.

interface Props {
  beforeSequenceId: number;
}

export function SectionInsertButton({ beforeSequenceId }: Props) {
  const openSectionInsert = useTranscriptStore((s) => s.openSectionInsert);
  const sectionInsertAt = useTranscriptStore((s) => s.sectionInsertAt);
  const sections = useTranscriptStore((s) => s.sections);

  const handleClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      openSectionInsert(beforeSequenceId);
    },
    [beforeSequenceId, openSectionInsert]
  );

  // Don't show button if a section already exists at this position
  const hasSection = sections.some(
    (s) => s.beforeSequenceId === beforeSequenceId
  );
  if (hasSection) return null;

  // Don't show if editor is already open at this position
  const isActive = sectionInsertAt === beforeSequenceId;
  if (isActive) return null;

  return (
    <div className="section-insert-zone">
      <button
        type="button"
        className="section-insert-btn"
        onClick={handleClick}
        aria-label="Add section boundary"
      >
        +
      </button>
      <span className="section-insert-line" />
    </div>
  );
}
