import { useCallback, useEffect, useRef, useState } from "react";
import { useTranscriptStore } from "../stores/transcriptStore";
import type { Section } from "../types";

// ----------------------------------------------------------------
// NotePanel – Notion-like note editor on the left sidebar
// Sections auto-populate as headings; users can type notes underneath.
// ----------------------------------------------------------------

interface NotePanelProps {
  onScrollToSection: (beforeSequenceId: number) => void;
}

const STORAGE_KEY = "meetily-note-blocks";

function loadNoteBlocks(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveNoteBlocks(blocks: Record<string, string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blocks));
}

export function NotePanel({ onScrollToSection }: NotePanelProps) {
  const sections = useTranscriptStore((s) => s.sections);
  const [noteBlocks, setNoteBlocks] = useState<Record<string, string>>(loadNoteBlocks);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevSectionsLenRef = useRef(sections.length);

  // Auto-scroll to bottom when new section is added
  useEffect(() => {
    if (sections.length > prevSectionsLenRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    prevSectionsLenRef.current = sections.length;
  }, [sections.length]);

  // Persist notes to localStorage
  useEffect(() => {
    saveNoteBlocks(noteBlocks);
  }, [noteBlocks]);

  const handleNoteChange = useCallback((sectionId: string, content: string) => {
    setNoteBlocks((prev) => ({ ...prev, [sectionId]: content }));
  }, []);

  const sorted = [...sections].sort((a, b) => a.beforeSequenceId - b.beforeSequenceId);

  return (
    <aside className="note-panel">
      <div className="note-panel-header">
        <span className="note-panel-title">Notes</span>
      </div>
      <div className="note-panel-content" ref={containerRef}>
        {sorted.length === 0 ? (
          <div className="note-panel-empty">
            Sections will appear here as headings.
            <br />
            Add a section in the transcript to start taking notes.
          </div>
        ) : (
          sorted.map((section) => (
            <NoteBlockItem
              key={section.id}
              section={section}
              content={noteBlocks[section.id] ?? ""}
              onChange={handleNoteChange}
              onClickHeading={onScrollToSection}
            />
          ))
        )}
      </div>
    </aside>
  );
}

// ----------------------------------------------------------------
// NoteBlockItem – Section heading + editable textarea
// ----------------------------------------------------------------

function NoteBlockItem({
  section,
  content,
  onChange,
  onClickHeading,
}: {
  section: Section;
  content: string;
  onChange: (sectionId: string, content: string) => void;
  onClickHeading: (beforeSequenceId: number) => void;
}) {
  return (
    <div className="note-block">
      <h3
        className="note-block-heading"
        onClick={() => onClickHeading(section.beforeSequenceId)}
        title="Click to jump to this section"
      >
        {section.title}
      </h3>
      {section.description && (
        <p className="note-block-desc">{section.description}</p>
      )}
      <textarea
        className="note-block-editor"
        placeholder="Type notes here…"
        value={content}
        onChange={(e) => onChange(section.id, e.target.value)}
        rows={3}
      />
    </div>
  );
}
