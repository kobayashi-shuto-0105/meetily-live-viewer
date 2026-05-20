// =============================================================================
// External Web UI 型定義
// =============================================================================
// Rust 側の ExternalWebEvent（types.rs）と対応する TypeScript 型を定義する。
// サーバーから受信する WebSocket イベントおよび REST API レスポンスの型。
//
// 命名規則:
//   - WebSocket イベント: ExternalWebEvent（tagged union、type フィールドで判別）
//   - REST API レスポンス: snake_case（Rust の DB モデルそのまま）
//   - REST API リクエスト: camelCase（フロントエンド親和性優先）
// =============================================================================

// =============================================================================
// WebSocket イベント型（Rust ExternalWebEvent に対応）
// =============================================================================

/**
 * サーバーから WebSocket 経由で配信される全イベントの型。
 * JSON の `type` フィールドでイベント種別を判別する。
 *
 * Rust 側の `#[serde(tag = "type", content = "payload")]` に対応。
 */
export type ExternalWebEvent =
  | { type: "RecordingStarted"; payload: RecordingStartedPayload }
  | { type: "RecordingStopped"; payload: RecordingStoppedPayload }
  | { type: "MeetingPersisted"; payload: MeetingPersistedPayload }
  | { type: "TranscriptSegmentUpserted"; payload: TranscriptSegmentPayload }
  | { type: "TranscriptRevisionCreated"; payload: TranscriptRevisionPayload }
  | { type: "TranscriptCommentCreated"; payload: TranscriptCommentPayload }
  | { type: "TranscriptHighlightCreated"; payload: TranscriptHighlightPayload }
  | { type: "TranscriptHighlightDeleted"; payload: TranscriptHighlightDeletedPayload }
  | { type: "TranscriptSectionCreated"; payload: TranscriptSectionPayload }
  | { type: "TranscriptSectionUpdated"; payload: TranscriptSectionPayload }
  | { type: "TranscriptSectionDeleted"; payload: TranscriptSectionDeletedPayload };

// =============================================================================
// イベントペイロード型
// =============================================================================

/** 録音開始イベントのペイロード */
export interface RecordingStartedPayload {
  /** 新規作成された録音セッション ID */
  session_id: string;
  /** ユーザーが設定した会議タイトル（未設定の場合 null） */
  meeting_title: string | null;
  /** 録音開始時刻（ISO8601 形式） */
  started_at: string;
}

/** 録音停止イベントのペイロード */
export interface RecordingStoppedPayload {
  /** 停止された録音セッション ID */
  session_id: string;
  /** 録音停止時刻（ISO8601 形式） */
  stopped_at: string;
}

/** 会議保存完了イベントのペイロード */
export interface MeetingPersistedPayload {
  /** 紐付けられた録音セッション ID */
  session_id: string;
  /** 確定した meetings.id */
  meeting_id: string;
}

/**
 * 文字起こしセグメントの追加/更新イベントのペイロード。
 * is_partial=true の途中結果は同一 sequence_id で上書きされる（upsert）。
 */
export interface TranscriptSegmentPayload {
  /** external_transcript_segments.id */
  id: string;
  /** 所属する録音セッション ID */
  session_id: string;
  /** 保存完了後に確定する meetings.id（録音中は null） */
  meeting_id: string | null;
  /** TranscriptUpdate.sequence_id（単調増加） */
  sequence_id: number;
  /** Whisper が出力した生テキスト */
  raw_text: string;
  /** 表示用テキスト（active revision があればそのテキスト、なければ raw_text） */
  display_text: string;
  /** 表示用タイムスタンプ（例: "14:30:05"） */
  timestamp: string;
  /** 音源種別（"microphone" / "system" 等） */
  source: string;
  /** 途中結果(true) か確定結果(false) か */
  is_partial: boolean;
  /** Whisper の信頼度スコア（0.0〜1.0） */
  confidence: number;
  /** 録音開始からの相対秒数（開始位置） */
  audio_start_time: number;
  /** 録音開始からの相対秒数（終了位置） */
  audio_end_time: number;
  /** セグメントの長さ（秒） */
  duration: number;
}

