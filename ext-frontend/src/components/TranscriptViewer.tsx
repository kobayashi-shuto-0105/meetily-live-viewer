import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { useTranscriptStore, selectSortedSegments, selectSectionsMap } from "../stores/transcriptStore";
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
  const sectionsMap = useTranscriptStore(selectSectionsMap);
  const sections = useTranscriptStore((s) => s.sections);
  const sectionInsertAt = useTranscriptStore((s) => s.sectionInsertAt);

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

  // Compute section index for numbering
  const sortedSections = [...sections].sort(
    (a, b) => a.beforeSequenceId - b.beforeSequenceId
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
              const sectionIdx = section
                ? sortedSections.findIndex((s) => s.id === section.id)
                : -1;
              const isInsertingHere = sectionInsertAt === segment.sequenceId;

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

                  {/* After the last segment, show another insert button */}
                  {index === segments.length - 1 && (
                    <>
                      <SectionInsertButton
                        beforeSequenceId={segment.sequenceId + 1}
                      />
                      {sectionInsertAt === segment.sequenceId + 1 && (
                        <SectionEditor
                          mode="create"
                          beforeSequenceId={segment.sequenceId + 1}
                        />
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
