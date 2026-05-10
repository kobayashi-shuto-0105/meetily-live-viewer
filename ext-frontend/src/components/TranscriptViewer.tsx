import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MouseEvent } from "react";
import { useTranscriptStore, selectSortedSegments } from "../stores/transcriptStore";
import { TranscriptSegment } from "./TranscriptSegment";
import { SectionInsertButton } from "./SectionInsertButton";
import { SectionEditor } from "./SectionEditor";
import { SectionHeader } from "./SectionHeader";

// ----------------------------------------------------------------
// TranscriptViewer
// ----------------------------------------------------------------

export function TranscriptViewer() {
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

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    requestAnimationFrame(() => {
      scrollEl.scrollTo({
        top: scrollEl.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [segments.length]);

  const handleBackdropClick = useCallback(
    (e: MouseEvent) => {
      if (e.target === e.currentTarget) setSelectedSegmentId(null);
    },
    [setSelectedSegmentId]
  );

  return (
    <main className="transcript-viewer">
      <div ref={scrollRef} className="transcript-scroll" onClick={handleBackdropClick}>
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
                <div key={segment.id} className="segment-with-section">
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
                    <SectionHeader section={section} index={sectionIdx} />
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
                        <SectionHeader section={trailingSection} index={trailingSectionIdx} />
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
}

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
