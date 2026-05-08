// =============================================================================
// External Web UI サービス層
// =============================================================================
// 録音セッションのライフサイクル管理と、リアルタイム文字起こしの外部配信を担う。
// repository 層（DB 操作）と state 層（broadcast チャネル）を橋渡しする。
//
// 責務（プラン §11）:
//   - 録音開始時: セッション作成 → state に登録 → RecordingStarted broadcast
//   - 文字起こし受信時: セグメント upsert → TranscriptSegmentUpserted broadcast
//   - 録音停止時: セッション停止 → state クリア → RecordingStopped broadcast
//   - 保存完了時: meeting_id 紐付け → MeetingPersisted broadcast
//
// 呼び出し元:
//   - recording_commands.rs（録音開始/停止/文字起こし受信）→ 後続 PR で接続
//   - api.rs（api_save_transcript 完了後）→ 後続 PR で接続
//
// DB アクセス:
//   AppState.db_manager.pool() 経由で SQLite pool を取得する（プラン §0.3）。
//   初回起動時に AppState が未初期化の場合は try_state で安全にスキップする。
// =============================================================================

use sqlx::SqlitePool;

use crate::audio::transcription::worker::TranscriptUpdate;
use crate::database::repositories::external_web::ExternalWebRepository;

use super::state::{CurrentSession, ExternalWebState};
use super::types::{
    ExternalWebEvent, MeetingPersistedPayload, RecordingStartedPayload, RecordingStoppedPayload,
    TranscriptSegmentPayload,
};

// =============================================================================
// 録音セッション開始
// =============================================================================

/// 新しい External Web UI 録音セッションを開始する。
///
/// 以下の処理を順に実行する:
///   1. DB に新しい `external_recording_sessions` レコードを作成する
///   2. `ExternalWebState.current_session` にセッション情報をセットする
///   3. WebSocket 経由で `RecordingStarted` イベントを全クライアントに broadcast する
///
/// # 引数
/// - `pool`: SQLite コネクションプール
/// - `external_state`: External Web UI の共有ステート
/// - `meeting_title`: ユーザーが設定した会議タイトル（省略可能）
///
/// # エラー
/// DB へのセッション作成が失敗した場合にエラーを返す。
pub async fn start_external_session(
    pool: &SqlitePool,
    external_state: &ExternalWebState,
    meeting_title: Option<String>,
) -> anyhow::Result<()> {
    // 1. DB にセッションレコードを作成する
    let session = ExternalWebRepository::create_session(
        pool,
        meeting_title.as_deref(),
    )
    .await?;

    log::info!(
        "External Web UI: session started (id={})",
        session.id
    );

    // 2. メモリ上のステートに現在のセッション情報をセットする
    //    後続の handle_transcript_update で参照するために必要
    {
        let mut current = external_state.current_session.write().await;
        *current = Some(CurrentSession {
            id: session.id.clone(),
            meeting_title: session.meeting_title.clone(),
            started_at: session.started_at.clone(),
        });
    }

    // 3. WebSocket クライアントに録音開始を通知する
    external_state.publish(ExternalWebEvent::RecordingStarted(
        RecordingStartedPayload {
            session_id: session.id,
            meeting_title: session.meeting_title,
            started_at: session.started_at,
        },
    ));

    Ok(())
}

// =============================================================================
// 文字起こし転送
// =============================================================================

/// Whisper からの文字起こし結果を External Web UI に転送する。
///
/// 以下の処理を順に実行する:
///   1. 現在のセッションが存在するか確認する（なければスキップ）
///   2. DB にセグメントを upsert する（partial → final の上書きに対応）
///   3. active revision があれば display_text にその edited_text を使う
///   4. WebSocket 経由で `TranscriptSegmentUpserted` イベントを broadcast する
///
/// # 引数
/// - `pool`: SQLite コネクションプール
/// - `external_state`: External Web UI の共有ステート
/// - `update`: Whisper からの文字起こし結果
///
/// # エラー
/// DB への upsert が失敗した場合にエラーを返す。
pub async fn handle_transcript_update(
    pool: &SqlitePool,
    external_state: &ExternalWebState,
    update: &TranscriptUpdate,
) -> anyhow::Result<()> {
    // 1. 現在のセッションを取得する。録音中でなければ何もしない
    let session = {
        let current = external_state.current_session.read().await;
        match current.as_ref() {
            Some(s) => s.clone(),
            None => {
                // セッションがない = 録音中でない → External Web UI への転送は不要
                return Ok(());
            }
        }
    };

    // 2. DB にセグメントを upsert する
    //    is_partial=true の途中結果は同一 (session_id, sequence_id) で上書きされる（§0.6）
    let segment = ExternalWebRepository::upsert_segment(
        pool,
        &session.id,
        update.sequence_id as i64,
        &update.text,
        &update.timestamp,
        Some(update.source.as_str()),
        update.is_partial,
        Some(update.confidence as f64),
        Some(update.audio_start_time),
        Some(update.audio_end_time),
        Some(update.duration),
    )
    .await?;

    // 3. active revision を確認して display_text を決定する
    //    revision がある場合: edited_text を表示テキストとする
    //    revision がない場合: raw_text をそのまま表示テキストとする
    let display_text = match ExternalWebRepository::get_active_revision(pool, &segment.id).await {
        Ok(revision) => revision.edited_text,
        Err(_) => segment.raw_text.clone(),
    };

    // 4. WebSocket クライアントにセグメント更新を通知する
    external_state.publish(ExternalWebEvent::TranscriptSegmentUpserted(
        TranscriptSegmentPayload {
            id: segment.id,
            session_id: session.id,
            meeting_id: segment.meeting_id,
            sequence_id: update.sequence_id,
            raw_text: segment.raw_text,
            display_text,
            timestamp: update.timestamp.clone(),
            source: update.source.clone(),
            is_partial: update.is_partial,
            confidence: update.confidence,
            audio_start_time: update.audio_start_time,
            audio_end_time: update.audio_end_time,
            duration: update.duration,
        },
    ));

    Ok(())
}

