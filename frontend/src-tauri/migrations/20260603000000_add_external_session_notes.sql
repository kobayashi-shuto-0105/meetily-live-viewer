-- =============================================================================
-- Migration: External Web UI session notes
-- =============================================================================
-- Stores one collaborative NOTES document per external recording session.
-- Updates are broadcast to connected External Web UI clients over WebSocket.
-- =============================================================================

CREATE TABLE IF NOT EXISTS external_session_notes (
    session_id TEXT PRIMARY KEY,
    meeting_id TEXT,
    content TEXT NOT NULL DEFAULT '',
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (session_id) REFERENCES external_recording_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_external_session_notes_meeting_id
    ON external_session_notes(meeting_id);
