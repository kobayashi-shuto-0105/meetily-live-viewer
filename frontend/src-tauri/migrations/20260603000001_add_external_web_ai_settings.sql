-- External Web UI rich notes / local AI settings.

ALTER TABLE external_session_notes
    ADD COLUMN content_json TEXT;

CREATE TABLE IF NOT EXISTS external_web_settings (
    id TEXT PRIMARY KEY DEFAULT '1',
    notes_ai_enabled INTEGER NOT NULL DEFAULT 0,
    ollama_endpoint TEXT NOT NULL DEFAULT 'http://127.0.0.1:11434',
    ollama_model TEXT NOT NULL DEFAULT 'llama3.2:latest',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO external_web_settings (id)
VALUES ('1')
ON CONFLICT(id) DO NOTHING;
