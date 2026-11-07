-- =============================================================================
-- Migration: セクション区切りテーブルを追加する
-- =============================================================================
-- External Web UI 上でセグメント間に挿入されるセクション（区切り）を
-- 永続化するためのテーブル。
--
-- セクションは `before_sequence_id` でセグメントの直前に位置づけられる。
-- 同一セッション内で同じ位置に重複するセクションは許可しない。
-- =============================================================================

CREATE TABLE IF NOT EXISTS external_transcript_sections (
    -- セクションを一意に識別する ID（UUID 文字列を想定）
    id TEXT PRIMARY KEY,

    -- 所属する録音セッション ID
    session_id TEXT NOT NULL,

    -- 保存完了後に確定する meetings.id（録音中は NULL）
    meeting_id TEXT,

    -- セクションタイトル（例: "Discussion", "Opening"）
    title TEXT NOT NULL,

    -- セクションの説明文（任意、空文字列もあり）
    description TEXT NOT NULL DEFAULT '',

    -- このセクションが挿入される位置（直後のセグメントの sequence_id）
    before_sequence_id INTEGER NOT NULL,

    -- 作成・更新時刻（ISO8601 文字列）
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- 同一セッション内で同じ位置にセクションは 1 つだけ
    UNIQUE(session_id, before_sequence_id),

    FOREIGN KEY (session_id) REFERENCES external_recording_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
);

-- セッション ID でセクションを取得するためのインデックス
CREATE INDEX IF NOT EXISTS idx_external_sections_session_id
    ON external_transcript_sections(session_id);

-- meeting_id でセクションを取得するためのインデックス
CREATE INDEX IF NOT EXISTS idx_external_sections_meeting_id
    ON external_transcript_sections(meeting_id);
