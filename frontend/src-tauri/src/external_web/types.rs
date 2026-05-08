// =============================================================================
// External Web UI イベント型定義
// =============================================================================
// WebSocket で外部ブラウザへ配信するイベントの型を定義する。
// プラン §8.5 に基づき、tagged enum (`#[serde(tag = "type", content = "payload")]`)
// で JSON シリアライズし、クライアント側で `event.type` で分岐できるようにする。
//
// 設計方針:
//   - 各 payload は必要最小限のフィールドのみ含む
//   - `display_text` は service 層で raw_text or active revision から決定する
//   - f64 精度は既存 TranscriptUpdate と合わせる（プラン §0.1）
// =============================================================================

use serde::{Deserialize, Serialize};

// =============================================================================
// メインイベント列挙型
// =============================================================================

/// External Web UI に配信される全イベントの統合型。
/// JSON では `{ "type": "RecordingStarted", "payload": { ... } }` の形になる。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ExternalWebEvent {
    /// 録音が開始されたことを通知する
    RecordingStarted(RecordingStartedPayload),
    /// 録音が停止されたことを通知する
    RecordingStopped(RecordingStoppedPayload),
    /// api_save_transcript 完了後、meeting_id が確定したことを通知する
    MeetingPersisted(MeetingPersistedPayload),
    /// 文字起こしセグメントが追加/更新されたことを通知する
    TranscriptSegmentUpserted(TranscriptSegmentPayload),
    /// 文字起こし修正(revision)が作成されたことを通知する
    TranscriptRevisionCreated(TranscriptRevisionPayload),
    /// コメントが追加されたことを通知する
    TranscriptCommentCreated(TranscriptCommentPayload),
    /// ハイライトが追加されたことを通知する
    TranscriptHighlightCreated(TranscriptHighlightPayload),
}

// =============================================================================
// 各イベントのペイロード定義
// =============================================================================

/// 録音開始イベントのペイロード。
/// 録音開始時に session_id が払い出され、以降のセグメントはこの session に紐づく。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingStartedPayload {
    /// 新規作成された録音セッション ID
    pub session_id: String,
    /// ユーザーが設定した会議タイトル（未設定の場合 None）
    pub meeting_title: Option<String>,
    /// 録音開始時刻（ISO8601 形式）
    pub started_at: String,
}

/// 録音停止イベントのペイロード。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingStoppedPayload {
    /// 停止された録音セッション ID
    pub session_id: String,
    /// 録音停止時刻（ISO8601 形式）
    pub stopped_at: String,
}

/// 会議保存完了イベントのペイロード。
/// api_save_transcript が成功し、external session と meetings テーブルが紐付いた。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingPersistedPayload {
    /// 紐付けられた録音セッション ID
    pub session_id: String,
    /// 確定した meetings.id
    pub meeting_id: String,
}

/// 文字起こしセグメントの追加/更新イベントのペイロード。
/// is_partial=true の途中結果は同一 sequence_id で上書きされる（upsert）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegmentPayload {
    /// external_transcript_segments.id
    pub id: String,
    /// 所属する録音セッション ID
    pub session_id: String,
    /// 保存完了後に確定する meetings.id（録音中は None）
    pub meeting_id: Option<String>,
    /// TranscriptUpdate.sequence_id（単調増加）
    pub sequence_id: u64,
    /// Whisper が出力した生テキスト
    pub raw_text: String,
    /// 表示用テキスト（active revision があればそのテキスト、なければ raw_text）
    pub display_text: String,
    /// 表示用タイムスタンプ（例: "14:30:05"）
    pub timestamp: String,
    /// 音源種別（"microphone" / "system" 等）
    pub source: String,
    /// 途中結果(true) か確定結果(false) か
    pub is_partial: bool,
    /// Whisper の信頼度スコア（0.0〜1.0）
    pub confidence: f64,
    /// 録音開始からの相対秒数（開始位置）
    pub audio_start_time: f64,
    /// 録音開始からの相対秒数（終了位置）
    pub audio_end_time: f64,
    /// セグメントの長さ（秒）
    pub duration: f64,
}

/// 文字起こし修正イベントのペイロード。
/// 新しい revision が作成されると、旧 active revision は is_active=false になる。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptRevisionPayload {
    /// external_transcript_revisions.id
    pub id: String,
    /// 対象セグメントの ID
    pub external_segment_id: String,
    /// 編集後テキスト
    pub edited_text: String,
    /// バージョン番号（同一セグメント内で単調増加）
    pub version: i64,
}

/// コメント追加イベントのペイロード。
/// anchor_start/end が None ならセグメント全体に対するコメント。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptCommentPayload {
    /// external_transcript_comments.id
    pub id: String,
    /// 対象セグメントの ID
    pub external_segment_id: String,
    /// コメント本文
    pub comment_text: String,
    /// 投稿者名
    pub author_name: Option<String>,
    /// テキスト内の文字インデックス開始位置（半開区間 [start, end)）
    pub anchor_start: Option<i64>,
    /// テキスト内の文字インデックス終了位置
    pub anchor_end: Option<i64>,
    /// anchor の基準となった revision（raw_text 基準なら None）
    pub anchor_revision_id: Option<String>,
}

/// ハイライト追加イベントのペイロード。
/// anchor_start/end が None ならセグメント全体のハイライト。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptHighlightPayload {
    /// external_transcript_highlights.id
    pub id: String,
    /// 対象セグメントの ID
    pub external_segment_id: String,
    /// ハイライト色（UI パレットキー or hex 文字列）
    pub color: String,
    /// 任意のメモ
    pub note: Option<String>,
    /// テキスト内の文字インデックス開始位置（半開区間 [start, end)）
    pub anchor_start: Option<i64>,
    /// テキスト内の文字インデックス終了位置
    pub anchor_end: Option<i64>,
    /// anchor の基準となった revision（raw_text 基準なら None）
    pub anchor_revision_id: Option<String>,
}
