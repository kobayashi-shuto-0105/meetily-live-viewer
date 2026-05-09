import { useState, useCallback, useRef, useEffect } from "react";
import { apiClient } from "../api/client";

interface Props {
  segmentId: string;
  currentText: string;
  onClose: () => void;
}

export function TranscriptEditor({ segmentId, currentText, onClose }: Props) {
  const [editedText, setEditedText] = useState(currentText);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    // Place cursor at end
    const len = currentText.length;
    textareaRef.current?.setSelectionRange(len, len);
  }, [currentText]);

  const handleSave = useCallback(async () => {
    if (editedText.trim() === currentText.trim()) { onClose(); return; }
    if (!editedText.trim()) { setError("Text cannot be empty."); return; }

    setIsSaving(true);
    setError(null);

    try {
      await apiClient.createRevision(segmentId, { editedText: editedText.trim() });
      onClose();
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [editedText, currentText, segmentId, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [handleSave, onClose]
  );

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginTop: "0.4rem",
        padding: "0.5rem",
        border: "1px solid var(--accent)",
        borderRadius: "6px",
        background: "var(--bg-surface2)",
        animation: "fadeIn 0.1s ease",
      }}
    >
      <textarea
        ref={textareaRef}
        value={editedText}
        onChange={(e) => setEditedText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isSaving}
        rows={3}
        style={{
          width: "100%",
          padding: "0.4rem 0.6rem",
          background: "var(--bg-app)",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          color: "var(--text-1)",
          fontSize: "0.88rem",
          lineHeight: 1.6,
          resize: "vertical",
          outline: "none",
          opacity: isSaving ? 0.6 : 1,
          boxSizing: "border-box",
        }}
      />

      {error && (
        <div
          style={{
            marginTop: "0.25rem",
            color: "var(--err)",
            fontSize: "0.78rem",
            padding: "0.2rem 0.4rem",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginTop: "0.4rem",
        }}
      >
        <span style={{ fontSize: "0.72rem", color: "var(--text-3)", flex: 1 }}>
          ⌘ Enter to save · Esc to cancel
        </span>
        <button
          onClick={onClose}
          disabled={isSaving}
          style={{
            padding: "0.25rem 0.65rem",
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            color: "var(--text-2)",
            fontSize: "0.8rem",
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          style={{
            padding: "0.25rem 0.65rem",
            background: isSaving ? "var(--accent-dim)" : "var(--accent)",
            border: "none",
            borderRadius: "4px",
            color: "#fff",
            fontSize: "0.8rem",
            fontWeight: 500,
          }}
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
