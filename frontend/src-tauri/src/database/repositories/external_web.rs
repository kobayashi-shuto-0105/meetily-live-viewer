// =============================================================================
// External Web UI 用リポジトリ
// =============================================================================
// `external_*` テーブル群に対する CRUD 操作を提供する。
// プラン §11〜§12 で定義されたサービス層から呼び出される想定。
//
// 設計方針:
//   - 既存の `transcripts` / `meetings` テーブルは一切変更しない
//   - upsert は ON CONFLICT(session_id, sequence_id) DO UPDATE で実現（プラン §0.6）
//   - トランザクションを使い、revision の is_active 切替は原子的に行う
// =============================================================================

use sqlx::{Error as SqlxError, SqlitePool};
use tracing::info;
use uuid::Uuid;

use crate::database::models::{
    ExternalRecordingSession, ExternalTranscriptComment, ExternalTranscriptHighlight,
    ExternalTranscriptRevision, ExternalTranscriptSection, ExternalTranscriptSegment,
};

/// External Web UI 用の DB 操作をまとめたリポジトリ構造体。
/// 既存リポジトリ（TranscriptsRepository 等）と同じパターンで static メソッドを提供する。
pub struct ExternalWebRepository;

impl ExternalWebRepository {
    // =========================================================================
    // セッション操作
    // =========================================================================

