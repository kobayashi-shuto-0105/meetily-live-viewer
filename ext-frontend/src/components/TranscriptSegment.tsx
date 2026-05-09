import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { TranscriptSegmentView } from "../types";
import { useTranscriptStore } from "../stores/transcriptStore";
import { apiClient } from "../api/client";
import { TranscriptEditor } from "./TranscriptEditor";

// ----------------------------------------------------------------
// Highlight type helpers
// ----------------------------------------------------------------

type HighlightKind = "todo" | "fixme" | null;

function getHighlightKind(highlights: TranscriptSegmentView["highlights"]): HighlightKind {
  if (highlights.some((h) => h.color === "fixme" || h.color === "red")) return "fixme";
  if (highlights.some((h) => h.color === "todo" || h.color === "yellow")) return "todo";
  return null;
}

// ----------------------------------------------------------------
// TranscriptSegment
// ----------------------------------------------------------------

interface Props {
  segment: TranscriptSegmentView;
}

export function TranscriptSegment({ segment }: Props) {
  const selectedSegmentId = useTranscriptStore((s) => s.selectedSegmentId);
  const commentInputSegmentId = useTranscriptStore((s) => s.commentInputSegmentId);
  const setSelectedSegmentId = useTranscriptStore((s) => s.setSelectedSegmentId);
  const openCommentInput = useTranscriptStore((s) => s.openCommentInput);

  const isSelected = selectedSegmentId === segment.id;
  const isCommenting = commentInputSegmentId === segment.id;

  const [isEditing, setIsEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [highlightLoading, setHighlightLoading] = useState<"todo" | "fixme" | null>(null);

  const cardRef = useRef<HTMLElement>(null);

  const shouldShowEditor = isSelected && isEditing;
  const shouldShowHistory = isSelected && showHistory;

  useEffect(() => {
    if (isSelected && !shouldShowEditor && !isCommenting) {
      cardRef.current?.focus();
    }
  }, [isSelected, shouldShowEditor, isCommenting]);

  const handleClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (!isSelected) {
        setIsEditing(false);
        setShowHistory(false);
      }
      setSelectedSegmentId(segment.id);
    },
    [isSelected, segment.id, setSelectedSegmentId]
  );

  const addHighlight = useCallback(
    async (kind: "todo" | "fixme") => {
      if (highlightLoading) return;
      const existing = segment.highlights.find(
        (h) =>
          h.color === kind ||
          (kind === "todo" && h.color === "yellow") ||
          (kind === "fixme" && h.color === "red")
      );
      if (existing) return;

      setHighlightLoading(kind);
      try {
        await apiClient.createHighlight(segment.id, { color: kind });
      } finally {
        setHighlightLoading(null);
      }
    },
    [segment.id, segment.highlights, highlightLoading]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;

      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setIsEditing(true);
        return;
      }

      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        openCommentInput(segment.id);
        return;
      }

      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        addHighlight("todo");
        return;
      }

      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        addHighlight("fixme");
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedSegmentId(null);
      }
    },
    [addHighlight, openCommentInput, segment.id, setSelectedSegmentId]
  );

  const highlightKind = getHighlightKind(segment.highlights);
  const commentCount = segment.comments.length;
  const hasRevision = segment.revisions.length > 0;
  const hasSidecar = isSelected && (isCommenting || commentCount > 0);

  return (
    <div className={`segment-row ${hasSidecar ? "has-sidecar" : ""}`}>
      <article
        ref={cardRef}
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={[
          "segment-card",
          isSelected ? "is-selected" : "",
          highlightKind ? `has-${highlightKind}` : "",
        ].join(" ")}
      >
        {shouldShowEditor ? (
          <TranscriptEditor
            segmentId={segment.id}
            currentText={segment.displayText}
            onClose={() => {
              setIsEditing(false);
              cardRef.current?.focus();
            }}
          />
        ) : (
          <>
            <div className="segment-main-line">
              {highlightKind === "todo" && <Badge tone="todo">TODO</Badge>}
              {highlightKind === "fixme" && <Badge tone="fixme">FIXME</Badge>}
              <p className={`segment-text ${segment.isPartial ? "is-partial" : ""}`}>
                {segment.displayText}
                {segment.isPartial && <span className="partial-label">recognizing...</span>}
              </p>
            </div>

            {(commentCount > 0 || hasRevision) && (
              <div className="segment-meta">
                {commentCount > 0 && (
                  <span>{commentCount} comment{commentCount > 1 ? "s" : ""}</span>
                )}
                {hasRevision && <span>v{segment.revisions.length}</span>}
              </div>
            )}

            {isSelected && (
              <div className="segment-shortcuts">
                <ShortcutHint keys="Enter" label="Edit" />
                <ShortcutHint keys="T" label="TODO" loading={highlightLoading === "todo"} />
                <ShortcutHint keys="F" label="FIXME" loading={highlightLoading === "fixme"} />
                <ShortcutHint keys="⌘ Enter" label="Comment" />
                {hasRevision && (
                  <button
                    className="history-toggle"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowHistory((v) => !v);
                    }}
                  >
                    {showHistory ? "Hide history" : "Edit history"}
                  </button>
                )}
              </div>
            )}

            {shouldShowHistory && hasRevision && <EditHistory segment={segment} />}
          </>
        )}
      </article>

      {hasSidecar && (
        <SegmentSidecar segment={segment} isCommenting={isCommenting} />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Segment side comment card
// ----------------------------------------------------------------

function SegmentSidecar({
  segment,
  isCommenting,
}: {
  segment: TranscriptSegmentView;
  isCommenting: boolean;
}) {
  return (
    <aside className="segment-sidecar" onClick={(e) => e.stopPropagation()}>
      {isCommenting && <CommentComposer segmentId={segment.id} />}
      {segment.comments.length > 0 && <SegmentComments segment={segment} />}
    </aside>
  );
}

function CommentComposer({ segmentId }: { segmentId: string }) {
  const closeCommentInput = useTranscriptStore((s) => s.closeCommentInput);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);
    try {
      await apiClient.createComment(segmentId, { commentText: trimmed });
      setText("");
      closeCommentInput();
    } catch {
      setError("Failed to send. Please try again.");
    } finally {
      setSending(false);
    }
  }, [closeCommentInput, segmentId, sending, text]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setText("");
        closeCommentInput();
      }
    },
    [closeCommentInput, submit]
  );

  return (
    <div className="comment-card comment-composer">
      <div className="comment-card-title">Comment</div>
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={sending}
        rows={4}
        placeholder="Add comment..."
      />
      {error && <div className="comment-error">{error}</div>}
      <div className="comment-actions">
        <span>⌘ Enter to send</span>
        <button type="button" onClick={closeCommentInput} disabled={sending}>
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={!text.trim() || sending}>
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}

