import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Block, PartialBlock } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import "@blocknote/core/fonts/inter.css";

import { apiClient } from "../api/client";
import { loadAuthorName } from "../stores/authorName";
import { useTranscriptStore } from "../stores/transcriptStore";

// ----------------------------------------------------------------
// NotePanel – Collaborative glass BlockNote editor on the left side.
// ----------------------------------------------------------------

export function NotePanel() {
  const session = useTranscriptStore((s) => s.session);
  const notesContent = useTranscriptStore((s) => s.notesContent);
  const notesContentJson = useTranscriptStore((s) => s.notesContentJson);
  const notesUpdatedAt = useTranscriptStore((s) => s.notesUpdatedAt);
  const setNotesDocument = useTranscriptStore((s) => s.setNotesDocument);
  const loadNotes = useTranscriptStore((s) => s.loadNotes);
  const [, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSavedRef = useRef(notesContent);
  const isApplyingRemoteRef = useRef(false);

  const initialContent = useMemo(() => {
    if (Array.isArray(notesContentJson) && notesContentJson.length > 0) {
      return notesContentJson as PartialBlock[];
    }
    return undefined;
  }, []);

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
    let cancelled = false;

    async function applyNotes() {
      isApplyingRemoteRef.current = true;
      try {
        if (Array.isArray(notesContentJson) && notesContentJson.length > 0) {
          editor.replaceBlocks(editor.document, notesContentJson as PartialBlock[]);
        } else if (notesContent.trim()) {
          const blocks = await editor.tryParseMarkdownToBlocks(notesContent);
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
  }, [editor, session?.sessionId, notesUpdatedAt]);

  useEffect(() => {
    const unsubscribe = editor.onChange(async () => {
      if (isApplyingRemoteRef.current) return;
      const markdown = await editor.blocksToMarkdownLossy(editor.document);
      setNotesDocument(markdown, editor.document);
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [editor, setNotesDocument]);

  useEffect(() => {
    if (!session?.sessionId) return;
    if (notesContent === lastSavedRef.current) return;

    setSaveState("saving");
    const timeout = window.setTimeout(() => {
      apiClient
        .updateSessionNotes(session.sessionId, {
          content: notesContent,
          contentJson: editor.document,
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
  }, [session?.sessionId, notesContent, editor, loadNotes]);

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
