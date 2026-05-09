import { useEffect, useRef, useState } from "react";
import { createWebSocketClient } from "./api/ws";
import type { WebSocketClient } from "./api/ws";
import { apiClient } from "./api/client";
import { useTranscriptStore } from "./stores/transcriptStore";
import { TranscriptViewer } from "./components/TranscriptViewer";
import type { SessionInfo } from "./types";

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
  const [theme, setTheme] = useState<Theme>(loadTheme);

  const wsRef = useRef<WebSocketClient | null>(null);

  const {
    setConnectionStatus,
    upsertSegment,
    addRevision,
    addComment,
    addHighlight,
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

  const toggleTheme = () =>
    setTheme((t) => (t === "dark" ? "light" : "dark"));

  const title = session?.meetingTitle ?? "Meetily";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "var(--bg-app)",
        color: "var(--text-1)",
      }}
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0 1.25rem",
          height: "52px",
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        {/* Recording indicator dot */}
        <RecordingDot session={session} />

        {/* Meeting title */}
        <span
          style={{
            fontWeight: 600,
            fontSize: "0.95rem",
            color: "var(--text-1)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>

        {/* Connection status badge */}
        <ConnectionBadge />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          style={{
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            color: "var(--text-2)",
            padding: "0.3rem 0.5rem",
            fontSize: "0.8rem",
            lineHeight: 1,
          }}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </header>

      {/* ── Main content ────────────────────────────────────── */}
      <TranscriptViewer />
    </div>
  );
}

// ----------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------

function RecordingDot({ session }: { session: SessionInfo | null }) {
  if (!session) return null;
  const isRecording = !session.isStopped;
  return (
    <span
      style={{
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        flexShrink: 0,
        background: isRecording ? "var(--err)" : "var(--text-3)",
        animation: isRecording ? "pulse 1.5s ease-in-out infinite" : undefined,
      }}
    />
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
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.35rem",
        fontSize: "0.75rem",
        color,
        fontWeight: 500,
      }}
    >
      <span
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: color,
          animation: status === "connecting" ? "pulse 1.2s ease-in-out infinite" : undefined,
        }}
      />
      {label}
    </span>
  );
}

export default App;
