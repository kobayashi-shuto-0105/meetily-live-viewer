import { useEffect, useRef, useCallback, useState } from "react";
import { useTranscriptStore, selectSortedSegments } from "../stores/transcriptStore";
import { TranscriptSegment } from "./TranscriptSegment";
import { apiClient } from "../api/client";

// ----------------------------------------------------------------
// TranscriptViewer
// ----------------------------------------------------------------

export function TranscriptViewer() {
  const segments = useTranscriptStore(selectSortedSegments);
  const session = useTranscriptStore((s) => s.session);
  const selectedSegmentId = useTranscriptStore((s) => s.selectedSegmentId);
  const commentInputTrigger = useTranscriptStore((s) => s.commentInputTrigger);
  const setSelectedSegmentId = useTranscriptStore((s) => s.setSelectedSegmentId);

  const bottomRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll when new segments arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments.length]);

  // Focus comment input when ⌘+Enter is pressed on a selected segment
  useEffect(() => {
    if (commentInputTrigger > 0) {
      commentInputRef.current?.focus();
    }
  }, [commentInputTrigger]);

  const selectedSegment = selectedSegmentId
    ? segments.find((s) => s.id === selectedSegmentId) ?? null
    : null;

  // Click on backdrop deselects
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) setSelectedSegmentId(null);
    },
    [setSelectedSegmentId]
  );

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        overflow: "hidden",
      }}
    >
      {/* ── Left: transcript list ──────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRight: "1px solid var(--border-subtle)",
        }}
        onClick={handleBackdropClick}
      >
        {/* Session info strip */}
        {session && (
          <div
            style={{
              padding: "0.5rem 1.25rem",
              borderBottom: "1px solid var(--border-subtle)",
              fontSize: "0.75rem",
              color: "var(--text-3)",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              background: "var(--bg-surface)",
            }}
          >
            <span style={{ color: session.isStopped ? "var(--text-3)" : "var(--ok)" }}>
              {session.isStopped ? "Recording stopped" : "Recording…"}
            </span>
            {session.meetingId && (
              <span style={{ color: "var(--ok)" }}>Saved</span>
            )}
            <span style={{ marginLeft: "auto", fontFamily: "monospace" }}>
              {new Date(session.startedAt).toLocaleTimeString()}
            </span>
          </div>
        )}

        {/* Segment list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem 0" }}>
          {segments.length === 0 ? (
            <EmptyState session={session} />
          ) : (
            segments.map((segment) => (
              <TranscriptSegment key={segment.id} segment={segment} />
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Bottom comment input (visible when a segment is selected) */}
        {selectedSegmentId && (
          <CommentInput
            segmentId={selectedSegmentId}
            inputRef={commentInputRef}
            onSubmit={() => setSelectedSegmentId(null)}
          />
        )}
      </div>

      {/* ── Right: comment sidebar ─────────────────────────── */}
      <div
        style={{
          width: "280px",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-surface)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "0.75rem 1rem",
            borderBottom: "1px solid var(--border-subtle)",
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "var(--text-2)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Comments
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem" }}>
          {!selectedSegment ? (
            <div
              style={{
                padding: "2rem 1rem",
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: "0.8rem",
                lineHeight: 1.7,
              }}
            >
              Click a segment to view&nbsp;its comments
            </div>
          ) : selectedSegment.comments.length === 0 ? (
            <div
              style={{
                padding: "2rem 1rem",
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: "0.8rem",
                lineHeight: 1.7,
              }}
            >
              No comments yet.
              <br />
              Press <Kbd>⌘ Enter</Kbd> to add one.
            </div>
          ) : (
            selectedSegment.comments.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: "0.6rem 0.75rem",
                  marginBottom: "0.4rem",
                  background: "var(--bg-surface2)",
                  borderRadius: "8px",
                  fontSize: "0.82rem",
                  animation: "fadeIn 0.15s ease",
                }}
              >
                {c.author_name && (
                  <div
                    style={{
                      fontWeight: 600,
                      color: "var(--accent)",
                      fontSize: "0.75rem",
                      marginBottom: "0.2rem",
                    }}
                  >
                    {c.author_name}
                  </div>
                )}
                <div style={{ color: "var(--text-1)", lineHeight: 1.5 }}>
                  {c.comment_text}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Bottom comment input
// ----------------------------------------------------------------

interface CommentInputProps {
  segmentId: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSubmit: () => void;
}

function CommentInput({ segmentId, inputRef, onSubmit }: CommentInputProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await apiClient.createComment(segmentId, { commentText: trimmed });
      setText("");
      onSubmit();
    } catch {
      // keep text so user can retry
    } finally {
      setSending(false);
    }
  }, [text, sending, segmentId, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setText("");
    }
  };

  return (
    <div
      style={{
        borderTop: "1px solid var(--border-subtle)",
        padding: "0.6rem 1rem",
        display: "flex",
        alignItems: "flex-end",
        gap: "0.5rem",
        background: "var(--bg-surface)",
        animation: "fadeIn 0.1s ease",
      }}
    >
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={sending}
        rows={1}
        placeholder="Add comment… (⌘ Enter to send)"
        style={{
          flex: 1,
          resize: "none",
          background: "var(--bg-surface2)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          color: "var(--text-1)",
          padding: "0.45rem 0.7rem",
          fontSize: "0.85rem",
          lineHeight: 1.5,
          outline: "none",
          opacity: sending ? 0.6 : 1,
          maxHeight: "120px",
          overflowY: "auto",
        }}
      />
      <button
        onClick={submit}
        disabled={!text.trim() || sending}
        style={{
          background: text.trim() && !sending ? "var(--accent)" : "var(--bg-surface2)",
          color: text.trim() && !sending ? "#fff" : "var(--text-3)",
          border: "none",
          borderRadius: "8px",
          padding: "0.45rem 0.85rem",
          fontSize: "0.8rem",
          fontWeight: 500,
          transition: "background 0.15s",
        }}
      >
        Send
      </button>
    </div>
  );
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        background: "var(--bg-surface2)",
        border: "1px solid var(--border)",
        borderRadius: "4px",
        padding: "0.1rem 0.35rem",
        fontSize: "0.72rem",
        fontFamily: "monospace",
        color: "var(--text-2)",
      }}
    >
      {children}
    </kbd>
  );
}

function EmptyState({ session }: { session: { isStopped: boolean } | null }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: "0.5rem",
        color: "var(--text-3)",
        fontSize: "0.85rem",
      }}
    >
      {session && !session.isStopped ? (
        <>
          <span style={{ fontSize: "1.4rem" }}>🎙</span>
          Waiting for transcription…
        </>
      ) : (
        <>
          <span style={{ fontSize: "1.4rem" }}>📄</span>
          No segments yet
        </>
      )}
    </div>
  );
}
