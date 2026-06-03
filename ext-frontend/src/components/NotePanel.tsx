import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "../api/client";
import { loadAuthorName } from "../stores/authorName";
import { useTranscriptStore } from "../stores/transcriptStore";

const NOTE_PLACEHOLDER = `Meeting overview
A productive discussion on product direction, key takeaways, and next steps.

Key takeaways
- Users love the simplicity and speed.
- The onboarding flow needs refinement.
- AI summary feature is delivering value.

Action items
- Refine onboarding flow
- Add calendar integration
- Share beta feedback with team

Next steps
Align on onboarding updates, prioritize integrations, and continue gathering feedback.`;

// ----------------------------------------------------------------
// NotePanel – Collaborative glass note editor on the left side.
// ----------------------------------------------------------------

export function NotePanel() {
  const session = useTranscriptStore((s) => s.session);
  const notesContent = useTranscriptStore((s) => s.notesContent);
  const notesUpdatedBy = useTranscriptStore((s) => s.notesUpdatedBy);
  const notesUpdatedAt = useTranscriptStore((s) => s.notesUpdatedAt);
  const setNotesContent = useTranscriptStore((s) => s.setNotesContent);
  const loadNotes = useTranscriptStore((s) => s.loadNotes);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSavedRef = useRef(notesContent);

  useEffect(() => {
    lastSavedRef.current = notesContent;
  }, [session?.sessionId]);

  useEffect(() => {
    if (!session?.sessionId) return;
    let cancelled = false;
    apiClient
      .getSessionNotes(session.sessionId)
      .then((note) => {
        if (!cancelled) {
          loadNotes(note);
          lastSavedRef.current = note.content;
        }
      })
      .catch((error) => {
        console.warn("[notes] Failed to load shared notes:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.sessionId, loadNotes]);

  useEffect(() => {
    if (!session?.sessionId) return;
    if (notesContent === lastSavedRef.current) return;

    setSaveState("saving");
    const timeout = window.setTimeout(() => {
      apiClient
        .updateSessionNotes(session.sessionId, {
          content: notesContent,
          authorName: loadAuthorName() ?? undefined,
        })
        .then((note) => {
          lastSavedRef.current = note.content;
          loadNotes(note);
          setSaveState("saved");
        })
        .catch((error) => {
          console.warn("[notes] Failed to save shared notes:", error);
          setSaveState("error");
        });
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [session?.sessionId, notesContent, loadNotes]);

  const statusLabel = useMemo(() => {
    if (!session) return "Preview";
    if (saveState === "saving") return "Saving";
    if (saveState === "error") return "Offline";
    if (notesUpdatedBy && notesUpdatedAt) return `Updated by ${notesUpdatedBy}`;
    if (saveState === "saved") return "Saved";
    return "Shared";
  }, [notesUpdatedAt, notesUpdatedBy, saveState, session]);

  return (
    <aside className="note-panel">
      <div className="note-panel-content">
        <div className="note-panel-topline">
          <p className="note-panel-title">Notes</p>
          <span className={`note-sync-state is-${saveState}`}>{statusLabel}</span>
        </div>
        <textarea
          className="note-editor"
          value={notesContent}
          onChange={(event) => setNotesContent(event.target.value)}
          placeholder={NOTE_PLACEHOLDER}
          spellCheck
          aria-label="Shared notes"
        />
      </div>
    </aside>
  );
}
