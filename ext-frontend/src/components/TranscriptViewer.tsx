import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { useTranscriptStore, selectSortedSegments } from "../stores/transcriptStore";
import { TranscriptSegment } from "./TranscriptSegment";

// ----------------------------------------------------------------
// TranscriptViewer
// ----------------------------------------------------------------

export function TranscriptViewer() {
  const segments = useTranscriptStore(selectSortedSegments);
  const session = useTranscriptStore((s) => s.session);
  const setSelectedSegmentId = useTranscriptStore((s) => s.setSelectedSegmentId);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments.length]);

  const handleBackdropClick = useCallback(
    (e: MouseEvent) => {
      if (e.target === e.currentTarget) setSelectedSegmentId(null);
    },
    [setSelectedSegmentId]
  );

  return (
    <main className="transcript-viewer">
      <div className="transcript-scroll" onClick={handleBackdropClick}>
        <div className="transcript-stage">
          {segments.length === 0 ? (
            <EmptyState session={session} />
          ) : (
            segments.map((segment) => (
              <TranscriptSegment key={segment.id} segment={segment} />
            ))
          )}
          <div ref={bottomRef} />
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
