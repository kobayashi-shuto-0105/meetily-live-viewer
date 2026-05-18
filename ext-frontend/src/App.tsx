import { useCallback, useEffect, useRef, useState } from "react";
import { createWebSocketClient } from "./api/ws";
import type { WebSocketClient } from "./api/ws";
import { apiClient } from "./api/client";
import { useTranscriptStore } from "./stores/transcriptStore";
import { TranscriptViewer } from "./components/TranscriptViewer";
import type { TranscriptViewerHandle } from "./components/TranscriptViewer";
import { CommandPalette } from "./components/CommandPalette";
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
          comment_text: "この部分は少し意図を補足した方が伝わりやすいかも。",
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
    setSelectedSegmentId,
    applySectionFromServer,
    removeSectionFromServer,
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
  const [cmdBarVisible, setCmdBarVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBar = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setCmdBarVisible(true);
  }, []);

  const scheduleHide = useCallback(() => {
    hideTimerRef.current = setTimeout(() => setCmdBarVisible(false), 320);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        setCmdBarVisible((v) => !v);
      }
      if (e.key === "Escape") {
        setCmdBarVisible(false);
      }
      // Shift+↑: Jump to previous section
      if (e.shiftKey && e.key === "ArrowUp" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        viewerRef.current?.jumpSectionUp();
      }
      // Shift+↓: Jump to next section
      if (e.shiftKey && e.key === "ArrowDown" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        viewerRef.current?.jumpSectionDown();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const handleChangeTheme = useCallback((newTheme: "dark" | "light") => {
    setTheme(newTheme);
    applyTheme(newTheme);
  }, []);

  return (
    <div className="meetily-app">
      {showOnboarding && (
        <OnboardingModal onComplete={() => setShowOnboarding(false)} />
      )}
      {/* Invisible hover trigger at top-center */}
      <div
        className="cmd-hotzone"
        onMouseEnter={showBar}
        onMouseLeave={scheduleHide}
      />

      {/* Command Palette (full-featured overlay) */}
      {cmdBarVisible && (
        <CommandPalette
          visible={cmdBarVisible}
          onClose={() => setCmdBarVisible(false)}
          onScrollToSection={(beforeSeqId) => viewerRef.current?.scrollToSection(beforeSeqId)}
          onScrollToSegment={(segId) => viewerRef.current?.scrollToSegment(segId)}
          onChangeTheme={handleChangeTheme}
          currentTheme={theme}
        />
      )}

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
          <CommandBarTrigger
            onMouseEnter={showBar}
            onMouseLeave={scheduleHide}
            onClick={() => setCmdBarVisible(true)}
          />
          <ConnectionBadge />
        </header>

        <TranscriptViewer ref={viewerRef} />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------

function CommandBarTrigger({
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}) {
  return (
    <div
      className="command-bar is-visible"
      aria-label="Command entry"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
    >
      <span className="command-search" aria-hidden="true" />
      <span className="command-placeholder">セクション検索 / コマンドを入力</span>
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