/** 文字起こし修正イベントのペイロード */
export interface TranscriptRevisionPayload {
  /** external_transcript_revisions.id */
  id: string;
  /** 対象セグメントの ID */
  external_segment_id: string;
  /** 編集後テキスト */
  edited_text: string;
  /** バージョン番号（同一セグメント内で単調増加） */
  version: number;
}

/** コメント追加イベントのペイロード */
export interface TranscriptCommentPayload {
  /** external_transcript_comments.id */
  id: string;
  /** 対象セグメントの ID */
  external_segment_id: string;
  /** コメント本文 */
  comment_text: string;
  /** 投稿者名 */
  author_name: string | null;
  /** テキスト内の文字インデックス開始位置（半開区間 [start, end)） */
  anchor_start: number | null;
  /** テキスト内の文字インデックス終了位置 */
  anchor_end: number | null;
  /** anchor の基準となった revision（raw_text 基準なら null） */
  anchor_revision_id: string | null;
  /** 作成時刻（REST 復元時のみ存在する場合がある） */
  created_at?: string;
}

/**
 * ハイライト削除イベントのペイロード。
 * 該当 ID のハイライトを UI 側のセグメントから取り除く。
 */
export interface TranscriptHighlightDeletedPayload {
  /** 削除された external_transcript_highlights.id */
  id: string;
  /** 対象セグメントの ID */
  external_segment_id: string;
}

/** ハイライト追加イベントのペイロード */
export interface TranscriptHighlightPayload {
  /** external_transcript_highlights.id */
  id: string;
  /** 対象セグメントの ID */
  external_segment_id: string;
  /** ハイライト色（UI パレットキー or hex 文字列） */
  color: string;
  /** 任意のメモ */
  note: string | null;
  /** テキスト内の文字インデックス開始位置（半開区間 [start, end)） */
  anchor_start: number | null;
  /** テキスト内の文字インデックス終了位置 */
  anchor_end: number | null;
  /** anchor の基準となった revision（raw_text 基準なら null） */
  anchor_revision_id: string | null;
}

// =============================================================================
// REST API リクエスト型
// =============================================================================

/** POST /api/segments/:id/revisions のリクエストボディ */
export interface CreateRevisionRequest {
  /** 編集後テキスト */
  editedText: string;
}

/** POST /api/segments/:id/comments のリクエストボディ */
export interface CreateCommentRequest {
  /** コメント本文 */
  commentText: string;
  /** 投稿者名（省略可能） */
  authorName?: string;
  /** テキスト内のアンカー開始位置（省略可能） */
  anchorStart?: number;
  /** テキスト内のアンカー終了位置（省略可能） */
  anchorEnd?: number;
  /** アンカーの基準 revision ID（省略可能） */
  anchorRevisionId?: string;
}

/** POST /api/segments/:id/highlights のリクエストボディ */
export interface CreateHighlightRequest {
  /** ハイライト色 */
  color: string;
  /** メモ（省略可能） */
  note?: string;
  /** テキスト内のアンカー開始位置（省略可能） */
  anchorStart?: number;
  /** テキスト内のアンカー終了位置（省略可能） */
  anchorEnd?: number;
  /** アンカーの基準 revision ID（省略可能） */
  anchorRevisionId?: string;
}

// =============================================================================
// REST API レスポンス型（snake_case: DB モデルそのまま）
// =============================================================================

/**
 * GET /api/sessions/:id/transcripts のレスポンス内セグメント。
 * REST API レスポンスは snake_case で返却される。
 */
export interface TranscriptSegmentResponse {
  id: string;
  session_id: string;
  meeting_id: string | null;
  sequence_id: number;
  raw_text: string;
  display_text: string;
  timestamp: string;
  source: string | null;
  is_partial: boolean;
  confidence: number | null;
  audio_start_time: number | null;
  audio_end_time: number | null;
  duration: number | null;
  /** セグメントに紐づく修正履歴 */
  revisions: TranscriptRevisionResponse[];
  /** セグメントに紐づくコメント */
  comments: TranscriptCommentResponse[];
  /** セグメントに紐づくハイライト */
  highlights: TranscriptHighlightResponse[];
}

