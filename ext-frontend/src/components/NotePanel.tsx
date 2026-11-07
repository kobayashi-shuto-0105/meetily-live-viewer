import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Block, PartialBlock } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import "@blocknote/core/fonts/inter.css";

import { apiClient } from "../api/client";
import { loadAuthorName } from "../stores/authorName";
import { useTranscriptStore } from "../stores/transcriptStore";
import {
  DEV_MOCK_NOTES_STORAGE_KEY,
  DEV_MOCK_SESSION_ID,
  parseDevMockNotes,
  readDevMockNotes,
} from "../devMockSession";
import type { SessionNotesResponse } from "../types";

// ----------------------------------------------------------------
// NotePanel – Collaborative glass BlockNote editor on the left side.
// ----------------------------------------------------------------

export function NotePanel() {
  const session = useTranscriptStore((s) => s.session);
  const sessionId = session?.sessionId;
  const notesContent = useTranscriptStore((s) => s.notesContent);
  const notesContentJson = useTranscriptStore((s) => s.notesContentJson);
  const notesUpdatedBy = useTranscriptStore((s) => s.notesUpdatedBy);
  const notesUpdatedAt = useTranscriptStore((s) => s.notesUpdatedAt);
  const setNotesDocument = useTranscriptStore((s) => s.setNotesDocument);
  const loadNotes = useTranscriptStore((s) => s.loadNotes);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSavedRef = useRef(notesContent);
  const isApplyingRemoteRef = useRef(false);
  const editorChangeVersionRef = useRef(0);
  const isDevMockSession = import.meta.env.DEV && sessionId === DEV_MOCK_SESSION_ID;

  const [initialContent] = useState<PartialBlock[] | undefined>(() =>
    Array.isArray(notesContentJson) && notesContentJson.length > 0
      ? (notesContentJson as PartialBlock[])
      : undefined
  );

  const editor = useCreateBlockNote({
    initialContent,
    placeholders: {
      default: "Write shared meeting notes...",
      heading: "Heading",
      bulletListItem: "List item",
      numberedListItem: "List item",
      checkListItem: "Task",
    },
  });

  useEffect(() => {
    lastSavedRef.current = useTranscriptStore.getState().notesContent;
  }, [sessionId, notesUpdatedAt]);

  useEffect(() => {
    if (!sessionId) return;
    if (isDevMockSession) {
      lastSavedRef.current = useTranscriptStore.getState().notesContent;
      return;
    }

    let cancelled = false;
    apiClient
      .getSessionNotes(sessionId)
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
  }, [sessionId, isDevMockSession, loadNotes]);

  useEffect(() => {
    if (!isDevMockSession) return;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== DEV_MOCK_NOTES_STORAGE_KEY || !event.newValue) return;
      const note = parseDevMockNotes(event.newValue);
      if (!note) return;

      lastSavedRef.current = note.content;
      loadNotes(note);
      setSaveState("saved");
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [isDevMockSession, loadNotes]);

  useEffect(() => {
    let cancelled = false;

    async function applyNotes() {
      editorChangeVersionRef.current += 1;
      isApplyingRemoteRef.current = true;
      const { notesContent: currentNotesContent, notesContentJson: currentNotesContentJson } =
        useTranscriptStore.getState();
      try {
        if (Array.isArray(currentNotesContentJson) && currentNotesContentJson.length > 0) {
          const incomingBlocks = currentNotesContentJson as PartialBlock[];
          // A save echo can contain the exact document already in the editor.
          // Replacing identical blocks resets BlockNote's selection and makes
          // the first slash command appear to jump to a new paragraph.
          if (stableSerialize(editor.document) !== stableSerialize(incomingBlocks)) {
            editor.replaceBlocks(editor.document, incomingBlocks);
          }
        } else if (currentNotesContent.trim()) {
          const blocks = await editor.tryParseMarkdownToBlocks(currentNotesContent);
          if (!cancelled) editor.replaceBlocks(editor.document, blocks);
        } else if (editor.document.length > 1 || blockToText(editor.document[0]) !== "") {
          editor.replaceBlocks(editor.document, [{ type: "paragraph", content: "" }]);
        }
      } finally {
        window.setTimeout(() => {
          if (!cancelled) isApplyingRemoteRef.current = false;
        }, 80);
      }
    }

    applyNotes();
    return () => {
      cancelled = true;
    };
  }, [editor, sessionId, notesUpdatedAt]);

  useEffect(() => {
    const unsubscribe = editor.onChange(async () => {
      if (isApplyingRemoteRef.current) return;
      const changeVersion = ++editorChangeVersionRef.current;
      const document = editor.document;
      const markdown = await editor.blocksToMarkdownLossy(document);
      if (changeVersion !== editorChangeVersionRef.current || isApplyingRemoteRef.current) return;
      setNotesDocument(markdown, document);
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [editor, setNotesDocument]);

  useEffect(() => {
    if (!sessionId) return;
    const currentState = useTranscriptStore.getState();
    if (currentState.session?.sessionId !== sessionId || currentState.notesContent !== notesContent) {
      return;
    }
    if (notesContent === lastSavedRef.current) return;

    setSaveState("saving");
    const content = notesContent;
    const contentJson = editor.document;
    const timeout = window.setTimeout(() => {
      if (isDevMockSession) {
        const existingNote = readDevMockNotes();
        const now = new Date().toISOString();
        const note: SessionNotesResponse = {
          session_id: DEV_MOCK_SESSION_ID,
          meeting_id: null,
          content,
          content_json: contentJson,
          updated_by: loadAuthorName() ?? "Preview",
          created_at: existingNote?.created_at ?? now,
          updated_at: now,
        };

        try {
          localStorage.setItem(DEV_MOCK_NOTES_STORAGE_KEY, JSON.stringify(note));
          lastSavedRef.current = note.content;
          loadNotes(note);
          setSaveState("saved");
        } catch (error) {
          console.warn("[notes] Failed to save preview notes:", error);
          setSaveState("error");
        }
        return;
      }

      apiClient
        .updateSessionNotes(sessionId, {
          content,
          contentJson,
          authorName: loadAuthorName() ?? undefined,
        })
        .then((note) => {
          if (useTranscriptStore.getState().session?.sessionId !== sessionId) return;
          lastSavedRef.current = note.content;
          if (useTranscriptStore.getState().notesContent !== content) return;
          loadNotes(note);
          setSaveState("saved");
        })
        .catch((error) => {
          if (useTranscriptStore.getState().notesContent !== content) return;
          console.warn("[notes] Failed to save shared notes:", error);
          setSaveState("error");
        });
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [sessionId, notesContent, editor, isDevMockSession, loadNotes]);

  const statusLabel = (() => {
    if (saveState === "saving") return "Saving…";
    if (saveState === "error") return "Not saved";
    if (saveState === "saved") return "Saved";
    if (isDevMockSession) return notesUpdatedAt ? "Saved" : "Preview";
    if (notesUpdatedBy && notesUpdatedAt) return `Updated by ${notesUpdatedBy}`;
    return sessionId ? "Shared" : "No active meeting";
  })();

  const handleEditorKeyDownCapture = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      document.execCommand("insertText", false, "  ");
      return;
    }

    // macOS Ctrl+H conventionally behaves as Backspace in text fields.
    if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "h") {
      event.preventDefault();
      event.stopPropagation();
      document.execCommand("delete");
    }
  };

  return (
    <aside className="note-panel" onKeyDownCapture={handleEditorKeyDownCapture}>
      <div className="note-panel-content">
        <div className="note-panel-topline">
          <p className="note-panel-title">Notes</p>
          <span className={`note-sync-state is-${saveState}`} role="status" aria-live="polite">
            {statusLabel}
          </span>
        </div>
        <div className="note-block-editor">
          <BlockNoteView
            editor={editor}
            editable
            theme="light"
            slashMenu
            formattingToolbar
          />
        </div>
      </div>
    </aside>
  );
}

function blockToText(block?: Block): string {
  if (!block || !Array.isArray(block.content)) return "";
  return block.content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String(part.text ?? "");
      }
      return "";
    })
    .join("");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}
