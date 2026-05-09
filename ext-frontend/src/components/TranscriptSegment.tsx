import { useState, useRef, useCallback, useEffect } from "react";
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
  const setSelectedSegmentId = useTranscriptStore((s) => s.setSelectedSegmentId);
  const triggerCommentInput = useTranscriptStore((s) => s.triggerCommentInput);

  const isSelected = selectedSegmentId === segment.id;

  const [isEditing, setIsEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [highlightLoading, setHighlightLoading] = useState<"todo" | "fixme" | null>(null);

  const divRef = useRef<HTMLDivElement>(null);

  // When selected, show history
  useEffect(() => {
    if (!isSelected) {
      setIsEditing(false);
      setShowHistory(false);
    }
  }, [isSelected]);

  // Focus div when it becomes selected (enables keyboard events)
  useEffect(() => {
    if (isSelected && !isEditing) {
      divRef.current?.focus();
    }
  }, [isSelected, isEditing]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedSegmentId(segment.id);
    },
    [segment.id, setSelectedSegmentId]
  );

  const addHighlight = useCallback(
    async (kind: "todo" | "fixme") => {
      if (highlightLoading) return;
      // Don't add if already exists
      const existing = segment.highlights.find(
        (h) => h.color === kind || (kind === "todo" && h.color === "yellow") || (kind === "fixme" && h.color === "red")
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
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Only handle when the segment div itself (not a child) has focus
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;

      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setIsEditing(true);
        return;
      }

      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        triggerCommentInput();
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
        return;
      }
    },
    [addHighlight, setSelectedSegmentId, triggerCommentInput]
  );

  const highlightKind = getHighlightKind(segment.highlights);
  const commentCount = segment.comments.length;
  const hasRevision = segment.revisions.length > 0;

  const leftBorderColor =
    highlightKind === "fixme"
      ? "var(--fixme-color)"
      : highlightKind === "todo"
      ? "var(--todo-color)"
      : isSelected
      ? "var(--accent)"
      : "transparent";

  return (
    <div
      ref={divRef}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{
        position: "relative",
        padding: "0.65rem 1.25rem 0.65rem 1.05rem",
        cursor: "pointer",
        outline: "none",
        borderLeft: `3px solid ${leftBorderColor}`,
        background: isSelected ? "var(--bg-selected)" : "transparent",
        transition: "background 0.12s, border-left-color 0.12s",
        animation: "fadeIn 0.15s ease",
      }}
      onMouseEnter={(e) => {
        if (!isSelected)
          (e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected)
          (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
    >
      {/* ── Highlight badges ─────────────────────────────── */}
      {highlightKind && (
        <div
          style={{
            display: "flex",
            gap: "0.35rem",
            marginBottom: "0.35rem",
          }}
        >
          {highlightKind === "todo" && <Badge color="var(--todo-color)" bg="var(--todo-bg)">TODO</Badge>}
          {highlightKind === "fixme" && <Badge color="var(--fixme-color)" bg="var(--fixme-bg)">FIXME</Badge>}
        </div>
      )}

      {/* ── Main text ──────────────────────────────────── */}
      {isEditing ? (
        <TranscriptEditor
          segmentId={segment.id}
          currentText={segment.displayText}
          onClose={() => {
            setIsEditing(false);
            divRef.current?.focus();
          }}
        />
      ) : (
        <p
          style={{
            margin: 0,
            lineHeight: 1.65,
            color: segment.isPartial ? "var(--text-3)" : "var(--text-1)",
            fontStyle: segment.isPartial ? "italic" : undefined,
            fontSize: "0.9rem",
          }}
        >
          {segment.displayText}
          {segment.isPartial && (
            <span style={{ color: "var(--warn)", marginLeft: "0.4rem", fontSize: "0.75rem" }}>
              (recognizing…)
            </span>
          )}
        </p>
      )}

      {/* ── Metadata row (icons only, shown when segment has data) ── */}
      {!isEditing && (commentCount > 0 || hasRevision) && (
        <div
          style={{
            display: "flex",
            gap: "0.6rem",
            marginTop: "0.35rem",
            fontSize: "0.72rem",
            color: "var(--text-3)",
          }}
        >
          {commentCount > 0 && (
            <span title={`${commentCount} comment${commentCount > 1 ? "s" : ""}`}>
              💬 {commentCount}
            </span>
          )}
          {hasRevision && (
            <span title={`${segment.revisions.length} edit${segment.revisions.length > 1 ? "s" : ""}`}>
              ✏ v{segment.revisions.length}
            </span>
          )}
        </div>
      )}

      {/* ── Selected: keyboard hint + edit history ─────────── */}
      {isSelected && !isEditing && (
        <>
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              marginTop: "0.45rem",
              fontSize: "0.72rem",
              color: "var(--text-3)",
            }}
          >
            <ShortcutHint keys="Enter" label="Edit" />
            <ShortcutHint keys="T" label="TODO" loading={highlightLoading === "todo"} />
            <ShortcutHint keys="F" label="FIXME" loading={highlightLoading === "fixme"} />
            <ShortcutHint keys="⌘ Enter" label="Comment" />
            {hasRevision && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowHistory((v) => !v); }}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "var(--accent)",
                  fontSize: "0.72rem",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                {showHistory ? "Hide history" : "Edit history"}
              </button>
            )}
          </div>

          {showHistory && hasRevision && (
            <EditHistory segment={segment} />
          )}
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Edit history panel
// ----------------------------------------------------------------

