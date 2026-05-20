import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranscriptStore } from "../stores/transcriptStore";
import { apiClient } from "../api/client";
import type { Section, SessionHistoryItem } from "../types";

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
  onLoadSession: (sessionId: string, meetingTitle: string | null, startedAt: string) => void;
  onChangeTheme: (theme: "dark" | "light") => void;
  currentTheme: "dark" | "light";
}

export function CommandPalette({
  visible,
  query,
  onClose,
  onScrollToSection,
  onLoadSession,
  onChangeTheme,
  currentTheme,
}: CommandPaletteProps) {
  const [focusIndex, setFocusIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useTranscriptStore((s) => s.sections);

  // --- History state ---
  const [historyItems, setHistoryItems] = useState<SessionHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const historyFetchedRef = useRef(false);

  // Fetch history when entering history mode
  const prevQueryRef = useRef(query);
  useEffect(() => {
    const wasHistory = prevQueryRef.current.startsWith("#");
    const isHistory = query.startsWith("#");
    prevQueryRef.current = query;

    // Entering history mode: fetch data
    if (isHistory && !historyFetchedRef.current) {
      historyFetchedRef.current = true;
      setHistoryLoading(true);
      apiClient
        .getSessionHistory(15, 0)
        .then((res) => {
          setHistoryItems(res.sessions);
          setHistoryOffset(res.sessions.length);
          setHistoryHasMore(res.sessions.length >= 15);
        })
        .catch((e) => {
          console.warn("[CommandPalette] Failed to fetch session history:", e);
        })
        .finally(() => setHistoryLoading(false));
    }
    // Leaving history mode: schedule reset via microtask to avoid sync setState
    if (wasHistory && !isHistory) {
      historyFetchedRef.current = false;
      Promise.resolve().then(() => {
        setHistoryItems([]);
        setHistoryOffset(0);
        setHistoryHasMore(true);
      });
    }
  }, [query]);

  // Load more history items
  const loadMoreHistory = useCallback(() => {
    if (historyLoading || !historyHasMore) return;
    setHistoryLoading(true);
    apiClient
      .getSessionHistory(15, historyOffset)
      .then((res) => {
        setHistoryItems((prev) => [...prev, ...res.sessions]);
        setHistoryOffset((prev) => prev + res.sessions.length);
        setHistoryHasMore(res.sessions.length >= 15);
      })
      .catch((e) => {
        console.warn("[CommandPalette] Failed to fetch more history:", e);
      })
      .finally(() => setHistoryLoading(false));
  }, [historyLoading, historyHasMore, historyOffset]);

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
      return buildHistoryItemsFromData(historyItems, searchText, onLoadSession, onClose);
    }
    // settings
    return buildSettingsItems(searchText, currentTheme, onChangeTheme, onClose);
  }, [mode, query, sections, historyItems, onLoadSession, onClose, currentTheme, onChangeTheme]);

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
            {mode === "history" && (historyLoading ? "読み込み中…" : "履歴がありません")}
            {mode === "settings" && "一致するコマンドがありません"}
          </div>
        ) : (
          <>
            {items.map((item, idx) => (
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
            ))}
            {mode === "history" && historyHasMore && (
              <div
                className="command-palette-item command-palette-load-more"
                onClick={loadMoreHistory}
              >
                <span className="command-palette-item-label">
                  {historyLoading ? "読み込み中…" : "↓ さらに表示する"}
                </span>
              </div>
            )}
          </>
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

function buildHistoryItemsFromData(
  sessions: SessionHistoryItem[],
  search: string,
  onLoadSession: (sessionId: string, meetingTitle: string | null, startedAt: string) => void,
  onClose: () => void
): PaletteItem[] {
  const filtered = sessions.filter((s) => {
    if (!search) return true;
    const title = (s.meeting_title ?? "").toLowerCase();
    const date = s.started_at.toLowerCase();
    return title.includes(search) || date.includes(search);
  });

  return filtered.map((s) => {
    const title = s.meeting_title || "無題の会議";
    const date = formatSessionDate(s.started_at);
    return {
      id: s.session_id,
      label: title,
      description: date,
      action: () => {
        onLoadSession(s.session_id, s.meeting_title, s.started_at);
        onClose();
      },
    };
  });
}

/** 日時文字列を表示用にフォーマットする */
function formatSessionDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    const now = new Date();
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hours = d.getHours().toString().padStart(2, "0");
    const minutes = d.getMinutes().toString().padStart(2, "0");
    // Include year if different from current year
    const yearStr = year !== now.getFullYear() ? `${year}/` : "";
    return `${yearStr}${month}/${day} ${hours}:${minutes}`;
  } catch {
    return isoString;
  }
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
