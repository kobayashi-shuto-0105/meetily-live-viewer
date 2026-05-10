import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranscriptStore } from "../stores/transcriptStore";

// ----------------------------------------------------------------
// SectionEditor
// ----------------------------------------------------------------
// Inline editor for creating or editing a section.
// - Create mode: beforeSequenceId is set, existingSection is null
// - Edit mode: existingSection is provided

interface CreateProps {
  mode: "create";
  beforeSequenceId: number;
}

interface EditProps {
  mode: "edit";
  sectionId: string;
  initialTitle: string;
  initialDescription: string;
}

type Props = CreateProps | EditProps;

export function SectionEditor(props: Props) {
  const addSection = useTranscriptStore((s) => s.addSection);
  const updateSection = useTranscriptStore((s) => s.updateSection);
  const closeSectionInsert = useTranscriptStore((s) => s.closeSectionInsert);
  const setSectionEditingId = useTranscriptStore((s) => s.setSectionEditingId);

  const isEdit = props.mode === "edit";
  const [title, setTitle] = useState(isEdit ? props.initialTitle : "");
  const [description, setDescription] = useState(
    isEdit ? props.initialDescription : ""
  );

  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleCancel = useCallback(() => {
    if (isEdit) {
      setSectionEditingId(null);
    } else {
      closeSectionInsert();
    }
  }, [isEdit, closeSectionInsert, setSectionEditingId]);

  const handleSave = useCallback(() => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    if (props.mode === "edit") {
      updateSection(props.sectionId, trimmedTitle, description.trim());
    } else {
      addSection(props.beforeSequenceId, trimmedTitle, description.trim());
    }
  }, [title, description, props, addSection, updateSection]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSave();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleSave, handleCancel]
  );

  return (
    <div
      className="section-editor"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={titleRef}
        type="text"
        className="section-editor-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="New section"
      />
      <textarea
        className="section-editor-desc"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Description (optional)"
        rows={2}
      />
      <div className="section-editor-actions">
        <button
          type="button"
          className="section-editor-save"
          onClick={handleSave}
          disabled={!title.trim()}
        >
          {isEdit ? "Save" : "Create"}
        </button>
        <button
          type="button"
          className="section-editor-cancel"
          onClick={handleCancel}
        >
          Cancel
        </button>
        <span className="section-editor-hint">
          Press Enter to {isEdit ? "save" : "create"}
        </span>
      </div>
    </div>
  );
}
