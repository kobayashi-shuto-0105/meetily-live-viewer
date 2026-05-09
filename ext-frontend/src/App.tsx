import { useCallback, useEffect, useRef, useState } from "react";
import { createWebSocketClient } from "./api/ws";
import type { WebSocketClient } from "./api/ws";
import { apiClient } from "./api/client";
import { useTranscriptStore } from "./stores/transcriptStore";
import { TranscriptViewer } from "./components/TranscriptViewer";

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

// ----------------------------------------------------------------
// App
// ----------------------------------------------------------------

function App() {
  const [theme] = useState<Theme>(loadTheme);

  const wsRef = useRef<WebSocketClient | null>(null);

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
    session,
  } = useTranscriptStore();

  // Apply theme to <html data-theme>
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Restore existing session + segments on first load
  useEffect(() => {
    async function initialLoad() {
      try {
        const current = await apiClient.getCurrentSession();
        if (!current) {
          console.log("[initialLoad] No active session found.");
          return;
        }
        console.log("[initialLoad] Restoring session:", current.session_id);
        restoreSession(current.session_id, current.meeting_title, current.started_at);
        const segments = await apiClient.getSessionTranscripts(current.session_id);
        console.log("[initialLoad] Loaded segments:", segments.length);
        loadSegments(segments);
      } catch (e) {
        // Log so the error is visible in DevTools — not a fatal failure
        console.warn("[initialLoad] Failed to restore session from REST API:", e);
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
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="meetily-app">
      {/* Invisible hover trigger at top-center */}
      <div
        className="cmd-hotzone"
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
          <CommandBar
            visible={cmdBarVisible}
            onMouseEnter={showBar}
            onMouseLeave={scheduleHide}
          />
          <ConnectionBadge />
        </header>

        <TranscriptViewer />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------

function CommandBar({
  visible,
  onMouseEnter,
  onMouseLeave,
}: {
  visible: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <div
      className={`command-bar${visible ? " is-visible" : ""}`}
      aria-label="Command entry"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span className="command-search" aria-hidden="true" />
      <span className="command-placeholder">コメントを追加 / コマンドを入力</span>
      <span className="command-kbd">⌘ P</span>
      <button className="command-submit" type="button" aria-label="Submit command">
        ↑
      </button>
      <div className="command-help" aria-hidden="true">
        T: TODO <span>|</span> F: FIXME <span>|</span> ⌘ Enter: コメント <span>|</span> Esc: 閉じる
      </div>
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
