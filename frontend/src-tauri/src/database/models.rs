use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// =============================================================================
// External Web UI 用モデル
// =============================================================================
// これらのモデルは `external_*` テーブル群に対応し、
// Meetily 本体の生データ（transcripts）を変更せずに
// overlay として編集・コメント・ハイライトを管理する。
// =============================================================================

/// 録音セッションを表す overlay 用モデル。
/// リアルタイム録音中は `meeting_id` が None のまま segments を蓄積し、
/// `api_save_transcript` 完了後に `meeting_id` を紐付ける。
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ExternalRecordingSession {
    /// セッションを一意に識別する ID（例: `ext-session-<uuid>`）
    pub id: String,
    /// 紐づく meetings.id（録音中は None、保存完了後にセット）
    pub meeting_id: Option<String>,
    /// ユーザーに表示するタイトル（録音中は仮タイトル）
    pub meeting_title: Option<String>,
    /// 録音開始時刻（ISO8601）
    pub started_at: String,
    /// 録音停止時刻（ISO8601）。録音中は None
    pub stopped_at: Option<String>,
    /// api_save_transcript で meetings/transcripts が確定した時刻
    pub finalized_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// TranscriptUpdate をそのまま保存する overlay セグメントモデル。
/// 既存 `transcripts` テーブルには `sequence_id` / `is_partial` / `confidence` /
/// `source` がそのままの形で入らないため、External Web UI が扱う粒度として
/// 別テーブルに保持する。revisions / comments / highlights はこの id をアンカーにする。
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ExternalTranscriptSegment {
    pub id: String,
    /// 所属する録音セッション ID
    pub session_id: String,
    /// 保存後に確定する meetings.id（録音中は None）
    pub meeting_id: Option<String>,
    /// 保存後に確定する transcripts.id（生データとの対応関係用）
    pub source_transcript_id: Option<String>,
    /// TranscriptUpdate.sequence_id（単調増加、upsert 用の一意キー）
    pub sequence_id: i64,
    /// 文字起こしテキスト本体（生データ。編集後テキストは revisions に置く）
    pub raw_text: String,
    /// 表示用タイムスタンプ（例: `14:30:05`）
    pub timestamp: String,
    /// "microphone" / "system" 等の音源種別
    pub source: Option<String>,
    /// partial(途中結果) か finalized(確定) か。SQLite では INTEGER 0/1
    pub is_partial: bool,
    /// Whisper の confidence（0.0〜1.0）
    pub confidence: Option<f64>,
    /// 録音開始からの相対秒数
    pub audio_start_time: Option<f64>,
    pub audio_end_time: Option<f64>,
    pub duration: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
}

/// セグメントに対する「編集後テキスト」のバージョン履歴モデル。
/// 生データ (raw_text) は変更せず、編集はすべてここに積む。
/// `is_active = true` が「現在表示すべき編集後テキスト」を表す。
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ExternalTranscriptRevision {
    pub id: String,
    /// 対象セグメントの ID
    pub external_segment_id: String,
    /// 編集後テキスト本体
    pub edited_text: String,
    /// 編集者名（匿名運用もあり得るため Option）
    pub editor_name: Option<String>,
    /// バージョン番号（同一セグメントに対して単調増加）
    pub version: i64,
    /// 現在採用されている版かどうか（同一 segment 内で 1 行だけ true）
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// セグメントに紐づくコメントモデル。
/// `anchor_start` / `anchor_end` を指定するとインラインコメント、
/// 両方 None ならセグメント全体に対するコメントとして扱う。
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ExternalTranscriptComment {
    pub id: String,
    /// 対象セグメントの ID
    pub external_segment_id: String,
    /// コメント本文
    pub comment_text: String,
    /// 投稿者名（Option）
    pub author_name: Option<String>,
    /// テキスト内の文字インデックス開始位置（半開区間 [start, end)）
    pub anchor_start: Option<i64>,
    /// テキスト内の文字インデックス終了位置
    pub anchor_end: Option<i64>,
    /// anchor の基準となった revision（raw_text 基準なら None）
    pub anchor_revision_id: Option<String>,
    /// 解決済み時刻（None なら未解決）
    pub resolved_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// セグメント間に挿入されるセクション区切りモデル。
/// `before_sequence_id` でセグメントの直前に位置づけられる。
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ExternalTranscriptSection {
    pub id: String,
    /// 所属する録音セッション ID
    pub session_id: String,
    /// 保存後に確定する meetings.id（録音中は None）
    pub meeting_id: Option<String>,
    /// セクションタイトル
    pub title: String,
    /// セクションの説明文
    pub description: String,
    /// このセクションが挿入される位置（直後のセグメントの sequence_id）
    pub before_sequence_id: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Collaborative NOTES document for one External Web UI session.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ExternalSessionNote {
    pub session_id: String,
    pub meeting_id: Option<String>,
    pub content: String,
    pub content_json: Option<String>,
    pub updated_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ExternalWebSettings {
    pub id: String,
    pub notes_ai_enabled: i64,
    pub ollama_endpoint: String,
    pub ollama_model: String,
    pub created_at: String,
    pub updated_at: String,
}

/// セグメント上の文字範囲ハイライト（マーカー）モデル。
/// `anchor_start` / `anchor_end` が None ならセグメント全体ハイライト。
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ExternalTranscriptHighlight {
    pub id: String,
    /// 対象セグメントの ID
    pub external_segment_id: String,
    /// ハイライト色（UI 側のパレットキー or hex 文字列）
    pub color: String,
    /// 任意のメモ
    pub note: Option<String>,
    /// テキスト内の文字インデックス開始位置（半開区間 [start, end)）
    pub anchor_start: Option<i64>,
    /// テキスト内の文字インデックス終了位置
    pub anchor_end: Option<i64>,
    /// anchor の基準となった revision（raw_text 基準なら None）
    pub anchor_revision_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct MeetingModel {
    pub id: String,
    pub title: String,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
    pub folder_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(transparent)]
pub struct DateTimeUtc(pub DateTime<Utc>);

impl From<NaiveDateTime> for DateTimeUtc {
    fn from(naive: NaiveDateTime) -> Self {
        DateTimeUtc(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc))
    }
}

// Renamed from TranscriptSegment to Transcript to match the table name
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Transcript {
    pub id: String,
    pub meeting_id: String,
    pub transcript: String,
    pub timestamp: String,
    pub summary: Option<String>,
    pub action_items: Option<String>,
    pub key_points: Option<String>,
    // Recording-relative timestamps for audio-transcript synchronization
    pub audio_start_time: Option<f64>,
    pub audio_end_time: Option<f64>,
    pub duration: Option<f64>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct SummaryProcess {
    pub meeting_id: String,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub error: Option<String>,
    pub result: Option<String>, // JSON
    pub start_time: Option<chrono::DateTime<chrono::Utc>>,
    pub end_time: Option<chrono::DateTime<chrono::Utc>>,
    pub chunk_count: i64,
    pub processing_time: f64,
    pub metadata: Option<String>, // JSON
    pub result_backup: Option<String>, // Backup of result before regeneration
    pub result_backup_timestamp: Option<chrono::DateTime<chrono::Utc>>, // When backup was created
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct TranscriptChunk {
    pub meeting_id: String,
    pub meeting_name: Option<String>,
    pub transcript_text: String,
    pub model: String,
    pub model_name: String,
    pub chunk_size: Option<i64>,
    pub overlap: Option<i64>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Setting {
    pub id: String,
    pub provider: String,
    pub model: String,
    #[sqlx(rename = "whisperModel")]
    #[serde(rename = "whisperModel")]
    pub whisper_model: String,
    #[sqlx(rename = "groqApiKey")]
    #[serde(rename = "groqApiKey")]
    pub groq_api_key: Option<String>,
    #[sqlx(rename = "openaiApiKey")]
    #[serde(rename = "openaiApiKey")]
    pub openai_api_key: Option<String>,
    #[sqlx(rename = "anthropicApiKey")]
    #[serde(rename = "anthropicApiKey")]
    pub anthropic_api_key: Option<String>,
    #[sqlx(rename = "ollamaApiKey")]
    #[serde(rename = "ollamaApiKey")]
    pub ollama_api_key: Option<String>,
    #[sqlx(rename = "openRouterApiKey")]
    #[serde(rename = "openRouterApiKey")]
    pub open_router_api_key: Option<String>,
    #[sqlx(rename = "ollamaEndpoint")]
    #[serde(rename = "ollamaEndpoint")]
    pub ollama_endpoint: Option<String>,
    /// Custom OpenAI-compatible endpoint configuration stored as JSON
    #[sqlx(rename = "customOpenAIConfig")]
    #[serde(rename = "customOpenAIConfig")]
    pub custom_openai_config: Option<String>,
}

impl Setting {
    /// Parse the custom OpenAI config from JSON string
    pub fn get_custom_openai_config(&self) -> Option<crate::summary::CustomOpenAIConfig> {
        self.custom_openai_config.as_ref().and_then(|json| {
            serde_json::from_str(json).ok()
        })
    }
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct TranscriptSetting {
    pub id: String,
    pub provider: String,
    pub model: String,
    #[sqlx(rename = "whisperApiKey")]
    #[serde(rename = "whisperApiKey")]
    pub whisper_api_key: Option<String>,
    #[sqlx(rename = "deepgramApiKey")]
    #[serde(rename = "deepgramApiKey")]
    pub deepgram_api_key: Option<String>,
    #[sqlx(rename = "elevenLabsApiKey")]
    #[serde(rename = "elevenLabsApiKey")]
    pub eleven_labs_api_key: Option<String>,
    #[sqlx(rename = "groqApiKey")]
    #[serde(rename = "groqApiKey")]
    pub groq_api_key: Option<String>,
    #[sqlx(rename = "openaiApiKey")]
    #[serde(rename = "openaiApiKey")]
    pub openai_api_key: Option<String>,
}
