import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createWebSocketClient } from "./api/ws";
import type { WebSocketClient } from "./api/ws";
import { apiClient } from "./api/client";
import { useTranscriptStore } from "./stores/transcriptStore";
import { TranscriptViewer } from "./components/TranscriptViewer";
import type { TranscriptViewerHandle } from "./components/TranscriptViewer";
import { CommandPalette } from "./components/CommandPalette";
import { NotePanel } from "./components/NotePanel";
import { OnboardingModal } from "./components/OnboardingModal";
import { loadAuthorName } from "./stores/authorName";
import type { TranscriptSegmentResponse } from "./types";

// ----------------------------------------------------------------
// Theme helpers
// ----------------------------------------------------------------

type Theme = "dark" | "light";

function loadTheme(): Theme {
  return (localStorage.getItem("meetily-theme") as Theme) ?? "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("meetily-theme", theme);
}

const mockSessionId = "mock-session-sidecar-layout";

function createDevMockSegments(): TranscriptSegmentResponse[] {
  const base = {
    session_id: mockSessionId,
    meeting_id: null,
    source: "microphone",
    is_partial: false,
    confidence: 0.96,
    revisions: [],
    highlights: [],
  };

  return [
    {
      ...base,
      id: "mock-segment-1",
      sequence_id: 1,
      raw_text: "You know that.",
      display_text: "You know that.",
      timestamp: "01:28",
      audio_start_time: 88,
      audio_end_time: 90,
      duration: 2,
      comments: [],
    },
    {
      ...base,
      id: "mock-segment-2",
      sequence_id: 2,
      raw_text: "I don't want this one.",
      display_text: "I don't want this one.",
      timestamp: "01:29",
      audio_start_time: 91,
      audio_end_time: 94,
      duration: 3,
      comments: [
        {
          id: "mock-comment-1",
          external_segment_id: "mock-segment-2",
          comment_text: "Add a little more context here before sharing the recap.",
          author_name: "Sarah J.",
          anchor_start: null,
          anchor_end: null,
          anchor_revision_id: null,
          created_at: new Date().toISOString(),
        },
      ],
    },
    {
      ...base,
      id: "mock-segment-3",
      sequence_id: 3,
      raw_text: "Let's keep the alternative version for the summary.",
      display_text: "Let's keep the alternative version for the summary.",
      timestamp: "01:34",
      audio_start_time: 96,
      audio_end_time: 100,
      duration: 4,
      comments: [],
      highlights: [
        {
          id: "mock-highlight-1",
          external_segment_id: "mock-segment-3",
          color: "todo",
          note: null,
          anchor_start: null,
          anchor_end: null,
          anchor_revision_id: null,
          created_at: new Date().toISOString(),
        },
      ],
    },
  ];
}

// ----------------------------------------------------------------
// App
// ----------------------------------------------------------------