/** 修正履歴レスポンス */
export interface TranscriptRevisionResponse {
  id: string;
  external_segment_id: string;
  edited_text: string;
  version: number;
  is_active: boolean;
  created_at: string;
}

/** コメントレスポンス */
export interface TranscriptCommentResponse {
  id: string;
  external_segment_id: string;
  comment_text: string;
  author_name: string | null;
  anchor_start: number | null;
  anchor_end: number | null;
  anchor_revision_id: string | null;
  created_at: string;
}

/** ハイライトレスポンス */
export interface TranscriptHighlightResponse {
  id: string;
  external_segment_id: string;
  color: string;
  note: string | null;
  anchor_start: number | null;
  anchor_end: number | null;
  anchor_revision_id: string | null;
  created_at: string;
}

// =============================================================================
// UI 内部で使用する拡張型
// =============================================================================

/**
 * UI の状態管理で使用するセグメント型。
 * WebSocket イベントと REST レスポンスの両方から構築される。
 */
export interface TranscriptSegmentView {
  id: string;
  sessionId: string;
  meetingId: string | null;
  sequenceId: number;
  rawText: string;
  displayText: string;
  timestamp: string;
  source: string;
  isPartial: boolean;
  confidence: number;
  audioStartTime: number;
  audioEndTime: number;
  duration: number;
  /** セグメントに紐づく修正履歴（UI 表示用） */
  revisions: TranscriptRevisionPayload[];
  /** セグメントに紐づくコメント（UI 表示用） */
  comments: TranscriptCommentPayload[];
  /** セグメントに紐づくハイライト（UI 表示用） */
  highlights: TranscriptHighlightPayload[];
}

// =============================================================================
// セクション区切り型
// =============================================================================

/** セクション区切りの型定義（セグメント間に挿入される区切り） */
export interface Section {
  /** 一意の ID（UUID v4） */
  id: string;
  /** セクションタイトル（例: "Discussion", "Opening"） */
  title: string;
  /** セクションの説明（説明なし時は空文字列） */
  description: string;
  /** このセクションが挿入される位置（直後のセグメントの sequenceId） */
  beforeSequenceId: number;
  /** 作成日時（ISO8601 形式） */
  createdAt: string;
}

/** WebSocket セクション作成/更新イベントのペイロード（snake_case: サーバーから受信） */
export interface TranscriptSectionPayload {
  id: string;
  session_id: string;
  meeting_id: string | null;
  title: string;
  description: string;
  before_sequence_id: number;
  created_at: string;
}

/** WebSocket セクション削除イベントのペイロード */
export interface TranscriptSectionDeletedPayload {
  id: string;
  session_id: string;
}

/** POST /api/sessions/:id/sections のリクエストボディ */
export interface CreateSectionRequest {
  title: string;
  description?: string;
  beforeSequenceId: number;
}

/** PUT /api/sections/:id のリクエストボディ */
export interface UpdateSectionRequest {
  title: string;
  description?: string;
}

/** セクション REST API レスポンス（snake_case） */
export interface SectionResponse {
  id: string;
  session_id: string;
  meeting_id: string | null;
  title: string;
  description: string;
  before_sequence_id: number;
  created_at: string;
}

// =============================================================================
// セッション履歴
// =============================================================================

/** GET /api/sessions/history のレスポンス内セッション */
export interface SessionHistoryItem {
  session_id: string;
  meeting_id: string | null;
  meeting_title: string | null;
  started_at: string;
  stopped_at: string | null;
  finalized_at: string | null;
}

/** GET /api/sessions/history のレスポンス */
export interface SessionHistoryResponse {
  sessions: SessionHistoryItem[];
  limit: number;
  offset: number;
}

// =============================================================================
// 接続状態
// =============================================================================

/** WebSocket の接続状態 */
export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

/** 録音セッションの状態 */
export interface SessionInfo {
  /** 現在の録音セッション ID */
  sessionId: string;
  /** 会議タイトル */
  meetingTitle: string | null;
  /** 録音開始時刻 */
  startedAt: string;
  /** 録音が停止済みかどうか */
  isStopped: boolean;
  /** 保存済み meeting_id（finalize 後に設定される） */
  meetingId: string | null;
}
