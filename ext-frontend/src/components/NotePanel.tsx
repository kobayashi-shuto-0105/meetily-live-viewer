import { useEffect, useMemo, useRef, useState } from "react";
import type { Block, PartialBlock } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import "@blocknote/core/fonts/inter.css";

import { apiClient } from "../api/client";
import { loadAuthorName } from "../stores/authorName";
import { useTranscriptStore } from "../stores/transcriptStore";
import type { NotesAiAction } from "../types";

const AI_ACTIONS: Array<{ action: NotesAiAction; label: string }> = [
  { action: "continue", label: "Continue" },
  { action: "improve", label: "Improve" },
  { action: "summarize_transcript", label: "Summarize" },
  { action: "action_items", label: "Actions" },
];

// ----------------------------------------------------------------
// NotePanel – Collaborative glass BlockNote editor on the left side.
// ----------------------------------------------------------------

export function NotePanel() {
  const session = useTranscriptStore((s) => s.session);
  const notesContent = useTranscriptStore((s) => s.notesContent);
  const notesContentJson = useTranscriptStore((s) => s.notesContentJson);
  const notesUpdatedBy = useTranscriptStore((s) => s.notesUpdatedBy);
  const notesUpdatedAt = useTranscriptStore((s) => s.notesUpdatedAt);
  const sortedSegments = useTranscriptStore((s) => s.sortedSegments);
  const setNotesDocument = useTranscriptStore((s) => s.setNotesDocument);
  const loadNotes = useTranscriptStore((s) => s.loadNotes);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [aiState, setAiState] = useState<"idle" | "loading" | "error">("idle");
  const [aiEnabled, setAiEnabled] = useState(false);
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
    apiClient
      .getExternalWebSettings()
      .then((settings) => setAiEnabled(settings.notes_ai_enabled))
      .catch(() => setAiEnabled(false));
  }, []);

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

  const statusLabel = useMemo(() => {
    if (!session) return "Preview";
    if (saveState === "saving") return "Saving";
    if (saveState === "error") return "Offline";
    if (notesUpdatedBy && notesUpdatedAt) return `Updated by ${notesUpdatedBy}`;
    if (saveState === "saved") return "Saved";
    return "Shared";
  }, [notesUpdatedAt, notesUpdatedBy, saveState, session]);

  async function runAiAction(action: NotesAiAction) {
    if (!aiEnabled || aiState === "loading") return;

    setAiState("loading");
    try {
      const currentNotes = await editor.blocksToMarkdownLossy(editor.document);
      const selectedText = getSelectedText();
      const transcriptContext = sortedSegments
        .slice(-24)
        .map((segment) => segment.displayText)
        .join("\n");

      const result = await apiClient.generateNotesAi({
        action,
        notesText: currentNotes,
        selectedText,
        transcriptContext,
      });

      if (!result.text.trim()) return;
      const blocks = await editor.tryParseMarkdownToBlocks(result.text);
      const lastBlock = editor.document[editor.document.length - 1];
      editor.insertBlocks(blocks, lastBlock, "after");
      setAiState("idle");
    } catch (error) {
      console.warn("[notes] Notes AI failed:", error);
      setAiState("error");
    }
  }

  return (
    <aside className="note-panel">
      <div className="note-panel-content">
        <div className="note-panel-topline">
          <p className="note-panel-title">Notes</p>
          <span className={`note-sync-state is-${saveState}`}>{statusLabel}</span>
        </div>
        <div className="note-ai-toolbar" aria-label="Notes AI actions">
          {AI_ACTIONS.map((item) => (
            <button
              key={item.action}
              type="button"
              onClick={() => runAiAction(item.action)}
              disabled={!aiEnabled || aiState === "loading"}
              title={aiEnabled ? `${item.label} with Ollama` : "Enable Notes AI in Meetily settings"}
            >
              {item.label}
            </button>
          ))}
          <span className={`note-ai-state is-${aiState}`}>
            {aiEnabled ? (aiState === "loading" ? "Thinking" : aiState === "error" ? "AI unavailable" : "Ollama") : "AI off"}
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

function getSelectedText(): string {
  return globalThis.getSelection?.()?.toString().trim() ?? "";
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