function App() {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [showOnboarding, setShowOnboarding] = useState(() => loadAuthorName() === null);

  const wsRef = useRef<WebSocketClient | null>(null);
  const viewerRef = useRef<TranscriptViewerHandle>(null);
  const commandShellRef = useRef<HTMLDivElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  const {
    setConnectionStatus,
    upsertSegment,
    addRevision,
    addComment,
    addHighlight,
    removeHighlight,
    startSession,
    stopSession,
    setMeetingId,
    restoreSession,
    loadSegments,
    loadSections,
    loadNotes,
    setSelectedSegmentId,
    applySectionFromServer,
    removeSectionFromServer,
    applyNotesFromServer,
    session,
  } = useTranscriptStore();

  // Apply theme to <html data-theme>
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Restore existing session + segments on first load
  useEffect(() => {
    function loadDevMockSession() {
      restoreSession(mockSessionId, null, new Date().toISOString());
      loadSegments(createDevMockSegments());
      loadSections([
        {
          id: "mock-section-1",
          title: "Opening context",
          description: "Clarify the decision we want to capture before the action items.",
          beforeSequenceId: 1,
          createdAt: new Date().toISOString(),
        },
        {
          id: "mock-section-2",
          title: "Summary decision",
          description: "Keep the stronger phrasing for the final meeting summary.",
          beforeSequenceId: 3,
          createdAt: new Date().toISOString(),
        },
      ]);
      loadNotes({
        session_id: mockSessionId,
        meeting_id: null,
        content:
          "Meeting overview\n\nA focused discussion on summary quality, transcript cleanup, and follow-up ownership.\n\nKey takeaways\n- Keep transcript sections centered while notes stay in the left glass panel.\n- Comment and highlight details are reviewed from focused sections.\n- The shared notes area should remain editable during the session.\n\nAction items\n[ ] Tighten wording for the recap\n[ ] Confirm which comments should become summary notes",
        updated_by: "Preview",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setSelectedSegmentId("mock-segment-2");
    }

    async function initialLoad() {
      try {
        const current = await apiClient.getCurrentSession();
        if (!current) {
          console.log("[initialLoad] No active session found.");
          if (import.meta.env.DEV) loadDevMockSession();
          return;
        }
        console.log("[initialLoad] Restoring session:", current.session_id);
        restoreSession(current.session_id, current.meeting_title, current.started_at);
        const segments = await apiClient.getSessionTranscripts(current.session_id);
        console.log("[initialLoad] Loaded segments:", segments.length);
        loadSegments(segments);

        // Load sections for this session (always call to clear stale state)
        try {
          const sections = await apiClient.getSessionSections(current.session_id);
          loadSections(
            sections.map((s) => ({
              id: s.id,
              title: s.title,
              description: s.description,
              beforeSequenceId: s.before_sequence_id,
              createdAt: s.created_at,
            }))
          );
          console.log("[initialLoad] Loaded sections:", sections.length);
        } catch (e) {
          console.warn("[initialLoad] Failed to load sections:", e);
        }
        try {
          loadNotes(await apiClient.getSessionNotes(current.session_id));
        } catch (e) {
          console.warn("[initialLoad] Failed to load notes:", e);
        }
      } catch (e) {
        // Log so the error is visible in DevTools — not a fatal failure
        console.warn("[initialLoad] Failed to restore session from REST API:", e);
        if (import.meta.env.DEV) loadDevMockSession();
      }
    }
    initialLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // WebSocket connection
  useEffect(() => {
    const ws = createWebSocketClient({
      onEvent: (event) => {
        switch (event.type) {
          case "RecordingStarted": {
            // If the server re-sends RecordingStarted for the SAME session we
            // already restored from the REST API, don't call startSession()
            // (which clears all segments). Use restoreSession() instead so
            // the transcripts we just fetched are preserved.
            const existingId = useTranscriptStore.getState().session?.sessionId;
            if (existingId === event.payload.session_id) {
              restoreSession(
                event.payload.session_id,
                event.payload.meeting_title,
                event.payload.started_at
              );
            } else {
              startSession(
                event.payload.session_id,
                event.payload.meeting_title,
                event.payload.started_at
              );
            }
            break;
          }
          case "RecordingStopped":
            stopSession();
            break;
          case "MeetingPersisted":
            setMeetingId(event.payload.session_id, event.payload.meeting_id);
            break;
          case "TranscriptSegmentUpserted":
            upsertSegment(event.payload);
            break;
          case "TranscriptRevisionCreated":
            addRevision(event.payload);
            break;
          case "TranscriptCommentCreated":
            addComment(event.payload);
            break;
          case "TranscriptHighlightCreated":
            addHighlight(event.payload);
            break;
          case "TranscriptHighlightDeleted":
            removeHighlight(event.payload);
            break;
          case "TranscriptSectionCreated":
            applySectionFromServer(event.payload);
            break;
          case "TranscriptSectionUpdated":
            applySectionFromServer(event.payload);
            break;
          case "TranscriptSectionDeleted":
            removeSectionFromServer(event.payload.id);
            break;
          case "SessionNotesUpdated":
            applyNotesFromServer(event.payload);
            break;
        }
      },
      onStatusChange: setConnectionStatus,
    });

    wsRef.current = ws;
    ws.connect();

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = session?.meetingTitle?.trim() ?? "";

  // ---- Command bar visibility (⌘P or top-center hover) ----
  const [cmdBarHintVisible, setCmdBarHintVisible] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBar = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setCmdBarHintVisible(true);
  }, []);

  const scheduleHide = useCallback(() => {
    hideTimerRef.current = setTimeout(() => setCmdBarHintVisible(false), 90);
  }, []);

  const closeCommandBar = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setIsPaletteOpen(false);
    setCommandQuery("");
    setCmdBarHintVisible(false);
    commandInputRef.current?.blur();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTypingTarget =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        setCmdBarHintVisible(true);
        setIsPaletteOpen(true);
        requestAnimationFrame(() => {
          commandInputRef.current?.focus();
          commandInputRef.current?.select();
        });
      }
      if (e.key === "Escape") {
        closeCommandBar();
      }
      // Shift+↑: Jump to previous section
      if (!isTypingTarget && e.shiftKey && e.key === "ArrowUp" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        viewerRef.current?.jumpSectionUp();
      }
      // Shift+↓: Jump to next section
      if (!isTypingTarget && e.shiftKey && e.key === "ArrowDown" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        viewerRef.current?.jumpSectionDown();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [closeCommandBar]);

  useEffect(() => {
    if (!isPaletteOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (commandShellRef.current?.contains(target)) return;
      closeCommandBar();
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isPaletteOpen, closeCommandBar]);

  const handleChangeTheme = useCallback((newTheme: "dark" | "light") => {
    setTheme(newTheme);
  }, []);

  // Load a past session from history into the viewer
  const handleLoadSession = useCallback(
    async (sessionId: string, meetingTitle: string | null, startedAt: string) => {
      try {
        restoreSession(sessionId, meetingTitle, startedAt);
        const segments = await apiClient.getSessionTranscripts(sessionId);
        loadSegments(segments);

        try {
          const sections = await apiClient.getSessionSections(sessionId);
          loadSections(
            sections.map((s) => ({
              id: s.id,
              title: s.title,
              description: s.description,
              beforeSequenceId: s.before_sequence_id,
              createdAt: s.created_at,
            }))
          );
        } catch (e) {
          console.warn("[handleLoadSession] Failed to load sections:", e);
        }
        try {
          loadNotes(await apiClient.getSessionNotes(sessionId));
        } catch (e) {
          console.warn("[handleLoadSession] Failed to load notes:", e);
        }
      } catch (e) {
        console.warn("[handleLoadSession] Failed to load session:", e);
      }
    },
    [restoreSession, loadSegments, loadSections, loadNotes]
  );

  return (
    <div className="meetily-app">
      {showOnboarding && (
        <OnboardingModal onComplete={() => setShowOnboarding(false)} />
      )}
      {/* Invisible hover trigger at top-center */}
      <div
        className="cmd-hotzone"
        style={{ pointerEvents: cmdBarHintVisible || isPaletteOpen ? "none" : "auto" }}
        onMouseEnter={showBar}
        onMouseLeave={scheduleHide}
      />

      <div className="app-frame">
        <header className="app-header">
          <div className="brand-corner" aria-label="Meetily">
            <img
              className="brand-icon brand-icon-dark"
              src="/assets/Meetily_icon_white.png"
              alt=""
            />
            <img
              className="brand-icon brand-icon-light"
              src="/assets/Meetily_icon_black.png"
              alt=""
            />
          </div>

          {title && <h1 className="meeting-title">{title}</h1>}
          <div className="command-shell" ref={commandShellRef}>
            <CommandBarTrigger
              visible={cmdBarHintVisible || isPaletteOpen}
              onMouseEnter={showBar}
              onMouseLeave={scheduleHide}
              query={commandQuery}
              onQueryChange={(value) => {
                setCommandQuery(value);
                if (!isPaletteOpen) setIsPaletteOpen(true);
              }}
              onFocusInput={() => {
                setCmdBarHintVisible(true);
                setIsPaletteOpen(true);
                requestAnimationFrame(() => commandInputRef.current?.focus());
              }}
              onEscape={closeCommandBar}
              inputRef={commandInputRef}
            />
            {isPaletteOpen && (
              <CommandPalette
                visible={isPaletteOpen}
                query={commandQuery}
                onClose={closeCommandBar}
                onScrollToSection={(beforeSeqId) => viewerRef.current?.scrollToSection(beforeSeqId)}
                onScrollToSegment={(segId) => viewerRef.current?.scrollToSegment(segId)}
                onLoadSession={handleLoadSession}
                onChangeTheme={handleChangeTheme}
                currentTheme={theme}
              />
            )}
          </div>
          <ConnectionBadge />
        </header>

        <div className="app-main">
          <NotePanel />
          <TranscriptViewer ref={viewerRef} />
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------

const PLACEHOLDER_HINTS = [
  "Search sections…",
  "# Browse history",
  "> Run command",
] as const;

function CommandBarTrigger({
  visible,
  onMouseEnter,
  onMouseLeave,
  query,
  onQueryChange,
  onFocusInput,
  onEscape,
  inputRef,
}: {
  visible: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  onFocusInput: () => void;
  onEscape: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [hintIndex, setHintIndex] = useState(0);

  // Rotate placeholder hints every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setHintIndex((i) => (i + 1) % PLACEHOLDER_HINTS.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className={`command-bar${visible ? " is-visible" : ""}`}
      aria-label="Command entry"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={(e) => {
        e.preventDefault();
        onFocusInput();
      }}
    >
      <span className="command-search" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        className="command-input"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={onFocusInput}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onEscape();
          }
        }}
        autoComplete="off"
        spellCheck={false}
        placeholder={PLACEHOLDER_HINTS[hintIndex]}
        aria-label="Command input"
      />
      <span className="command-kbd">⌘ P</span>
    </div>
  );
}

function ConnectionBadge() {
  const status = useTranscriptStore((s) => s.connectionStatus);

  const MAP = {
    connected:    { label: "Live",         color: "var(--ok)" },
    connecting:   { label: "Connecting…",  color: "var(--warn)" },
    disconnected: { label: "Disconnected", color: "var(--err)" },
    error:        { label: "Error",        color: "var(--err)" },
  } as const;

  const { label, color } = MAP[status];

  return (
    <span
      className="connection-badge"
      style={{ color }}
    >
      <span
        className="connection-dot"
        style={{
          background: color,
          animation: status === "connecting" ? "pulse 1.2s ease-in-out infinite" : undefined,
        }}
      />
      {label}
    </span>
  );
}

export default App;
