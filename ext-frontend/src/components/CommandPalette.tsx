import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranscriptStore } from "../stores/transcriptStore";
import { apiClient } from "../api/client";
import type { Section, SessionHistoryItem, TranscriptSegmentView } from "../types";

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

interface AnnotationItem {
  id: string;
  tone: string;
  label: string;
  meta: string;
  segmentId: string;
  excerpt: string;
}

interface FlowItem<T> {
  item: T;
  originalIndex: number;
  flowIndex: number;
}

// ----------------------------------------------------------------
// CommandPalette
// ----------------------------------------------------------------

interface CommandPaletteProps {
  visible: boolean;
  query: string;
  onClose: () => void;
  onScrollToSection: (beforeSequenceId: number) => void;
  onScrollToSegment: (segmentId: string) => void;
  onLoadSession: (sessionId: string, meetingTitle: string | null, startedAt: string) => void;
  onChangeTheme: (theme: "dark" | "light") => void;
  currentTheme: "dark" | "light";
}

export function CommandPalette({
  visible,
  query,
  onClose,
  onScrollToSection,
  onScrollToSegment,
  onLoadSession,
  onChangeTheme,
  currentTheme,
}: CommandPaletteProps) {
  const [focusIndex, setFocusIndex] = useState(0);
  const [focusPane, setFocusPane] = useState<"sections" | "annotations">("sections");
  const [annotationFocusIndex, setAnnotationFocusIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useTranscriptStore((s) => s.sections);
  const sortedSegments = useTranscriptStore((s) => s.sortedSegments);

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

  useEffect(() => {
    setFocusIndex(0);
  }, [mode, query]);

  const currentFocusIndex = useMemo(() => {
    if (items.length === 0) return 0;
    return Math.min(focusIndex, items.length - 1);
  }, [focusIndex, items.length]);

  const focusedSection = mode === "sections" ? items[currentFocusIndex]?.section : undefined;
  const focusedSectionSegments = useMemo(() => {
    if (!focusedSection) return [];
    return getSegmentsInSection(focusedSection, sections, sortedSegments);
  }, [focusedSection, sections, sortedSegments]);
  const annotationItems = useMemo(
    () => buildAnnotationItems(focusedSectionSegments),
    [focusedSectionSegments]
  );

  const currentAnnotationFocusIndex = useMemo(() => {
    if (annotationItems.length === 0) return 0;
    return Math.min(annotationFocusIndex, annotationItems.length - 1);
  }, [annotationFocusIndex, annotationItems.length]);

  useEffect(() => {
    setFocusPane("sections");
    setAnnotationFocusIndex(0);
  }, [mode, query, focusedSection?.id]);

  const flowItems = useMemo(
    () => buildFlowItems(items, currentFocusIndex, mode === "history" ? 10 : 7),
    [items, currentFocusIndex, mode]
  );

  const annotationFlowItems = useMemo(
    () => buildFlowItems(annotationItems, currentAnnotationFocusIndex, 5),
    [annotationItems, currentAnnotationFocusIndex]
  );

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
      const key = e.key.toLowerCase();
      if (items.length === 0) {
        if (key === "escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        return;
      }

      // Ctrl+N or Down → next item
      if (
        key === "arrowdown" ||
        (e.ctrlKey && key === "n")
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (focusPane === "annotations" && annotationItems.length > 0) {
          setAnnotationFocusIndex((i) => Math.min(i + 1, annotationItems.length - 1));
        } else {
          setFocusIndex((i) => Math.min(i + 1, items.length - 1));
        }
        return;
      }
      // Ctrl+P or Up → prev item
      if (
        key === "arrowup" ||
        (e.ctrlKey && key === "p")
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (focusPane === "annotations" && annotationItems.length > 0) {
          setAnnotationFocusIndex((i) => Math.max(i - 1, 0));
        } else {
          setFocusIndex((i) => Math.max(i - 1, 0));
        }
        return;
      }
      // Ctrl+F / Ctrl+B: move between the section list and its annotation side column.
      if (mode === "sections" && e.ctrlKey && !e.metaKey && !e.altKey && key === "f") {
        e.preventDefault();
        e.stopPropagation();
        if (focusPane === "sections") {
          if (annotationItems.length > 0) {
            setFocusPane("annotations");
            setAnnotationFocusIndex(0);
          } else {
            setFocusIndex((i) => Math.min(i + 1, items.length - 1));
          }
        } else {
          setAnnotationFocusIndex((i) => Math.min(i + 1, annotationItems.length - 1));
        }
        return;
      }
      if (mode === "sections" && e.ctrlKey && !e.metaKey && !e.altKey && key === "b") {
        e.preventDefault();
        e.stopPropagation();
        if (focusPane === "annotations") {
          if (currentAnnotationFocusIndex > 0) {
            setAnnotationFocusIndex((i) => Math.max(i - 1, 0));
          } else {
            setFocusPane("sections");
          }
        } else {
          setFocusIndex((i) => Math.max(i - 1, 0));
        }
        return;
      }

      // Enter → execute focused item
      if (key === "enter") {
        e.preventDefault();
        e.stopPropagation();
        if (focusPane === "annotations") {
          const annotation = annotationItems[currentAnnotationFocusIndex];
          if (annotation) {
            onScrollToSegment(annotation.segmentId);
            onClose();
          }
          return;
        }
        const item = items[currentFocusIndex];
        if (item) executeItem(item);
        return;
      }
      // Escape → close
      if (key === "escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
    },
    [
      items,
      currentFocusIndex,
      currentAnnotationFocusIndex,
      annotationItems,
      executeItem,
      onClose,
      mode,
      focusPane,
      onScrollToSegment,
    ]
  );

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => handleKeyDown(e);
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [visible, handleKeyDown]);

  if (!visible) return null;

  return (
    <div
      className="command-palette command-palette-attached"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="command-palette-list" ref={listRef} role="listbox" aria-label="Command suggestions">
        {items.length === 0 ? (
          <div className="command-palette-empty">
            {mode === "sections" && "No sections found"}
            {mode === "history" && (historyLoading ? "Loading…" : "No history available")}
            {mode === "settings" && "No matching commands"}
          </div>
        ) : (
          <>
            {flowItems.map(({ item, originalIndex, flowIndex }) => (
              <button
                key={item.id}
                type="button"
                className={`command-palette-item${flowIndex === 0 ? " is-focused" : ""}${flowIndex === 0 && focusPane === "sections" ? " is-keyboard-pane" : ""}`}
                data-focused={flowIndex === 0}
                data-flow-index={flowIndex}
                role="option"
                aria-selected={flowIndex === 0}
                onClick={() => executeItem(item)}
                onMouseEnter={() => {
                  setFocusPane("sections");
                  setFocusIndex(originalIndex);
                }}
                onFocus={() => {
                  setFocusPane("sections");
                  setFocusIndex(originalIndex);
                }}
              >
                <span className="command-palette-item-label">{item.label}</span>
                {item.description && (
                  <span className="command-palette-item-desc">{item.description}</span>
                )}
              </button>
            ))}
            {mode === "history" && historyHasMore && (
              <button
                type="button"
                className="command-palette-item command-palette-load-more"
                onClick={loadMoreHistory}
              >
                <span className="command-palette-item-label">
                  {historyLoading ? "Loading…" : "↓ Load more"}
                </span>
              </button>
            )}
          </>
        )}
      </div>
      {mode === "sections" && (
        <SectionFocusPreview
          section={focusedSection}
          annotationItems={annotationItems}
          flowItems={annotationFlowItems}
          isPaneFocused={focusPane === "annotations"}
          onFocusAnnotation={(idx) => {
            setFocusPane("annotations");
            setAnnotationFocusIndex(idx);
          }}
          onScrollToSegment={(segmentId) => {
            onScrollToSegment(segmentId);
            onClose();
          }}
        />
      )}
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

  const filtered = sorted.filter((s) => {
    if (!search) return true;
    return (
      s.title.toLowerCase().includes(search) ||
      s.description.toLowerCase().includes(search)
    );
  });

  return filtered.map((s, idx) => ({
    id: s.id,
    label: `${idx + 1}. ${s.title}`,
    description: s.description || undefined,
    section: s,
  }));
}

function getSegmentsInSection(
  section: Section,
  sections: Section[],
  sortedSegments: TranscriptSegmentView[]
): TranscriptSegmentView[] {
  const sorted = [...sections].sort((a, b) => a.beforeSequenceId - b.beforeSequenceId);
  const sectionIdx = sorted.findIndex((s) => s.id === section.id);
  const nextSection = sectionIdx >= 0 ? sorted[sectionIdx + 1] : undefined;

  return sortedSegments.filter((seg) => {
    if (seg.sequenceId < section.beforeSequenceId) return false;
    if (nextSection && seg.sequenceId >= nextSection.beforeSequenceId) return false;
    return true;
  });
}

function buildFlowItems<T>(items: T[], focusIndex: number, maxItems: number): FlowItem<T>[] {
  if (items.length === 0) return [];

  const clampedFocus = Math.min(Math.max(focusIndex, 0), items.length - 1);
  return items
    .slice(clampedFocus, clampedFocus + maxItems)
    .map((item, idx) => ({
      item,
      originalIndex: clampedFocus + idx,
      flowIndex: idx,
    }));
}

function buildAnnotationItems(segments: TranscriptSegmentView[]): AnnotationItem[] {
  return segments.flatMap((seg) => {
    const comments = seg.comments.map((comment) => ({
      id: `comment-${comment.id}`,
      tone: "comment",
      label: comment.comment_text,
      meta: comment.author_name ? `Comment by ${comment.author_name}` : "Comment",
      segmentId: seg.id,
      excerpt: seg.displayText,
    }));
    const highlights = seg.highlights.map((highlight) => ({
      id: `highlight-${highlight.id}`,
      tone: highlight.color,
      label: highlight.note || (highlight.color === "todo" ? "TODO" : highlight.color === "fixme" ? "FIXME" : "Highlight"),
      meta: "Highlight",
      segmentId: seg.id,
      excerpt: seg.displayText,
    }));
    return [...comments, ...highlights];
  });
}

function SectionFocusPreview({
  section,
  annotationItems,
  flowItems,
  isPaneFocused,
  onFocusAnnotation,
  onScrollToSegment,
}: {
  section?: Section;
  annotationItems: AnnotationItem[];
  flowItems: FlowItem<AnnotationItem>[];
  isPaneFocused: boolean;
  onFocusAnnotation: (idx: number) => void;
  onScrollToSegment: (segmentId: string) => void;
}) {
  if (!section) {
    return (
      <aside className="command-section-preview">
        <div className="command-section-preview-empty">Focus a section to inspect its notes.</div>
      </aside>
    );
  }

  return (
    <aside className={`command-section-preview${isPaneFocused ? " is-pane-focused" : ""}`} aria-label="Focused section details">
      <div className="command-section-preview-head">
        <span>Focused section</span>
        <strong>{section.title}</strong>
        {section.description && <p>{section.description}</p>}
      </div>
      <div className="command-section-preview-list">
        {annotationItems.length === 0 ? (
          <div className="command-section-preview-empty">
            No comments or highlights in this section yet.
          </div>
        ) : (
          flowItems.map(({ item, originalIndex, flowIndex }) => (
            <button
              key={item.id}
              type="button"
              className={`command-section-preview-card is-${item.tone}${isPaneFocused && flowIndex === 0 ? " is-focused" : ""}`}
              data-focused={isPaneFocused && flowIndex === 0}
              data-flow-index={flowIndex}
              onMouseEnter={() => onFocusAnnotation(originalIndex)}
              onFocus={() => onFocusAnnotation(originalIndex)}
              onClick={() => onScrollToSegment(item.segmentId)}
            >
              <span>{item.meta}</span>
              <strong>{item.label}</strong>
              <small>{item.excerpt}</small>
            </button>
          ))
        )}
      </div>
      <div className="command-section-preview-footer">Ctrl+F enters notes, Ctrl+B returns to sections</div>
    </aside>
  );
}

function buildHistoryItemsFromData(
  sessions: SessionHistoryItem[],
  search: string,
  onLoadSession: (sessionId: string, meetingTitle: string | null, startedAt: string) => void,
  onClose: () => void
): PaletteItem[] {
  const tokens = search.split(/\s+/).filter(Boolean);
  const filtered = sessions.filter((s) => {
    if (!search) return true;
    const haystack = buildHistorySearchText(s);
    return tokens.every((token) => haystack.includes(token));
  });

  return filtered.map((s) => {
    const title = s.meeting_title || "Untitled Meeting";
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

/** Format an ISO date string for display in the palette */
function formatSessionDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    const now = new Date();
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(d);
    const hours24 = d.getHours();
    const period = hours24 < 12 ? "a.m." : "p.m.";
    const hours12 = hours24 % 12 || 12;
    const minutes = d.getMinutes().toString().padStart(2, "0");
    // Include year if different from current year
    const yearStr = year !== now.getFullYear() ? `${year}/` : "";
    return `${weekday} ${yearStr}${month}/${day} ${hours12}:${minutes} ${period}`;
  } catch {
    return isoString;
  }
}

function buildHistorySearchText(session: SessionHistoryItem): string {
  const title = session.meeting_title ?? "Untitled Meeting";
  const formatted = formatSessionDate(session.started_at);
  const raw = session.started_at;
  let expanded = "";

  try {
    const d = new Date(session.started_at);
    expanded = [
      new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(d),
      new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(d),
      `${d.getMonth() + 1}/${d.getDate()}`,
      `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`,
      String(d.getFullYear()),
    ].join(" ");
  } catch {
    expanded = "";
  }

  return `${title} ${formatted} ${raw} ${expanded}`.toLowerCase();
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
      label: `Theme: ${currentTheme === "dark" ? "Dark → Light" : "Light → Dark"}`,
      description: "Toggle color theme",
      action: () => {
        onChangeTheme(currentTheme === "dark" ? "light" : "dark");
        onClose();
      },
    },
    {
      id: "settings-obsidian",
      label: "Obsidian Integration (Coming Soon)",
      description: "Sync notes to Obsidian vault",
    },
    {
      id: "settings-github",
      label: "Open GitHub Repo",
      description: "View source on GitHub",
      action: () => {
        window.open("https://github.com/kobayashi-shuto-0105/meetily-live-viewer", "_blank", "noopener,noreferrer");
        onClose();
      },
    },
    {
      id: "settings-research-agent",
      label: "Research Agent (Coming Soon)",
      description: "AI-powered research assistant",
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
