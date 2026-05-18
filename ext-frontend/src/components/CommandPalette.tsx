import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranscriptStore, selectSortedSegments } from "../stores/transcriptStore";
import type { Section, TranscriptSegmentView } from "../types";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

type PaletteMode = "sections" | "history" | "settings";

interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  action?: () => void;
  /** For section items: associated section data */
  section?: Section;
}

// ----------------------------------------------------------------
// CommandPalette
// ----------------------------------------------------------------

interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
  onScrollToSection: (beforeSequenceId: number) => void;
  onScrollToSegment?: (segmentId: string) => void;
  onChangeTheme: (theme: "dark" | "light") => void;
  currentTheme: "dark" | "light";
}

export function CommandPalette({
  visible,
  onClose,
  onScrollToSection,
  onChangeTheme,
  currentTheme,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useTranscriptStore((s) => s.sections);
  const segments = useTranscriptStore(selectSortedSegments);

  // Determine mode from query prefix
  const mode: PaletteMode = useMemo(() => {
    if (query.startsWith("#")) return "history";
    if (query.startsWith(">")) return "settings";
    return "sections";
  }, [query]);

  // Build items based on mode
  const items: PaletteItem[] = useMemo(() => {
    const searchText = mode === "sections"
      ? query.trim().toLowerCase()
      : query.slice(1).trim().toLowerCase();

    if (mode === "sections") {
      return buildSectionItems(sections, segments, searchText);
    }
    if (mode === "history") {
      return buildHistoryItems(searchText);
    }
    // settings
    return buildSettingsItems(searchText, currentTheme, onChangeTheme, onClose);
  }, [mode, query, sections, segments, currentTheme, onChangeTheme, onClose]);

  // Reset focus when query changes (items change)
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setFocusIndex(0);
  }, []);

  // Focus input when palette opens; reset state via key prop on parent
  useEffect(() => {
    if (visible) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [visible]);

  // Ensure focused item is visible in list
  useEffect(() => {
    if (!listRef.current) return;
    const focused = listRef.current.querySelector('[data-focused="true"]');
    if (focused) {
      focused.scrollIntoView({ block: "nearest" });
    }
  }, [focusIndex]);

  const executeItem = useCallback(
    (item: PaletteItem) => {
      if (item.action) {
        item.action();
        return;
      }
      // Default for section items: scroll to section
      if (item.section) {
        onScrollToSection(item.section.beforeSequenceId);
        onClose();
      }
    },
    [onScrollToSection, onClose]
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      // Ctrl+N or Down → next item
      if (
        e.key === "ArrowDown" ||
        (e.ctrlKey && e.key === "n")
      ) {
        e.preventDefault();
        setFocusIndex((i) => Math.min(i + 1, items.length - 1));
        return;
      }
      // Ctrl+P or Up → prev item
      if (
        e.key === "ArrowUp" ||
        (e.ctrlKey && e.key === "p")
      ) {
        e.preventDefault();
        setFocusIndex((i) => Math.max(i - 1, 0));
        return;
      }
      // Ctrl+F → scroll preview right (no-op for now, visual focus)
      // Ctrl+B → scroll preview left (no-op for now)

      // Enter → execute focused item
      if (e.key === "Enter") {
        e.preventDefault();
        const item = items[focusIndex];
        if (item) executeItem(item);
        return;
      }
      // Escape → close
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
    },
    [items, focusIndex, executeItem, onClose]
  );

  // Preview panel content (only in sections mode)
  const previewContent = useMemo(() => {
    if (mode !== "sections") return null;
    const item = items[focusIndex];
    if (!item?.section) return null;
    return buildSectionPreview(item.section, sections, segments);
  }, [mode, items, focusIndex, sections, segments]);

  if (!visible) return null;

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="command-palette-input-row">
          <span className="command-palette-icon" aria-hidden="true">
            {mode === "sections" && "§"}
            {mode === "history" && "#"}
            {mode === "settings" && ">"}
          </span>
          <input
            ref={inputRef}
            className="command-palette-input"
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === "sections"
                ? "セクションを検索…"
                : mode === "history"
                ? "会議履歴を検索…"
                : "設定コマンド…"
            }
            aria-label="Command palette input"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="command-palette-mode-hint">
            {mode === "sections" && "Sections"}
            {mode === "history" && "History"}
            {mode === "settings" && "Settings"}
          </span>
        </div>

        {/* Body: list + preview */}
        <div className="command-palette-body">
          {/* Item list */}
          <div className="command-palette-list" ref={listRef}>
            {items.length === 0 ? (
              <div className="command-palette-empty">
                {mode === "sections" && "セクションがありません"}
                {mode === "history" && "履歴がありません"}
                {mode === "settings" && "一致するコマンドがありません"}
              </div>
            ) : (
              items.map((item, idx) => (
                <div
                  key={item.id}
                  className={`command-palette-item${idx === focusIndex ? " is-focused" : ""}`}
                  data-focused={idx === focusIndex}
                  onClick={() => executeItem(item)}
                  onMouseEnter={() => setFocusIndex(idx)}
                >
                  <span className="command-palette-item-label">{item.label}</span>
                  {item.description && (
                    <span className="command-palette-item-desc">{item.description}</span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Preview panel (only in sections mode) */}
          {mode === "sections" && previewContent && (
            <div className="command-palette-preview">
              <div className="command-palette-preview-title">
                {previewContent.title}
              </div>
              {previewContent.highlights.length > 0 && (
                <div className="command-palette-preview-section">
                  <span className="preview-label">Highlights</span>
                  {previewContent.highlights.map((h) => (
                    <div key={h.id} className="preview-highlight-item">
                      <span
                        className="preview-highlight-dot"
                        data-color={h.color}
                      />
                      {h.note || h.text || "—"}
                    </div>
                  ))}
                </div>
              )}
              {previewContent.comments.length > 0 && (
                <div className="command-palette-preview-section">
                  <span className="preview-label">Comments</span>
                  {previewContent.comments.map((c) => (
                    <div key={c.id} className="preview-comment-item">
                      <span className="preview-comment-author">{c.author || "Anonymous"}</span>
                      <span className="preview-comment-text">{c.text}</span>
                    </div>
                  ))}
                </div>
              )}
              {previewContent.highlights.length === 0 && previewContent.comments.length === 0 && (
                <div className="command-palette-preview-empty">
                  このセクションにはハイライト・コメントがありません
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div className="command-palette-footer">
          <span>↑↓ / Ctrl+N/P: 移動</span>
          <span>Enter: 選択</span>
          <span>#: 履歴</span>
          <span>&gt;: 設定</span>
          <span>Esc: 閉じる</span>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Item builders
// ----------------------------------------------------------------

function buildSectionItems(
  sections: Section[],
  segments: TranscriptSegmentView[],
  search: string
): PaletteItem[] {
  if (sections.length === 0) {
    // Show all segments grouped as a flat list if no sections exist
    return [];
  }

  const sorted = [...sections].sort((a, b) => a.beforeSequenceId - b.beforeSequenceId);

  return sorted
    .filter((s) => {
      if (!search) return true;
      return (
        s.title.toLowerCase().includes(search) ||
        s.description.toLowerCase().includes(search)
      );
    })
    .map((s, idx) => ({
      id: s.id,
      label: `${idx + 1}. ${s.title}`,
      description: s.description || undefined,
      section: s,
    }));
}

function buildHistoryItems(search: string): PaletteItem[] {
  // Meeting history is not available via REST API in this frontend currently.
  // Show placeholder items.
  const placeholder: PaletteItem[] = [
    { id: "history-placeholder", label: "会議履歴の取得は現在未対応です（Coming Soon）", description: "API対応後に有効化されます" },
  ];
  if (search) {
    return placeholder.filter((p) => p.label.includes(search));
  }
  return placeholder;
}

function buildSettingsItems(
  search: string,
  currentTheme: "dark" | "light",
  onChangeTheme: (t: "dark" | "light") => void,
  onClose: () => void
): PaletteItem[] {
  const allItems: PaletteItem[] = [
    {
      id: "settings-theme-toggle",
      label: `カラーテーマ: ${currentTheme === "dark" ? "ダークモード → ライトに切替" : "ライトモード → ダークに切替"}`,
      description: "Toggle color theme",
      action: () => {
        onChangeTheme(currentTheme === "dark" ? "light" : "dark");
        onClose();
      },
    },
    {
      id: "settings-obsidian",
      label: "To Obsidian Mode (Coming Soon)",
      description: "Obsidianとの連携モード",
    },
    {
      id: "settings-github",
      label: "To GitHub Repo Page",
      description: "GitHubリポジトリを開く",
      action: () => {
        window.open("https://github.com/kobayashi-shuto-0105/meetily-live-viewer", "_blank");
        onClose();
      },
    },
    {
      id: "settings-research-agent",
      label: "To Research Agent (Coming Soon)",
      description: "リサーチエージェントとの連携",
    },
  ];

  if (!search) return allItems;
  return allItems.filter(
    (item) =>
      item.label.toLowerCase().includes(search) ||
      (item.description?.toLowerCase().includes(search) ?? false)
  );
}

// ----------------------------------------------------------------
// Preview builder
// ----------------------------------------------------------------

interface PreviewData {
  title: string;
  highlights: { id: string; color: string; note: string | null; text: string | null }[];
  comments: { id: string; author: string | null; text: string }[];
}

function buildSectionPreview(
  section: Section,
  allSections: Section[],
  segments: TranscriptSegmentView[]
): PreviewData {
  const sorted = [...allSections].sort((a, b) => a.beforeSequenceId - b.beforeSequenceId);
  const idx = sorted.findIndex((s) => s.id === section.id);
  const nextSection = sorted[idx + 1];

  // Get segments belonging to this section
  const sectionSegments = segments.filter((seg) => {
    if (seg.sequenceId < section.beforeSequenceId) return false;
    if (nextSection && seg.sequenceId >= nextSection.beforeSequenceId) return false;
    return true;
  });

  const highlights: PreviewData["highlights"] = [];
  const comments: PreviewData["comments"] = [];

  for (const seg of sectionSegments) {
    for (const h of seg.highlights) {
      highlights.push({
        id: h.id,
        color: h.color,
        note: h.note,
        text: seg.displayText.slice(0, 40),
      });
    }
    for (const c of seg.comments) {
      comments.push({
        id: c.id,
        author: c.author_name,
        text: c.comment_text,
      });
    }
  }

  return {
    title: section.title,
    highlights,
    comments,
  };
}