function SegmentComments({ segment }: { segment: TranscriptSegmentView }) {
  return (
    <div className="comment-card comment-thread">
      <div className="comment-card-title">Comments</div>
      <div className="comment-list">
        {segment.comments.map((comment) => (
          <div className="comment-item" key={comment.id}>
            {comment.comment_text}
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Edit history panel
// ----------------------------------------------------------------

function EditHistory({ segment }: { segment: TranscriptSegmentView }) {
  const sorted = [...segment.revisions].sort((a, b) => a.version - b.version);

  return (
    <div className="edit-history">
      <div className="edit-history-title">Edit History</div>
      <div className="edit-history-row is-muted">
        <span>v0</span>
        <del>{segment.rawText}</del>
      </div>

      {sorted.map((revision, index) => (
        <div
          key={revision.id}
          className={`edit-history-row ${index === sorted.length - 1 ? "is-current" : ""}`}
        >
          <span>v{revision.version}</span>
          <span>{revision.edited_text}</span>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------

function Badge({
  tone,
  children,
}: {
  tone: "todo" | "fixme";
  children: ReactNode;
}) {
  return <span className={`segment-badge segment-badge-${tone}`}>{children}</span>;
}

function ShortcutHint({
  keys,
  label,
  loading,
}: {
  keys: string;
  label: string;
  loading?: boolean;
}) {
  return (
    <span className="shortcut-hint">
      <kbd>{keys}</kbd>
      <span>{loading ? "..." : label}</span>
    </span>
  );
}
