import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranscriptStore } from "../stores/transcriptStore";
import type { Section } from "../types";

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
  query: string;
  onClose: () => void;
  onScrollToSection: (beforeSequenceId: number) => void;
  onChangeTheme: (theme: "dark" | "light") => void;
  currentTheme: "dark" | "light";
}

export function CommandPalette({
  visible,
  query,
  onClose,
  onScrollToSection,
  onChangeTheme,
  currentTheme,
}: CommandPaletteProps) {
  const [focusIndex, setFocusIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useTranscriptStore((s) => s.sections);

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
      return buildSectionItems(sections, searchText);
    }
    if (mode === "history") {
      return buildHistoryItems(searchText);
    }
    // settings
    return buildSettingsItems(searchText, currentTheme, onChangeTheme, onClose);
  }, [mode, query, sections, currentTheme, onChangeTheme, onClose]);

  // Reset focus when opened or query changes
  useEffect(() => {
    if (visible) {
      setFocusIndex(0);
    }
  }, [visible, query]);

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
    (e: KeyboardEvent) => {
      if (items.length === 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
        return;
      }

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

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => handleKeyDown(e);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [visible, handleKeyDown]);

  useEffect(() => {
    if (items.length === 0 && focusIndex !== 0) {
      setFocusIndex(0);
      return;
    }
    if (items.length > 0 && focusIndex > items.length - 1) {
      setFocusIndex(items.length - 1);
    }
  }, [items.length, focusIndex]);

  if (!visible) return null;

  return (
    <div className="command-palette command-palette-attached">
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
    </div>
  );
}

// ----------------------------------------------------------------
// Item builders
// ----------------------------------------------------------------

function buildSectionItems(
  sections: Section[],
  search: string
): PaletteItem[] {
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
        window.open("https://github.com/kobayashi-shuto-0105/meetily-live-viewer", "_blank", "noopener,noreferrer");
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