// =============================================================================
// 録音セッション停止
// =============================================================================

/// 現在の録音セッションを停止する。
///
/// 以下の処理を順に実行する:
///   1. 現在のセッションが存在するか確認する（なければスキップ）
///   2. DB の `stopped_at` を更新する
///   3. `ExternalWebState.current_session` を None にリセットする
///   4. WebSocket 経由で `RecordingStopped` イベントを broadcast する
///
/// # 引数
/// - `pool`: SQLite コネクションプール
/// - `external_state`: External Web UI の共有ステート
///
/// # エラー
/// DB のセッション更新が失敗した場合にエラーを返す。
pub async fn stop_external_session(
    pool: &SqlitePool,
    external_state: &ExternalWebState,
) -> anyhow::Result<()> {
    // 1. 現在のセッションを取得する。セッションがなければ何もしない
    let session_id = {
        let current = external_state.current_session.read().await;
        match current.as_ref() {
            Some(s) => s.id.clone(),
            None => {
                log::warn!("External Web UI: stop requested but no active session");
                return Ok(());
            }
        }
    };

    // 2. DB のセッション停止時刻を記録する
    ExternalWebRepository::stop_session(pool, &session_id).await?;

    log::info!(
        "External Web UI: session stopped (id={})",
        session_id
    );

    // 3. メモリ上のセッション情報をクリアする
    {
        let mut current = external_state.current_session.write().await;
        *current = None;
    }

    // 4. WebSocket クライアントに録音停止を通知する
    let stopped_at = chrono::Utc::now().to_rfc3339();
    external_state.publish(ExternalWebEvent::RecordingStopped(
        RecordingStoppedPayload {
            session_id,
            stopped_at,
        },
    ));

    Ok(())
}

// =============================================================================
// セッション確定（meeting_id 紐付け）
// =============================================================================

/// 録音セッションを meeting に紐付ける（finalize）。
///
/// `api_save_transcript` が成功した後に呼び出される。
/// 以下の処理を順に実行する:
///   1. DB のセッションと全セグメントに `meeting_id` をセットする
///   2. WebSocket 経由で `MeetingPersisted` イベントを broadcast する
///
/// # 引数
/// - `pool`: SQLite コネクションプール
/// - `external_state`: External Web UI の共有ステート
/// - `session_id`: 紐付ける録音セッション ID
/// - `meeting_id`: 確定した meetings.id
///
/// # エラー
/// DB の更新が失敗した場合にエラーを返す。
pub async fn finalize_external_session(
    pool: &SqlitePool,
    external_state: &ExternalWebState,
    session_id: &str,
    meeting_id: &str,
) -> anyhow::Result<()> {
    // 1. DB のセッションと全セグメントに meeting_id を紐付ける
    //    トランザクション内で原子的に更新される（repository 側で保証）
    ExternalWebRepository::finalize_session(pool, session_id, meeting_id).await?;

    log::info!(
        "External Web UI: session finalized (session_id={}, meeting_id={})",
        session_id,
        meeting_id
    );

    // 2. WebSocket クライアントに meeting 確定を通知する
    //    クライアントはこのイベントを受けて session_id ベースの表示から
    //    meeting_id ベースの表示に切り替える
    external_state.publish(ExternalWebEvent::MeetingPersisted(
        MeetingPersistedPayload {
            session_id: session_id.to_string(),
            meeting_id: meeting_id.to_string(),
        },
    ));

    Ok(())
}