function EditHistory({ segment }: { segment: TranscriptSegmentView }) {
  const sorted = [...segment.revisions].sort((a, b) => a.version - b.version);

  return (
    <div
      style={{
        marginTop: "0.5rem",
        padding: "0.5rem 0.6rem",
        background: "var(--bg-surface2)",
        borderRadius: "6px",
        fontSize: "0.78rem",
        animation: "fadeIn 0.12s ease",
      }}
    >
      <div
        style={{
          fontWeight: 600,
          color: "var(--text-2)",
          marginBottom: "0.35rem",
          fontSize: "0.72rem",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        Edit History
      </div>

      {/* Original */}
      <div style={{ marginBottom: "0.25rem", color: "var(--text-3)" }}>
        <span style={{ fontFamily: "monospace", marginRight: "0.4rem" }}>v0</span>
        <span style={{ textDecoration: "line-through" }}>{segment.rawText}</span>
      </div>

      {sorted.map((r, i) => (
        <div
          key={r.id}
          style={{
            color: i === sorted.length - 1 ? "var(--text-1)" : "var(--text-3)",
            marginBottom: "0.2rem",
          }}
        >
          <span style={{ fontFamily: "monospace", marginRight: "0.4rem" }}>
            v{r.version}
          </span>
          {r.edited_text}
          {i === sorted.length - 1 && (
            <span
              style={{
                marginLeft: "0.4rem",
                fontSize: "0.68rem",
                color: "var(--ok)",
              }}
            >
              (current)
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------

function Badge({
  color,
  bg,
  children,
}: {
  color: string;
  bg: string;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.1rem 0.45rem",
        borderRadius: "4px",
        fontSize: "0.68rem",
        fontWeight: 700,
        letterSpacing: "0.06em",
        color,
        background: bg,
      }}
    >
      {children}
    </span>
  );
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
    <span>
      <kbd
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "3px",
          padding: "0.05rem 0.3rem",
          fontFamily: "monospace",
          fontSize: "0.68rem",
          color: "var(--text-2)",
          marginRight: "0.2rem",
        }}
      >
        {keys}
      </kbd>
      <span style={{ color: loading ? "var(--warn)" : "var(--text-3)" }}>
        {loading ? "…" : label}
      </span>
    </span>
  );
}
