-- =============================================================================
-- Migration: External Web UI 用テーブル群を追加する
-- =============================================================================
-- 目的:
--   `docs/external-web-ui-plan.md` で計画している「外部 Web UI（ext-frontend）」
--   が、Meetily 本体のリアルタイム文字起こしを overlay 的に閲覧・編集・コメント・
--   ハイライトできるようにするための土台となるスキーマを追加する。
--
-- 設計方針（プラン §5・§7 と一致させること）:
--   * 既存の `transcripts` / `meetings` テーブルは **一切変更しない**（生データ扱い）。
--   * External Web UI が扱う「編集後テキスト」「コメント」「ハイライト」は
--     すべてこのマイグレーションで追加する `external_*` テーブルにのみ保存する。
--   * リアルタイム録音中はまだ `meetings.id` / `transcripts.id` が確定していない
--     ため、録音セッション単位の `external_recording_sessions.id` をアンカーに使う。
--     録音停止 → `api_save_transcript` で `meetings`/`transcripts` が確定した後に
--     `external_recording_sessions.meeting_id` を埋めて紐づけ直す。
--
-- 注意:
--   * SQLite なので `IF NOT EXISTS` を付け、再実行でも壊れないようにする。
--   * 時刻系カラム (`*_at`) は既存マイグレーション（例:
--     `20251223000000_add_meeting_notes.sql`）と同様に TEXT (ISO8601 文字列) で揃える。
--   * Rust 側 (`worker.rs::TranscriptUpdate`) の `audio_start_time` / `audio_end_time`
--     / `duration` は `f64` なので、ここでは SQLite の `REAL` (= 64bit 浮動小数点)
--     にマップする。
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. external_recording_sessions
--    1 回の録音セッションを表す overlay 用テーブル。
--    リアルタイム中は `meeting_id` が NULL のまま segments を貯めていき、
--    録音停止＆ `api_save_transcript` 完了後に `meeting_id` を埋める。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_recording_sessions (
    -- セッションを一意に識別する ID（UUID 文字列を想定）。
    -- WebSocket / REST の URL パスやイベント payload で使う主キー。
    id TEXT PRIMARY KEY,

    -- 紐づく `meetings.id`。録音中は NULL、保存完了後にセットされる。
    -- 親 meeting が削除されたら NULL に戻す（overlay データは残してよい想定）。
    meeting_id TEXT,

    -- ユーザーに見せるタイトル（録音中は仮タイトル、保存後に上書きしてよい）。
    meeting_title TEXT,

    -- セッションのライフサイクル時刻（すべて ISO8601 文字列）。
    --   started_at:    録音開始時にセット
    --   stopped_at:    録音停止時にセット（保存処理はまだ完了していないかもしれない）
    --   finalized_at:  api_save_transcript で meetings/transcripts が確定した時刻
    started_at TEXT NOT NULL,
    stopped_at TEXT,
    finalized_at TEXT,

    -- 監査用の作成・更新時刻。
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    -- meetings が消された場合は紐付けだけ外す（overlay 自体はユーザーが
    -- 後から残骸として削除できるよう履歴として保持する）。
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
);


-- -----------------------------------------------------------------------------
-- 2. external_transcript_segments
--    Rust 側の `TranscriptUpdate` をそのまま保存する overlay セグメント。
--    既存 `transcripts` には `sequence_id` / `is_partial` / `confidence` /
--    `source` がそのままの形で乗らないため、External Web UI が扱う粒度として
--    ここに別途持つ。後続の revisions / comments / highlights は **このテーブル
--    の id をアンカー**にして保存する。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_transcript_segments (
    -- セグメントを一意に識別する ID（UUID 文字列を想定）。
    id TEXT PRIMARY KEY,

    -- 所属する録音セッション。CASCADE で session が消えたら一緒に消す。
    session_id TEXT NOT NULL,

    -- 保存後に確定する `meetings.id`。録音中は NULL。
    meeting_id TEXT,

    -- 保存後に確定する `transcripts.id`。生データとの対応関係を後追いで張る用。
    -- transcripts 側が消えても overlay 側は残せるよう ON DELETE SET NULL。
    source_transcript_id TEXT,

    -- TranscriptUpdate.sequence_id（Rust 側で単調増加）。
    -- (session_id, sequence_id) で UNIQUE を張ることで、`is_partial = true` な
    -- 途中結果を ON CONFLICT で upsert できるようにする（プラン §0.6 参照）。
    sequence_id INTEGER NOT NULL,

    -- 文字起こしテキスト本体（生データ。編集後テキストは revisions 側に置く）。
    raw_text TEXT NOT NULL,

    -- TranscriptUpdate.timestamp（ISO8601 想定）。
    timestamp TEXT NOT NULL,

    -- "microphone" / "system" などの音源種別（任意）。
    source TEXT,

    -- partial/finalized の区別。SQLite に boolean 型はないので INTEGER 0/1。
    is_partial INTEGER NOT NULL DEFAULT 0,

    -- Whisper の confidence（0.0〜1.0）。
    confidence REAL,

    -- 録音開始からの相対秒数 (f64 → REAL)。プラン §0.1 参照。
    audio_start_time REAL,
    audio_end_time REAL,
    duration REAL,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    -- 同じセッション内で同じ sequence_id は 1 行だけ（partial → final の上書き用）。
    UNIQUE(session_id, sequence_id),

    FOREIGN KEY (session_id) REFERENCES external_recording_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL,
    FOREIGN KEY (source_transcript_id) REFERENCES transcripts(id) ON DELETE SET NULL
);