    /// 新しい録音セッションを作成する。
    /// 録音開始時に呼び出され、`meeting_id` は None のまま開始する。
    pub async fn create_session(
        pool: &SqlitePool,
        meeting_title: Option<&str>,
    ) -> Result<ExternalRecordingSession, SqlxError> {
        let id = format!("ext-session-{}", Uuid::new_v4());
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO external_recording_sessions (id, meeting_id, meeting_title, started_at, created_at, updated_at)
             VALUES (?, NULL, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(meeting_title)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        info!("Created external recording session: {}", id);

        Ok(ExternalRecordingSession {
            id,
            meeting_id: None,
            meeting_title: meeting_title.map(|s| s.to_string()),
            started_at: now.clone(),
            stopped_at: None,
            finalized_at: None,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// 録音停止時にセッションの `stopped_at` を更新する。
    pub async fn stop_session(pool: &SqlitePool, session_id: &str) -> Result<(), SqlxError> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "UPDATE external_recording_sessions SET stopped_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&now)
        .bind(&now)
        .bind(session_id)
        .execute(pool)
        .await?;

        info!("Stopped external recording session: {}", session_id);
        Ok(())
    }

    /// `api_save_transcript` 完了後にセッションを meeting に紐付ける。
    /// セッション自身と、そのセッションに属する全 segments の `meeting_id` を一括更新する。
    pub async fn finalize_session(
        pool: &SqlitePool,
        session_id: &str,
        meeting_id: &str,
    ) -> Result<(), SqlxError> {
        let now = chrono::Utc::now().to_rfc3339();

        let mut tx = pool.begin().await?;

        // セッションに meeting_id と finalized_at をセット
        sqlx::query(
            "UPDATE external_recording_sessions
             SET meeting_id = ?, finalized_at = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(meeting_id)
        .bind(&now)
        .bind(&now)
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

        // 同セッションに属する全 segments にも meeting_id を伝播
        sqlx::query(
            "UPDATE external_transcript_segments
             SET meeting_id = ?, updated_at = ?
             WHERE session_id = ?",
        )
        .bind(meeting_id)
        .bind(&now)
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

        // 同セッションに属する全 sections にも meeting_id を伝播
        sqlx::query(
            "UPDATE external_transcript_sections
             SET meeting_id = ?, updated_at = ?
             WHERE session_id = ?",
        )
        .bind(meeting_id)
        .bind(&now)
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        info!(
            "Finalized external session {} → meeting {}",
            session_id, meeting_id
        );
        Ok(())
    }

    /// セッション ID からセッションを取得する。
    pub async fn get_session_by_id(
        pool: &SqlitePool,
        session_id: &str,
    ) -> Result<Option<ExternalRecordingSession>, SqlxError> {
        let session = sqlx::query_as::<_, ExternalRecordingSession>(
            "SELECT id, meeting_id, meeting_title, started_at, stopped_at, finalized_at, created_at, updated_at
             FROM external_recording_sessions WHERE id = ?",
        )
        .bind(session_id)
        .fetch_optional(pool)
        .await?;

        Ok(session)
    }

    /// 現在アクティブなセッション（stopped_at が NULL）を取得する。
    /// 通常は 0〜1 件のみ存在する想定。
    pub async fn get_active_session(
        pool: &SqlitePool,
    ) -> Result<Option<ExternalRecordingSession>, SqlxError> {
        let session = sqlx::query_as::<_, ExternalRecordingSession>(
            "SELECT id, meeting_id, meeting_title, started_at, stopped_at, finalized_at, created_at, updated_at
             FROM external_recording_sessions
             WHERE stopped_at IS NULL
             ORDER BY started_at DESC
             LIMIT 1",
        )
        .fetch_optional(pool)
        .await?;

        Ok(session)
    }

    // =========================================================================
    // セグメント操作
    // =========================================================================

    /// TranscriptUpdate を受け取り、セグメントを upsert する。
    /// `(session_id, sequence_id)` の UNIQUE 制約を利用し、
    /// partial → final の上書きに ON CONFLICT DO UPDATE で対応する（プラン §0.6）。
    ///
    /// # 引数
    /// - `session_id`: 所属する録音セッション ID
    /// - `sequence_id`: TranscriptUpdate.sequence_id（単調増加）
    /// - `raw_text`: 文字起こしテキスト本体
    /// - `timestamp`: 表示用タイムスタンプ（例: `14:30:05`）
    /// - `source`: 音源種別（"microphone" / "system" 等）
    /// - `is_partial`: 途中結果かどうか
    /// - `confidence`: Whisper の confidence
    /// - `audio_start_time`, `audio_end_time`, `duration`: 録音開始からの相対秒数
    #[allow(clippy::too_many_arguments)]
    pub async fn upsert_segment(
        pool: &SqlitePool,
        session_id: &str,
        sequence_id: i64,
        raw_text: &str,
        timestamp: &str,
        source: Option<&str>,
        is_partial: bool,
        confidence: Option<f64>,
        audio_start_time: Option<f64>,
        audio_end_time: Option<f64>,
        duration: Option<f64>,
    ) -> Result<ExternalTranscriptSegment, SqlxError> {
        let id = format!("ext-seg-{}", Uuid::new_v4());
        let now = chrono::Utc::now().to_rfc3339();

        // ON CONFLICT で既存行を更新（partial → final の上書き）
        sqlx::query(
            "INSERT INTO external_transcript_segments
                (id, session_id, sequence_id, raw_text, timestamp, source, is_partial, confidence, audio_start_time, audio_end_time, duration, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(session_id, sequence_id) DO UPDATE SET
                raw_text = excluded.raw_text,
                timestamp = excluded.timestamp,
                source = excluded.source,
                is_partial = excluded.is_partial,
                confidence = excluded.confidence,
                audio_start_time = excluded.audio_start_time,
                audio_end_time = excluded.audio_end_time,
                duration = excluded.duration,
                updated_at = excluded.updated_at",
        )
        .bind(&id)
        .bind(session_id)
        .bind(sequence_id)
        .bind(raw_text)
        .bind(timestamp)
        .bind(source)
        .bind(is_partial)
        .bind(confidence)
        .bind(audio_start_time)
        .bind(audio_end_time)
        .bind(duration)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        // upsert 後の実際の行を返す（ON CONFLICT 時は既存行の id が保持されるため再取得する）
        let segment = sqlx::query_as::<_, ExternalTranscriptSegment>(
            "SELECT id, session_id, meeting_id, source_transcript_id, sequence_id, raw_text, timestamp, source, is_partial, confidence, audio_start_time, audio_end_time, duration, created_at, updated_at
             FROM external_transcript_segments
             WHERE session_id = ? AND sequence_id = ?",
        )
        .bind(session_id)
        .bind(sequence_id)
        .fetch_one(pool)
        .await?;

        Ok(segment)
    }

    /// 指定セッションに属する全セグメントを sequence_id 昇順で取得する。
    pub async fn get_segments_by_session(
        pool: &SqlitePool,
        session_id: &str,
    ) -> Result<Vec<ExternalTranscriptSegment>, SqlxError> {
        let segments = sqlx::query_as::<_, ExternalTranscriptSegment>(
            "SELECT id, session_id, meeting_id, source_transcript_id, sequence_id, raw_text, timestamp, source, is_partial, confidence, audio_start_time, audio_end_time, duration, created_at, updated_at
             FROM external_transcript_segments
             WHERE session_id = ?
             ORDER BY sequence_id ASC",
        )
        .bind(session_id)
        .fetch_all(pool)
        .await?;

        Ok(segments)
    }

    /// 指定 meeting_id に紐づく全セグメントを sequence_id 昇順で取得する。
    /// `finalize_session` 完了後に使用する。
    pub async fn get_segments_by_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<ExternalTranscriptSegment>, SqlxError> {
        let segments = sqlx::query_as::<_, ExternalTranscriptSegment>(
            "SELECT id, session_id, meeting_id, source_transcript_id, sequence_id, raw_text, timestamp, source, is_partial, confidence, audio_start_time, audio_end_time, duration, created_at, updated_at
             FROM external_transcript_segments
             WHERE meeting_id = ?
             ORDER BY sequence_id ASC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await?;

        Ok(segments)
    }

    // =========================================================================
    // リビジョン操作
    // =========================================================================

    /// セグメントに対する新しい revision（編集後テキスト）を作成する。
    /// 同一セグメントの既存 active revision を deactivate してから新規 INSERT する。
    /// トランザクションで原子性を保証する。
    pub async fn create_revision(
        pool: &SqlitePool,
        segment_id: &str,
        edited_text: &str,
        editor_name: Option<&str>,
    ) -> Result<ExternalTranscriptRevision, SqlxError> {
        let id = format!("ext-rev-{}", Uuid::new_v4());
        let now = chrono::Utc::now().to_rfc3339();

        let mut tx = pool.begin().await?;

        // 1. 既存の active revision を deactivate（同一セグメント内で 1 つだけ active にする）
        sqlx::query(
            "UPDATE external_transcript_revisions
             SET is_active = 0, updated_at = ?
             WHERE external_segment_id = ? AND is_active = 1",
        )
        .bind(&now)
        .bind(segment_id)
        .execute(&mut *tx)
        .await?;

        // 2. 次のバージョン番号を算出
        let max_version: Option<i64> = sqlx::query_scalar(
            "SELECT MAX(version) FROM external_transcript_revisions WHERE external_segment_id = ?",
        )
        .bind(segment_id)
        .fetch_one(&mut *tx)
        .await?;
        let next_version = max_version.unwrap_or(0) + 1;

        // 3. 新しい revision を INSERT（is_active = 1）
        sqlx::query(
            "INSERT INTO external_transcript_revisions
                (id, external_segment_id, edited_text, editor_name, version, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
        )
        .bind(&id)
        .bind(segment_id)
        .bind(edited_text)
        .bind(editor_name)
        .bind(next_version)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        info!(
            "Created revision {} (v{}) for segment {}",
            id, next_version, segment_id
        );

        Ok(ExternalTranscriptRevision {
            id,
            external_segment_id: segment_id.to_string(),
            edited_text: edited_text.to_string(),
            editor_name: editor_name.map(|s| s.to_string()),
            version: next_version,
            is_active: true,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// 指定セグメントの現在 active な revision を取得する。
    /// 存在しない場合は None（= raw_text をそのまま表示する）。
    pub async fn get_active_revision(
        pool: &SqlitePool,
        segment_id: &str,
    ) -> Result<Option<ExternalTranscriptRevision>, SqlxError> {
        let revision = sqlx::query_as::<_, ExternalTranscriptRevision>(
            "SELECT id, external_segment_id, edited_text, editor_name, version, is_active, created_at, updated_at
             FROM external_transcript_revisions
             WHERE external_segment_id = ? AND is_active = 1",
        )
        .bind(segment_id)
        .fetch_optional(pool)
        .await?;

        Ok(revision)
    }

    /// 指定セグメントの全 revision 履歴を version 降順で取得する。
    pub async fn get_revisions_by_segment(
        pool: &SqlitePool,
        segment_id: &str,
    ) -> Result<Vec<ExternalTranscriptRevision>, SqlxError> {
        let revisions = sqlx::query_as::<_, ExternalTranscriptRevision>(
            "SELECT id, external_segment_id, edited_text, editor_name, version, is_active, created_at, updated_at
             FROM external_transcript_revisions
             WHERE external_segment_id = ?
             ORDER BY version DESC",
        )
        .bind(segment_id)
        .fetch_all(pool)
        .await?;

        Ok(revisions)
    }

    // =========================================================================
    // コメント操作
    // =========================================================================

    /// セグメントに対するコメントを作成する。
    /// `anchor_start` / `anchor_end` を指定するとインラインコメントになる。
    pub async fn create_comment(
        pool: &SqlitePool,
        segment_id: &str,
        comment_text: &str,
        author_name: Option<&str>,
        anchor_start: Option<i64>,
        anchor_end: Option<i64>,
        anchor_revision_id: Option<&str>,
    ) -> Result<ExternalTranscriptComment, SqlxError> {
        let id = format!("ext-comment-{}", Uuid::new_v4());
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO external_transcript_comments
                (id, external_segment_id, comment_text, author_name, anchor_start, anchor_end, anchor_revision_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(segment_id)
        .bind(comment_text)
        .bind(author_name)
        .bind(anchor_start)
        .bind(anchor_end)
        .bind(anchor_revision_id)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        info!("Created comment {} for segment {}", id, segment_id);

        Ok(ExternalTranscriptComment {
            id,
            external_segment_id: segment_id.to_string(),
            comment_text: comment_text.to_string(),
            author_name: author_name.map(|s| s.to_string()),
            anchor_start,
            anchor_end,
            anchor_revision_id: anchor_revision_id.map(|s| s.to_string()),
            resolved_at: None,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// コメントを解決済みにする。
    pub async fn resolve_comment(pool: &SqlitePool, comment_id: &str) -> Result<(), SqlxError> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "UPDATE external_transcript_comments
             SET resolved_at = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&now)
        .bind(&now)
        .bind(comment_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// 指定セグメントの全コメントを作成日時昇順で取得する。
    pub async fn get_comments_by_segment(
        pool: &SqlitePool,
        segment_id: &str,
    ) -> Result<Vec<ExternalTranscriptComment>, SqlxError> {
        let comments = sqlx::query_as::<_, ExternalTranscriptComment>(
            "SELECT id, external_segment_id, comment_text, author_name, anchor_start, anchor_end, anchor_revision_id, resolved_at, created_at, updated_at
             FROM external_transcript_comments
             WHERE external_segment_id = ?
             ORDER BY created_at ASC",
        )
        .bind(segment_id)
        .fetch_all(pool)
        .await?;

        Ok(comments)
    }

    // =========================================================================
    // ハイライト操作
    // =========================================================================

    /// セグメントに対するハイライトを作成する。
    pub async fn create_highlight(
        pool: &SqlitePool,
        segment_id: &str,
        color: &str,
        note: Option<&str>,
        anchor_start: Option<i64>,
        anchor_end: Option<i64>,
        anchor_revision_id: Option<&str>,
    ) -> Result<ExternalTranscriptHighlight, SqlxError> {
        let id = format!("ext-highlight-{}", Uuid::new_v4());
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO external_transcript_highlights
                (id, external_segment_id, color, note, anchor_start, anchor_end, anchor_revision_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(segment_id)
        .bind(color)
        .bind(note)
        .bind(anchor_start)
        .bind(anchor_end)
        .bind(anchor_revision_id)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        info!("Created highlight {} for segment {}", id, segment_id);

        Ok(ExternalTranscriptHighlight {
            id,
            external_segment_id: segment_id.to_string(),
            color: color.to_string(),
            note: note.map(|s| s.to_string()),
            anchor_start,
            anchor_end,
            anchor_revision_id: anchor_revision_id.map(|s| s.to_string()),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// ハイライトを削除する。
    pub async fn delete_highlight(pool: &SqlitePool, highlight_id: &str) -> Result<(), SqlxError> {
        sqlx::query("DELETE FROM external_transcript_highlights WHERE id = ?")
            .bind(highlight_id)
            .execute(pool)
            .await?;

        Ok(())
    }

    /// 指定セグメントの全ハイライトを作成日時昇順で取得する。
    pub async fn get_highlights_by_segment(
        pool: &SqlitePool,
        segment_id: &str,
    ) -> Result<Vec<ExternalTranscriptHighlight>, SqlxError> {
        let highlights = sqlx::query_as::<_, ExternalTranscriptHighlight>(
            "SELECT id, external_segment_id, color, note, anchor_start, anchor_end, anchor_revision_id, created_at, updated_at
             FROM external_transcript_highlights
             WHERE external_segment_id = ?
             ORDER BY created_at ASC",
        )
        .bind(segment_id)
        .fetch_all(pool)
        .await?;

        Ok(highlights)
    }

    // =========================================================================
    // セクション操作
    // =========================================================================

    /// セッションに対するセクションを作成する。
    pub async fn create_section(
        pool: &SqlitePool,
        session_id: &str,
        title: &str,
        description: &str,
        before_sequence_id: i64,
    ) -> Result<ExternalTranscriptSection, SqlxError> {
        let id = format!("ext-section-{}", Uuid::new_v4());
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO external_transcript_sections
                (id, session_id, title, description, before_sequence_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(session_id)
        .bind(title)
        .bind(description)
        .bind(before_sequence_id)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        info!("Created section {} for session {}", id, session_id);

        Ok(ExternalTranscriptSection {
            id,
            session_id: session_id.to_string(),
            meeting_id: None,
            title: title.to_string(),
            description: description.to_string(),
            before_sequence_id,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// セクションのタイトルと説明を更新する。
    pub async fn update_section(
        pool: &SqlitePool,
        section_id: &str,
        title: &str,
        description: &str,
    ) -> Result<ExternalTranscriptSection, SqlxError> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "UPDATE external_transcript_sections
             SET title = ?, description = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(title)
        .bind(description)
        .bind(&now)
        .bind(section_id)
        .execute(pool)
        .await?;

        // 更新後の行を返す
        let section = sqlx::query_as::<_, ExternalTranscriptSection>(
            "SELECT id, session_id, meeting_id, title, description, before_sequence_id, created_at, updated_at
             FROM external_transcript_sections
             WHERE id = ?",
        )
        .bind(section_id)
        .fetch_one(pool)
        .await?;

        info!("Updated section {}", section_id);

        Ok(section)
    }

    /// セクションを削除する。
    pub async fn delete_section(pool: &SqlitePool, section_id: &str) -> Result<(), SqlxError> {
        sqlx::query("DELETE FROM external_transcript_sections WHERE id = ?")
            .bind(section_id)
            .execute(pool)
            .await?;

        info!("Deleted section {}", section_id);
        Ok(())
    }

    /// 指定セッションの全セクションを before_sequence_id 昇順で取得する。
    pub async fn get_sections_by_session(
        pool: &SqlitePool,
        session_id: &str,
    ) -> Result<Vec<ExternalTranscriptSection>, SqlxError> {
        let sections = sqlx::query_as::<_, ExternalTranscriptSection>(
            "SELECT id, session_id, meeting_id, title, description, before_sequence_id, created_at, updated_at
             FROM external_transcript_sections
             WHERE session_id = ?
             ORDER BY before_sequence_id ASC",
        )
        .bind(session_id)
        .fetch_all(pool)
        .await?;

        Ok(sections)
    }

    /// セクション ID からセクションを取得する。
    pub async fn get_section_by_id(
        pool: &SqlitePool,
        section_id: &str,
    ) -> Result<Option<ExternalTranscriptSection>, SqlxError> {
        let section = sqlx::query_as::<_, ExternalTranscriptSection>(
            "SELECT id, session_id, meeting_id, title, description, before_sequence_id, created_at, updated_at
             FROM external_transcript_sections
             WHERE id = ?",
        )
        .bind(section_id)
        .fetch_optional(pool)
        .await?;

        Ok(section)
    }
}
