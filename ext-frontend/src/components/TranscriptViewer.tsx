import { useCallback, useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from "react";
import type { MouseEvent } from "react";
import { useTranscriptStore, selectSortedSegments } from "../stores/transcriptStore";
import { TranscriptSegment } from "./TranscriptSegment";
import { SectionInsertButton } from "./SectionInsertButton";
import { SectionEditor } from "./SectionEditor";
import { SectionHeader } from "./SectionHeader";

// ----------------------------------------------------------------
// Constants
// ----------------------------------------------------------------

/** Pixel tolerance for detecting "at bottom" of scroll container */
const SCROLL_BOTTOM_THRESHOLD = 60;
/** Pixel tolerance for section offset comparison during jump navigation */
const SECTION_OFFSET_TOLERANCE = 10;

// ----------------------------------------------------------------
// Public imperative handle for external scroll control
// ----------------------------------------------------------------

export interface TranscriptViewerHandle {
  scrollToSection: (beforeSequenceId: number) => void;
  scrollToSegment: (segmentId: string) => void;
  jumpSectionUp: () => void;
  jumpSectionDown: () => void;
}

// ----------------------------------------------------------------
// TranscriptViewer
// ----------------------------------------------------------------

export const TranscriptViewer = forwardRef<TranscriptViewerHandle>(
  function TranscriptViewer(_props, ref) {
  const segments = useTranscriptStore(selectSortedSegments);
  const session = useTranscriptStore((s) => s.session);
  const setSelectedSegmentId = useTranscriptStore((s) => s.setSelectedSegmentId);
  const sections = useTranscriptStore((s) => s.sections);
  const sectionInsertAt = useTranscriptStore((s) => s.sectionInsertAt);

  // sections is always pre-sorted by the store; build O(1) lookup maps
  const sectionsMap = useMemo(
    () => new Map(sections.map((s) => [s.beforeSequenceId, s] as const)),
    [sections]
  );
  const sectionIndexMap = useMemo(
    () => new Map(sections.map((s, i) => [s.id, i] as const)),
    [sections]
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // --- Auto-follow mode ---
  const [followMode, setFollowMode] = useState(true);

  // Detect user scroll to toggle follow mode
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // If scrolled to bottom (within 60px tolerance), enable follow
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD;
    setFollowMode(atBottom);
  }, []);

  // Auto-scroll when new segments arrive (only if followMode)
  useEffect(() => {
    if (!followMode) return;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    requestAnimationFrame(() => {
      scrollEl.scrollTo({
        top: scrollEl.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [segments.length, followMode]);

  // --- Section jump navigation ---
  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.beforeSequenceId - b.beforeSequenceId),
    [sections]
  );

  const scrollToSequenceId = useCallback((seqId: number) => {
    const el = scrollRef.current;
    if (!el) return;
    // Find the DOM element for the segment with this sequenceId
    const segEl = el.querySelector(`[data-sequence-id="${seqId}"]`);
    if (segEl) {
      segEl.scrollIntoView({ behavior: "smooth", block: "start" });
      setFollowMode(false);
    }
  }, []);

  const scrollToSegmentById = useCallback((segmentId: string) => {
    const el = scrollRef.current;
    if (!el) return;
    const segEl = el.querySelector(`[data-segment-id="${segmentId}"]`);
    if (segEl) {
      segEl.scrollIntoView({ behavior: "smooth", block: "center" });
      setFollowMode(false);
    }
  }, []);

  const jumpSectionUp = useCallback(() => {
    if (sortedSections.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;

    const getSectionTop = (secEl: Element) => {
      const sectionRect = secEl.getBoundingClientRect();
      const containerRect = el.getBoundingClientRect();
      return sectionRect.top - containerRect.top + el.scrollTop;
    };

    // Find current visible section by scroll position
    const currentTop = el.scrollTop;
    // Find the last section header that is above the current scroll position
    let targetSection = sortedSections[0];
    for (let i = sortedSections.length - 1; i >= 0; i--) {
      const secEl = el.querySelector(`[data-section-id="${sortedSections[i].id}"]`);
      if (secEl && getSectionTop(secEl) < currentTop - SECTION_OFFSET_TOLERANCE) {
        targetSection = sortedSections[i];
        break;
      }
    }
    scrollToSequenceId(targetSection.beforeSequenceId);
  }, [sortedSections, scrollToSequenceId]);

  const jumpSectionDown = useCallback(() => {
    if (sortedSections.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;

    const getSectionTop = (secEl: Element) => {
      const sectionRect = secEl.getBoundingClientRect();
      const containerRect = el.getBoundingClientRect();
      return sectionRect.top - containerRect.top + el.scrollTop;
    };

    const currentTop = el.scrollTop;
    // Find the first section header that is below the current scroll position
    for (const sec of sortedSections) {
      const secEl = el.querySelector(`[data-section-id="${sec.id}"]`);
      if (secEl && getSectionTop(secEl) > currentTop + SECTION_OFFSET_TOLERANCE) {
        scrollToSequenceId(sec.beforeSequenceId);
        return;
      }
    }
    // If none found, scroll to last section
    const last = sortedSections[sortedSections.length - 1];
    scrollToSequenceId(last.beforeSequenceId);
  }, [sortedSections, scrollToSequenceId]);

  // Expose imperative methods
  useImperativeHandle(ref, () => ({
    scrollToSection: scrollToSequenceId,
    scrollToSegment: scrollToSegmentById,
    jumpSectionUp,
    jumpSectionDown,
  }), [scrollToSequenceId, scrollToSegmentById, jumpSectionUp, jumpSectionDown]);

  const handleBackdropClick = useCallback(
    (e: MouseEvent) => {
      if (e.target === e.currentTarget) setSelectedSegmentId(null);
    },
    [setSelectedSegmentId]
  );

  return (
    <main className="transcript-viewer">
      {/* Follow mode indicator */}
      {!followMode && segments.length > 0 && (
        <button
          className="follow-mode-btn"
          onClick={() => {
            setFollowMode(true);
            const el = scrollRef.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          }}
          aria-label="リアルタイム追従モードに戻る"
        >
          ↓ 追従モードに戻る
        </button>
      )}

      <div ref={scrollRef} className="transcript-scroll" onClick={handleBackdropClick} onScroll={handleScroll}>
        <div className="transcript-stage">
          {segments.length === 0 ? (
            <EmptyState session={session} />
          ) : (
            segments.map((segment, index) => {
              const section = sectionsMap.get(segment.sequenceId);
              const sectionIdx = section ? (sectionIndexMap.get(section.id) ?? -1) : -1;
              const isInsertingHere = sectionInsertAt === segment.sequenceId;
              const isLast = index === segments.length - 1;
              const trailingSeqId = segment.sequenceId + 1;
              const trailingSection = isLast ? sectionsMap.get(trailingSeqId) : undefined;
              const trailingSectionIdx = trailingSection
                ? (sectionIndexMap.get(trailingSection.id) ?? -1)
                : -1;

              return (
                <div
                  key={segment.id}
                  className="segment-with-section"
                  data-segment-id={segment.id}
                  data-sequence-id={segment.sequenceId}
                >
                  {/* Hover-reveal insert button */}
                  <SectionInsertButton beforeSequenceId={segment.sequenceId} />

                  {/* Inline editor for new section */}
                  {isInsertingHere && (
                    <SectionEditor
                      mode="create"
                      beforeSequenceId={segment.sequenceId}
                    />
                  )}

                  {/* Existing section header */}
                  {section && (
                    <div data-section-id={section.id}>
                      <SectionHeader section={section} index={sectionIdx} />
                    </div>
                  )}

                  {/* Segment itself */}
                  <TranscriptSegment segment={segment} />

                  {/* After the last segment: insert button + optional trailing section header */}
                  {isLast && (
                    <>
                      <SectionInsertButton beforeSequenceId={trailingSeqId} />
                      {sectionInsertAt === trailingSeqId && (
                        <SectionEditor
                          mode="create"
                          beforeSequenceId={trailingSeqId}
                        />
                      )}
                      {trailingSection && (
                        <div data-section-id={trailingSection.id}>
                          <SectionHeader section={trailingSection} index={trailingSectionIdx} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
});


function EmptyState({ session }: { session: { isStopped: boolean } | null }) {
  return (
    <div className="empty-state">
      <span className="empty-state-mark" />
      <span>
        {session && !session.isStopped
          ? "Waiting for transcription..."
          : "No segments yet"}
      </span>
    </div>
  );
}