-- -----------------------------------------------------------------------------
-- 3. external_transcript_revisions
--    セグメントに対する「編集後テキスト」のバージョン履歴。
--    生データ (`raw_text`) は変更せず、編集はすべてここに積む。
--    is_active = 1 が「現在表示すべき編集後テキスト」を表す（複数バージョンを
--    持ちつつ最新のみアクティブ、という運用を想定）。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_transcript_revisions (
    id TEXT PRIMARY KEY,

    -- 対象セグメント。セグメントが消えたら revisions も消す。
    external_segment_id TEXT NOT NULL,

    -- 編集後テキスト本体。
    edited_text TEXT NOT NULL,

    -- 任意の編集者名（External Web UI は匿名運用もあり得るので NULL 可）。
    editor_name TEXT,

    -- バージョン番号。同一セグメントに対して 1, 2, 3... と単調増加させる想定。
    version INTEGER NOT NULL DEFAULT 1,

    -- 現在採用されている版かどうか（同一 segment 内で 1 行だけ 1 にする運用）。
    is_active INTEGER NOT NULL DEFAULT 1,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (external_segment_id) REFERENCES external_transcript_segments(id) ON DELETE CASCADE
);


-- -----------------------------------------------------------------------------
-- 4. external_transcript_comments
--    セグメントに紐づくコメント。
--    `anchor_start` / `anchor_end` を入れると、セグメント内の特定文字範囲に
--    対するコメント（インラインコメント）として扱える。両方 NULL なら
--    セグメント全体に対するコメント。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_transcript_comments (
    id TEXT PRIMARY KEY,

    -- 対象セグメント。セグメントが消えたらコメントも消す。
    external_segment_id TEXT NOT NULL,

    -- コメント本文。
    comment_text TEXT NOT NULL,

    -- 任意の投稿者名。
    author_name TEXT,

    -- セグメント本文（`raw_text` または現在 active な編集後テキスト）に対する
    -- 文字インデックス（半開区間 [start, end)）。NULL ならセグメント全体宛て。
    --
    -- `anchor_revision_id` が NULL の場合: `raw_text` を基準とする
    -- `anchor_revision_id` が NOT NULL の場合: その revision の `edited_text` を基準とする
    anchor_start INTEGER,
    anchor_end INTEGER,

    -- anchor の基準となった revision（raw_text 基準なら NULL）。
    anchor_revision_id TEXT,

    -- 解決済みコメント（スレッド close）の時刻。NULL なら未解決。
    resolved_at TEXT,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (external_segment_id) REFERENCES external_transcript_segments(id) ON DELETE CASCADE,
    FOREIGN KEY (anchor_revision_id) REFERENCES external_transcript_revisions(id) ON DELETE SET NULL
);


-- -----------------------------------------------------------------------------
-- 5. external_transcript_highlights
--    セグメント上の文字範囲ハイライト（マーカー）。
--    `color` は UI 側で扱う色キー（"yellow" / "#ffeb3b" 等、どちらでも入る
--    ように TEXT で持つ）。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_transcript_highlights (
    id TEXT PRIMARY KEY,

    external_segment_id TEXT NOT NULL,

    -- ハイライト色（UI 側のパレットキー or hex 文字列）。
    color TEXT NOT NULL,

    -- 任意のメモ（「ここ重要」等）。
    note TEXT,

    -- ハイライトする文字範囲（半開区間 [start, end)）。
    -- NULL の場合はセグメント全体ハイライトとして扱う。
    --
    -- `anchor_revision_id` が NULL の場合: `raw_text` を基準とする
    -- `anchor_revision_id` が NOT NULL の場合: その revision の `edited_text` を基準とする
    anchor_start INTEGER,
    anchor_end INTEGER,

    -- anchor の基準となった revision（raw_text 基準なら NULL）。
    anchor_revision_id TEXT,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (external_segment_id) REFERENCES external_transcript_segments(id) ON DELETE CASCADE,
    FOREIGN KEY (anchor_revision_id) REFERENCES external_transcript_revisions(id) ON DELETE SET NULL
);


-- -----------------------------------------------------------------------------
-- 6. インデックス
--    主に「ある meeting / session に紐づく overlay を取り出す」「あるセグメント
--    の revisions / comments / highlights を取り出す」アクセスパターンを高速化する。
-- -----------------------------------------------------------------------------

-- 保存済み meeting から overlay session を引くため。
CREATE INDEX IF NOT EXISTS idx_external_sessions_meeting_id
    ON external_recording_sessions(meeting_id);

-- 録音セッションに属する全セグメントを時系列で取り出すため。
CREATE INDEX IF NOT EXISTS idx_external_segments_session_id
    ON external_transcript_segments(session_id);

-- 保存済み meeting から overlay segments を引くため。
CREATE INDEX IF NOT EXISTS idx_external_segments_meeting_id
    ON external_transcript_segments(meeting_id);

-- 既存 transcripts.id から overlay segment への逆引き。
CREATE INDEX IF NOT EXISTS idx_external_segments_source_transcript_id
    ON external_transcript_segments(source_transcript_id);

-- セグメントに紐づく revisions / comments / highlights を引くため。
CREATE INDEX IF NOT EXISTS idx_external_revisions_segment_id
    ON external_transcript_revisions(external_segment_id);

-- 同一セグメント内の active revision は必ず 1 行だけにする。
-- SQLite の partial unique index で担保する。
CREATE UNIQUE INDEX IF NOT EXISTS idx_external_revisions_one_active_per_segment
    ON external_transcript_revisions(external_segment_id)
    WHERE is_active = 1;

CREATE INDEX IF NOT EXISTS idx_external_comments_segment_id
    ON external_transcript_comments(external_segment_id);

CREATE INDEX IF NOT EXISTS idx_external_highlights_segment_id
    ON external_transcript_highlights(external_segment_id);
