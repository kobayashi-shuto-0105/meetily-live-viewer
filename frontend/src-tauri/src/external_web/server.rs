// =============================================================================
// External Web UI HTTP/WebSocket サーバー
// =============================================================================
// axum ベースの HTTP/WebSocket サーバーを提供する。
// Tauri アプリの setup 内で `tokio::spawn` により非同期に起動される。
//
// エンドポイント一覧（プラン §8.6）:
//   GET  /health                                - 疎通確認（認証不要）
//   WS   /ws?token=xxx                          - リアルタイム WebSocket 購読
//   GET  /api/sessions/current?token=xxx        - 現在の録音セッション取得
//   GET  /api/sessions/{id}/transcripts?token=xxx - セッション内セグメント取得
//   GET  /api/meetings/{id}/transcripts?token=xxx - 保存済み会議の文字起こし取得
//   POST /api/segments/{id}/revisions?token=xxx  - 文字起こし修正
//   POST /api/segments/{id}/comments?token=xxx   - コメント追加
//   POST /api/segments/{id}/highlights?token=xxx - ハイライト追加
//
// 認証方式（プラン §8.7）:
//   クエリパラメータ `?token=xxx` でトークン認証する。
//   WebSocket はブラウザから任意ヘッダーを付けづらいため、クエリパラメータを採用。
//   トークンは環境変数 `MEETILY_EXT_TOKEN` で設定する（未設定時は "dev-token"）。
//
// バインドアドレス:
//   デフォルト: 127.0.0.1:38391（ローカルのみ）
//   環境変数 `MEETILY_EXT_BIND` で変更可能（例: "0.0.0.0:38391" で LAN 公開）
//   0.0.0.0 にバインドする場合はトークン必須を強制する（プラン §0.2）
// =============================================================================

use std::collections::HashMap;
use std::net::SocketAddr;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::StatusCode,
    middleware::{self, Next},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use sqlx::SqlitePool;
use tower_http::cors::CorsLayer;

use crate::database::repositories::external_web::ExternalWebRepository;

use super::state::ExternalWebState;
use super::types::{
    ExternalWebEvent, TranscriptCommentPayload, TranscriptHighlightDeletedPayload,
    TranscriptHighlightPayload, TranscriptRevisionPayload, TranscriptSectionDeletedPayload,
    TranscriptSectionPayload,
};

// =============================================================================
// サーバー共有ステート
// =============================================================================

/// axum ルーター全体で共有するステート。
/// `ExternalWebState`（broadcast チャネル + セッション情報）、認証トークン、
/// および DB コネクションプールを保持する。
#[derive(Clone)]
pub struct ServerState {
    /// External Web UI の broadcast チャネルとセッション管理
    pub external_state: ExternalWebState,
    /// API アクセス用の認証トークン
    pub token: String,
    /// SQLite コネクションプール（REST API の DB 操作に使用する）
    pub pool: SqlitePool,
}

// =============================================================================
// サーバー起動
// =============================================================================

/// External Web UI サーバーを起動する。
/// `lib.rs` の setup 内から `tokio::spawn` で呼び出される。
///
/// # 引数
/// - `external_state`: WebSocket broadcast チャネルと現在のセッション情報
/// - `pool`: SQLite コネクションプール（REST API の DB 操作に使用する）
///
/// # エラー
/// バインドアドレスのパースや TCP リスナーの作成に失敗した場合にエラーを返す。
pub async fn run(external_state: ExternalWebState, pool: SqlitePool) -> anyhow::Result<()> {
    // 認証トークンを環境変数から取得する（ローカル開発のみ未設定時はデフォルト値）
    let token_from_env = std::env::var("MEETILY_EXT_TOKEN").ok();

    // バインドアドレスを環境変数から取得する（デフォルトはローカルのみ）
    let bind = std::env::var("MEETILY_EXT_BIND").unwrap_or_else(|_| "127.0.0.1:38391".to_string());

    let addr: SocketAddr = bind.parse()?;

    let token = match token_from_env {
        Some(token) if !token.is_empty() => token,
        Some(_) if addr.ip().is_unspecified() => {
            anyhow::bail!(
                "MEETILY_EXT_TOKEN must be non-empty when binding to 0.0.0.0 (LAN/public access)"
            );
        }
        None if addr.ip().is_unspecified() => {
            anyhow::bail!(
                "MEETILY_EXT_TOKEN must be set when binding to 0.0.0.0 (LAN/public access)"
            );
        }
        _ => "dev-token".to_string(),
    };

    let state = ServerState {
        external_state,
        token,
        pool,
    };

    // axum ルーターを構築する
    let router = build_router(state);

    // TCP リスナーを作成してサーバーを起動する
    let listener = tokio::net::TcpListener::bind(addr).await?;
    log::info!("External Web UI server listening on {}", addr);

    axum::serve(listener, router).await?;

    Ok(())
}

// =============================================================================
// ルーター構築
// =============================================================================

/// axum ルーターを構築する。
/// `/health` は認証不要、それ以外のルートはトークン認証ミドルウェアを適用する。
fn build_router(state: ServerState) -> Router {
    // 認証が必要なルート群
    let authenticated_routes = Router::new()
        // WebSocket エンドポイント: リアルタイムイベントを購読する
        .route("/ws", get(ws_handler))
        // 現在の録音セッション情報を取得する
        .route("/api/sessions/current", get(get_current_session))
        // セッション内の全セグメントを取得する（リアルタイム中 or 録音後）
        .route(
            "/api/sessions/{session_id}/transcripts",
            get(get_session_transcripts),
        )
        // 保存済み会議の文字起こし + overlay を取得する
        .route(
            "/api/meetings/{meeting_id}/transcripts",
            get(get_meeting_transcripts),
        )
        // 文字起こし修正（revision）を作成する
        .route("/api/segments/{segment_id}/revisions", post(create_revision))
        // コメントを追加する
        .route("/api/segments/{segment_id}/comments", post(create_comment))
        // ハイライトを追加する
        .route(
            "/api/segments/{segment_id}/highlights",
            post(create_highlight),
        )
        // ハイライトを削除する（同種ハイライトの再付与でトグル取り消しに使う）
        .route(
            "/api/segments/{segment_id}/highlights/{highlight_id}",
            delete(delete_highlight),
        )
        // セッション内の全セクションを取得する
        .route(
            "/api/sessions/{session_id}/sections",
            get(get_session_sections),
        )
        // セクションを新規作成する
        .route(
            "/api/sessions/{session_id}/sections",
            post(create_section),
        )
        // セクションを更新する
        .route("/api/sections/{section_id}", axum::routing::put(update_section))
        // セクションを削除する
        .route("/api/sections/{section_id}", delete(delete_section))
        // トークン認証ミドルウェアを適用する
        .layer(middleware::from_fn_with_state(
            state.clone(),
            token_auth_middleware,
        ));

    Router::new()
        // ヘルスチェックは認証不要（監視ツール等から利用するため）
        .route("/health", get(health))
        // 認証が必要なルートをマージする
        .merge(authenticated_routes)
        // CORS: 開発時は全オリジン許可。LAN 公開時に絞る想定（プラン §8.6）
        .layer(CorsLayer::permissive())
        .with_state(state)
}

// =============================================================================
// 認証ミドルウェア
// =============================================================================

/// クエリパラメータ `?token=xxx` でトークンを検証するミドルウェア。
/// トークンが不一致の場合は 401 Unauthorized を返す。
///
/// WebSocket はブラウザから Authorization ヘッダーを付けられないため、
/// クエリパラメータ方式を採用している（プラン §8.7）。
async fn token_auth_middleware(
    State(state): State<ServerState>,
    Query(params): Query<HashMap<String, String>>,
    request: axum::http::Request<axum::body::Body>,
    next: Next,
) -> Result<impl IntoResponse, StatusCode> {
    // クエリパラメータからトークンを取得する
    let provided_token = params.get("token").cloned().unwrap_or_default();

    // サーバーに設定されたトークンと比較する
    if provided_token != state.token {
        log::warn!("External Web UI: unauthorized access attempt");
        return Err(StatusCode::UNAUTHORIZED);
    }

    // トークンが一致した場合は次のハンドラへ進む
    Ok(next.run(request).await)
}

// =============================================================================
// ヘルスチェック
// =============================================================================

/// ヘルスチェックエンドポイント。
/// 認証不要で、サーバーが稼働中であることを確認するために使う。
async fn health() -> impl IntoResponse {
    "ok"
}

// =============================================================================
// 現在のセッション取得
// =============================================================================

/// 現在アクティブな録音セッションの情報を JSON で返す。
/// 録音中でない場合は `null` を返す。
async fn get_current_session(State(state): State<ServerState>) -> impl IntoResponse {
    // RwLock の読み取りロックを取得してセッション情報を取得する
    let session = state.external_state.current_session.read().await;

    match session.as_ref() {
        Some(s) => {
            // セッション情報を JSON にシリアライズして返す
            let body = serde_json::json!({
                "session_id": s.id,
                "meeting_title": s.meeting_title,
                "started_at": s.started_at,
            });
            (StatusCode::OK, axum::Json(body)).into_response()
        }
        None => {
            // 録音中でない場合は null を返す
            (StatusCode::OK, axum::Json(serde_json::Value::Null)).into_response()
        }
    }
}

// =============================================================================
// セッション内セグメント取得
// =============================================================================

/// 指定セッション ID に属する全セグメントを取得する（プラン §12.1）。
/// リアルタイム録音中でも録音後でも使用可能。
/// 各セグメントには active revision の有無に応じた `display_text` を含む。
async fn get_session_transcripts(
    State(state): State<ServerState>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    // DB からセッションに属する全セグメントを sequence_id 昇順で取得する
    match ExternalWebRepository::get_segments_by_session(&state.pool, &session_id).await {
        Ok(segments) => {
            // 各セグメントに display_text（= active revision or raw_text）を付与して返す
            let mut views = Vec::with_capacity(segments.len());
            for seg in &segments {
                let display_text = resolve_display_text(&state.pool, &seg.id, &seg.raw_text).await;
                // コメントとハイライトも合わせて返す
                let comments = ExternalWebRepository::get_comments_by_segment(&state.pool, &seg.id)
                    .await
                    .unwrap_or_else(|e| {
                        log::warn!(
                            "Failed to load comments for segment {} (returning empty): {}",
                            seg.id,
                            e
                        );
                        vec![]
                    });
                let highlights =
                    ExternalWebRepository::get_highlights_by_segment(&state.pool, &seg.id)
                        .await
                        .unwrap_or_else(|e| {
                            log::warn!(
                                "Failed to load highlights for segment {} (returning empty): {}",
                                seg.id,
                                e
                            );
                            vec![]
                        });

                views.push(serde_json::json!({
                    "id": seg.id,
                    "session_id": seg.session_id,
                    "meeting_id": seg.meeting_id,
                    "sequence_id": seg.sequence_id,
                    "raw_text": seg.raw_text,
                    "display_text": display_text,
                    "timestamp": seg.timestamp,
                    "source": seg.source,
                    "is_partial": seg.is_partial,
                    "confidence": seg.confidence,
                    "audio_start_time": seg.audio_start_time,
                    "audio_end_time": seg.audio_end_time,
                    "duration": seg.duration,
                    "comments": comments,
                    "highlights": highlights,
                }));
            }
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "session_id": session_id,
                    "segments": views,
                    "sections": ExternalWebRepository::get_sections_by_session(&state.pool, &session_id)
                        .await
                        .unwrap_or_else(|e| {
                            log::warn!(
                                "Failed to load sections for session {} (returning empty): {}",
                                session_id,
                                e
                            );
                            vec![]
                        }),
                })),
            )
                .into_response()
        }
        Err(e) => {
            log::error!(
                "External Web UI: failed to get session transcripts (session_id={}): {}",
                session_id,
                e
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Failed to get session transcripts"
                })),
            )
                .into_response()
        }
    }
}

// =============================================================================
// 保存済み会議の文字起こし取得
// =============================================================================

/// 保存済み会議に紐づく全セグメントを取得する（プラン §12.1）。
/// `finalize_session` 完了後に使用する。
/// 各セグメントには display_text / comments / highlights を含む。
async fn get_meeting_transcripts(
    State(state): State<ServerState>,
    Path(meeting_id): Path<String>,
) -> impl IntoResponse {
    // DB から meeting_id に紐づく全セグメントを sequence_id 昇順で取得する
    match ExternalWebRepository::get_segments_by_meeting(&state.pool, &meeting_id).await {
        Ok(segments) => {
            // 各セグメントに display_text + overlay データを付与して返す
            let mut views = Vec::with_capacity(segments.len());
            for seg in &segments {
                let display_text = resolve_display_text(&state.pool, &seg.id, &seg.raw_text).await;
                let comments = ExternalWebRepository::get_comments_by_segment(&state.pool, &seg.id)
                    .await
                    .unwrap_or_else(|e| {
                        log::warn!(
                            "Failed to load comments for segment {} (returning empty): {}",
                            seg.id,
                            e
                        );
                        vec![]
                    });
                let highlights =
                    ExternalWebRepository::get_highlights_by_segment(&state.pool, &seg.id)
                        .await
                        .unwrap_or_else(|e| {
                            log::warn!(
                                "Failed to load highlights for segment {} (returning empty): {}",
                                seg.id,
                                e
                            );
                            vec![]
                        });

                views.push(serde_json::json!({
                    "id": seg.id,
                    "session_id": seg.session_id,
                    "meeting_id": seg.meeting_id,
                    "sequence_id": seg.sequence_id,
                    "raw_text": seg.raw_text,
                    "display_text": display_text,
                    "timestamp": seg.timestamp,
                    "source": seg.source,
                    "is_partial": seg.is_partial,
                    "confidence": seg.confidence,
                    "audio_start_time": seg.audio_start_time,
                    "audio_end_time": seg.audio_end_time,
                    "duration": seg.duration,
                    "comments": comments,
                    "highlights": highlights,
                }));
            }
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "meeting_id": meeting_id,
                    "segments": views,
                })),
            )
                .into_response()
        }
        Err(e) => {
            log::error!(
                "External Web UI: failed to get meeting transcripts (meeting_id={}): {}",
                meeting_id,
                e
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Failed to get meeting transcripts"
                })),
            )
                .into_response()
        }
    }
}

// =============================================================================
// 文字起こし修正（revision）作成
// =============================================================================

/// 文字起こし修正リクエストのボディ。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRevisionRequest {
    /// 修正後のテキスト
    edited_text: String,
    /// 編集者名（任意）
    editor_name: Option<String>,
}

/// セグメントに対する revision（編集後テキスト）を作成する（プラン §12.2）。
/// 既存の active revision は自動的に deactivate される。
/// 作成後、WebSocket で `TranscriptRevisionCreated` をブロードキャストする。
async fn create_revision(
    State(state): State<ServerState>,
    Path(segment_id): Path<String>,
    Json(body): Json<CreateRevisionRequest>,
) -> impl IntoResponse {
    // repository 層で revision を作成する（トランザクション内で is_active 切替を原子的に実行）
    match ExternalWebRepository::create_revision(
        &state.pool,
        &segment_id,
        &body.edited_text,
        body.editor_name.as_deref(),
    )
    .await
    {
        Ok(revision) => {
            // WebSocket 全クライアントに revision 作成を通知する
            state
                .external_state
                .publish(ExternalWebEvent::TranscriptRevisionCreated(
                    TranscriptRevisionPayload {
                        id: revision.id.clone(),
                        external_segment_id: revision.external_segment_id.clone(),
                        edited_text: revision.edited_text.clone(),
                        version: revision.version,
                    },
                ));

            log::info!(
                "External Web UI: revision created (id={}, segment={})",
                revision.id,
                segment_id
            );

            (
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "id": revision.id,
                    "external_segment_id": revision.external_segment_id,
                    "edited_text": revision.edited_text,
                    "editor_name": revision.editor_name,
                    "version": revision.version,
                    "is_active": revision.is_active,
                    "created_at": revision.created_at,
                })),
            )
                .into_response()
        }
        Err(e) => {
            let status = classify_db_error(&e);
            log::error!(
                "External Web UI: failed to create revision (segment_id={}, status={}): {}",
                segment_id,
                status,
                e
            );
            (
                status,
                Json(serde_json::json!({
                    "error": "Failed to create revision"
                })),
            )
                .into_response()
        }
    }
}

// =============================================================================
// コメント追加
// =============================================================================

/// コメント追加リクエストのボディ。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCommentRequest {
    /// コメント本文
    comment_text: String,
    /// 投稿者名（任意）
    author_name: Option<String>,
    /// テキスト内のアンカー開始位置（半開区間 [start, end)）。None ならセグメント全体宛て
    anchor_start: Option<i64>,
    /// テキスト内のアンカー終了位置
    anchor_end: Option<i64>,
    /// anchor の基準となった revision ID（raw_text 基準なら None）
    anchor_revision_id: Option<String>,
}

/// セグメントに対するコメントを追加する（プラン §12.3）。
/// 作成後、WebSocket で `TranscriptCommentCreated` をブロードキャストする。
async fn create_comment(
    State(state): State<ServerState>,
    Path(segment_id): Path<String>,
    Json(body): Json<CreateCommentRequest>,
) -> impl IntoResponse {
    // repository 層でコメントを作成する
    match ExternalWebRepository::create_comment(
        &state.pool,
        &segment_id,
        &body.comment_text,
        body.author_name.as_deref(),
        body.anchor_start,
        body.anchor_end,
        body.anchor_revision_id.as_deref(),
    )
    .await
    {
        Ok(comment) => {
            // WebSocket 全クライアントにコメント追加を通知する
            state
                .external_state
                .publish(ExternalWebEvent::TranscriptCommentCreated(
                    TranscriptCommentPayload {
                        id: comment.id.clone(),
                        external_segment_id: comment.external_segment_id.clone(),
                        comment_text: comment.comment_text.clone(),
                        author_name: comment.author_name.clone(),
                        anchor_start: comment.anchor_start,
                        anchor_end: comment.anchor_end,
                        anchor_revision_id: comment.anchor_revision_id.clone(),
                    },
                ));

            log::info!(
                "External Web UI: comment created (id={}, segment={})",
                comment.id,
                segment_id
            );

            (
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "id": comment.id,
                    "external_segment_id": comment.external_segment_id,
                    "comment_text": comment.comment_text,
                    "author_name": comment.author_name,
                    "anchor_start": comment.anchor_start,
                    "anchor_end": comment.anchor_end,
                    "anchor_revision_id": comment.anchor_revision_id,
                    "created_at": comment.created_at,
                })),
            )
                .into_response()
        }
        Err(e) => {
            let status = classify_db_error(&e);
            log::error!(
                "External Web UI: failed to create comment (segment_id={}, status={}): {}",
                segment_id,
                status,
                e
            );
            (
                status,
                Json(serde_json::json!({
                    "error": "Failed to create comment"
                })),
            )
                .into_response()
        }
    }
}

// =============================================================================
// ハイライト追加
// =============================================================================

/// ハイライト追加リクエストのボディ。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateHighlightRequest {
    /// ハイライト色（UI パレットキー or hex 文字列、例: "yellow", "#ffeb3b"）
    color: String,
    /// 任意のメモ（例: "ここ重要"）
    note: Option<String>,
    /// テキスト内のアンカー開始位置（半開区間 [start, end)）。None ならセグメント全体
    anchor_start: Option<i64>,
    /// テキスト内のアンカー終了位置
    anchor_end: Option<i64>,
    /// anchor の基準となった revision ID（raw_text 基準なら None）
    anchor_revision_id: Option<String>,
}

/// セグメントに対するハイライトを追加する（プラン §12.4）。
/// 作成後、WebSocket で `TranscriptHighlightCreated` をブロードキャストする。
async fn create_highlight(
    State(state): State<ServerState>,
    Path(segment_id): Path<String>,
    Json(body): Json<CreateHighlightRequest>,
) -> impl IntoResponse {
    // repository 層でハイライトを作成する
    match ExternalWebRepository::create_highlight(
        &state.pool,
        &segment_id,
        &body.color,
        body.note.as_deref(),
        body.anchor_start,
        body.anchor_end,
        body.anchor_revision_id.as_deref(),
    )
    .await
    {
        Ok(highlight) => {
            // WebSocket 全クライアントにハイライト追加を通知する
            state
                .external_state
                .publish(ExternalWebEvent::TranscriptHighlightCreated(
                    TranscriptHighlightPayload {
                        id: highlight.id.clone(),
                        external_segment_id: highlight.external_segment_id.clone(),
                        color: highlight.color.clone(),
                        note: highlight.note.clone(),
                        anchor_start: highlight.anchor_start,
                        anchor_end: highlight.anchor_end,
                        anchor_revision_id: highlight.anchor_revision_id.clone(),
                    },
                ));

            log::info!(
                "External Web UI: highlight created (id={}, segment={})",
                highlight.id,
                segment_id
            );

            (
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "id": highlight.id,
                    "external_segment_id": highlight.external_segment_id,
                    "color": highlight.color,
                    "note": highlight.note,
                    "anchor_start": highlight.anchor_start,
                    "anchor_end": highlight.anchor_end,
                    "anchor_revision_id": highlight.anchor_revision_id,
                    "created_at": highlight.created_at,
                })),
            )
                .into_response()
        }
        Err(e) => {
            let status = classify_db_error(&e);
            log::error!(
                "External Web UI: failed to create highlight (segment_id={}, status={}): {}",
                segment_id,
                status,
                e
            );
            (
                status,
                Json(serde_json::json!({
                    "error": "Failed to create highlight"
                })),
            )
                .into_response()
        }
    }
}

// =============================================================================
// ハイライト削除
// =============================================================================

/// セグメントに紐付くハイライトを削除する。
/// 同種ハイライトの再付与によるトグル取り消し操作で使われる。
/// 削除後、WebSocket で `TranscriptHighlightDeleted` をブロードキャストする。
async fn delete_highlight(
    State(state): State<ServerState>,
    Path((segment_id, highlight_id)): Path<(String, String)>,
) -> impl IntoResponse {
    match ExternalWebRepository::delete_highlight(&state.pool, &highlight_id).await {
        Ok(_) => {
            state
                .external_state
                .publish(ExternalWebEvent::TranscriptHighlightDeleted(
                    TranscriptHighlightDeletedPayload {
                        id: highlight_id.clone(),
                        external_segment_id: segment_id.clone(),
                    },
                ));

            log::info!(
                "External Web UI: highlight deleted (id={}, segment={})",
                highlight_id,
                segment_id
            );

            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => {
            let status = classify_db_error(&e);
            log::error!(
                "External Web UI: failed to delete highlight (id={}, segment={}, status={}): {}",
                highlight_id,
                segment_id,
                status,
                e
            );
            (
                status,
                Json(serde_json::json!({
                    "error": "Failed to delete highlight"
                })),
            )
                .into_response()
        }
    }
}

// =============================================================================
// セクション取得
// =============================================================================

/// 指定セッション内の全セクションを取得する。
async fn get_session_sections(
    State(state): State<ServerState>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    match ExternalWebRepository::get_sections_by_session(&state.pool, &session_id).await {
        Ok(sections) => {
            let views: Vec<_> = sections
                .iter()
                .map(|s| {
                    serde_json::json!({
                        "id": s.id,
                        "session_id": s.session_id,
                        "meeting_id": s.meeting_id,
                        "title": s.title,
                        "description": s.description,
                        "before_sequence_id": s.before_sequence_id,
                        "created_at": s.created_at,
                    })
                })
                .collect();

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "session_id": session_id,
                    "sections": views,
                })),
            )
                .into_response()
        }
        Err(e) => {
            log::error!(
                "External Web UI: failed to get sections (session_id={}): {}",
                session_id,
                e
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Failed to get sections"
                })),
            )
                .into_response()
        }
    }
}

// =============================================================================
// セクション作成
// =============================================================================

/// セクション作成リクエストのボディ。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSectionRequest {
    /// セクションタイトル
    title: String,
    /// セクションの説明文（任意）
    description: Option<String>,
    /// このセクションが挿入される位置（直後のセグメントの sequence_id）
    before_sequence_id: i64,
}

/// セッションに対するセクションを作成する。
/// 作成後、WebSocket で `TranscriptSectionCreated` をブロードキャストする。
async fn create_section(
    State(state): State<ServerState>,
    Path(session_id): Path<String>,
    Json(body): Json<CreateSectionRequest>,
) -> impl IntoResponse {
    match ExternalWebRepository::create_section(
        &state.pool,
        &session_id,
        &body.title,
        body.description.as_deref().unwrap_or(""),
        body.before_sequence_id,
    )
    .await
    {
        Ok(section) => {
            // WebSocket 全クライアントにセクション作成を通知する
            state
                .external_state
                .publish(ExternalWebEvent::TranscriptSectionCreated(
                    TranscriptSectionPayload {
                        id: section.id.clone(),
                        session_id: section.session_id.clone(),
                        meeting_id: section.meeting_id.clone(),
                        title: section.title.clone(),
                        description: section.description.clone(),
                        before_sequence_id: section.before_sequence_id,
                        created_at: section.created_at.clone(),
                    },
                ));

            log::info!(
                "External Web UI: section created (id={}, session={})",
                section.id,
                session_id
            );

            (
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "id": section.id,
                    "session_id": section.session_id,
                    "meeting_id": section.meeting_id,
                    "title": section.title,
                    "description": section.description,
                    "before_sequence_id": section.before_sequence_id,
                    "created_at": section.created_at,
                })),
            )
                .into_response()
        }
        Err(e) => {
            let status = classify_db_error(&e);
            log::error!(
                "External Web UI: failed to create section (session_id={}, status={}): {}",
                session_id,
                status,
                e
            );
            (
                status,
                Json(serde_json::json!({
                    "error": "Failed to create section"
                })),
            )
                .into_response()
        }
    }
}

// =============================================================================
// セクション更新
// =============================================================================

/// セクション更新リクエストのボディ。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSectionRequest {
    /// セクションタイトル
    title: String,
    /// セクションの説明文
    description: Option<String>,
}

/// セクションのタイトル・説明を更新する。
/// 更新後、WebSocket で `TranscriptSectionUpdated` をブロードキャストする。
async fn update_section(
    State(state): State<ServerState>,
    Path(section_id): Path<String>,
    Json(body): Json<UpdateSectionRequest>,
) -> impl IntoResponse {
    match ExternalWebRepository::update_section(
        &state.pool,
        &section_id,
        &body.title,
        body.description.as_deref().unwrap_or(""),
    )
    .await
    {
        Ok(section) => {
            state
                .external_state
                .publish(ExternalWebEvent::TranscriptSectionUpdated(
                    TranscriptSectionPayload {
                        id: section.id.clone(),
                        session_id: section.session_id.clone(),
                        meeting_id: section.meeting_id.clone(),
                        title: section.title.clone(),
                        description: section.description.clone(),
                        before_sequence_id: section.before_sequence_id,
                        created_at: section.created_at.clone(),
                    },
                ));

            log::info!(
                "External Web UI: section updated (id={})",
                section.id
            );

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "id": section.id,
                    "session_id": section.session_id,
                    "meeting_id": section.meeting_id,
                    "title": section.title,
                    "description": section.description,
                    "before_sequence_id": section.before_sequence_id,
                    "created_at": section.created_at,
                })),
            )
                .into_response()
        }
        Err(e) => {
            let status = classify_db_error(&e);
            log::error!(
                "External Web UI: failed to update section (id={}, status={}): {}",
                section_id,
                status,
                e
            );
            (
                status,
                Json(serde_json::json!({
                    "error": "Failed to update section"
                })),
            )
                .into_response()
        }
    }
}

// =============================================================================
// セクション削除
// =============================================================================

/// セクションを削除する。
/// 削除後、WebSocket で `TranscriptSectionDeleted` をブロードキャストする。
async fn delete_section(
    State(state): State<ServerState>,
    Path(section_id): Path<String>,
) -> impl IntoResponse {
    // 削除前にセクション情報を取得（session_id をイベントに含めるため）
    let section_info = ExternalWebRepository::get_section_by_id(&state.pool, &section_id).await;

    match ExternalWebRepository::delete_section(&state.pool, &section_id).await {
        Ok(_) => {
            // session_id をイベントに含める
            let session_id = section_info
                .ok()
                .flatten()
                .map(|s| s.session_id)
                .unwrap_or_default();

            state
                .external_state
                .publish(ExternalWebEvent::TranscriptSectionDeleted(
                    TranscriptSectionDeletedPayload {
                        id: section_id.clone(),
                        session_id,
                    },
                ));

            log::info!(
                "External Web UI: section deleted (id={})",
                section_id
            );

            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => {
            let status = classify_db_error(&e);
            log::error!(
                "External Web UI: failed to delete section (id={}, status={}): {}",
                section_id,
                status,
                e
            );
            (
                status,
                Json(serde_json::json!({
                    "error": "Failed to delete section"
                })),
            )
                .into_response()
        }
    }
}

// =============================================================================
// ヘルパー関数
// =============================================================================

/// DB エラーを適切な HTTP ステータスコードに分類するヘルパー。
/// - FK 制約違反 or 行なし → 404 Not Found（クライアント起因）
/// - それ以外 → 500 Internal Server Error
/// Display トレイト経由で sqlx::Error / anyhow::Error 両方を受け取れる。
fn classify_db_error(e: &dyn std::fmt::Display) -> StatusCode {
    let msg = e.to_string();
    if msg.contains("FOREIGN KEY") || msg.contains("no rows returned") {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

/// セグメントの display_text を決定するヘルパー。
/// active revision が存在すればその edited_text を、なければ raw_text を返す。
async fn resolve_display_text(pool: &SqlitePool, segment_id: &str, raw_text: &str) -> String {
    match ExternalWebRepository::get_active_revision(pool, segment_id).await {
        Ok(Some(revision)) => revision.edited_text,
        Ok(None) => raw_text.to_string(),
        Err(e) => {
            log::warn!(
                "Failed to load active revision for segment {} (using raw_text): {}",
                segment_id,
                e
            );
            raw_text.to_string()
        }
    }
}

// =============================================================================
// WebSocket ハンドラ
// =============================================================================

/// WebSocket アップグレードを処理するハンドラ。
/// HTTP → WebSocket へのプロトコルアップグレードを行い、`handle_ws` に接続を渡す。
async fn ws_handler(ws: WebSocketUpgrade, State(state): State<ServerState>) -> impl IntoResponse {
    // WebSocket 接続をアップグレードし、イベント配信ループに渡す
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

/// WebSocket 接続のメインループ。
/// broadcast チャネルからイベントを受信し、JSON としてクライアントに送信する。
///
/// クライアントからのメッセージ（将来の双方向通信用）は別タスクで受信し、
/// 現時点では破棄する。
async fn handle_ws(socket: WebSocket, state: ServerState) {
    log::info!("External Web UI: new WebSocket client connected");

    // WebSocket を送信側と受信側に分割する
    let (mut sender, mut receiver) = socket.split();

    // broadcast チャネルの受信側を取得する
    let mut rx = state.external_state.subscribe();

    // クライアントからのメッセージを受信するタスク（現時点では読み捨て）
    // 将来的に双方向通信（例: cursor 位置の共有）を追加する際に使用する
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(_message)) = receiver.next().await {
            // 現時点ではクライアントからのメッセージは処理しない
        }
    });

    // broadcast チャネルからイベントを受信し、WebSocket で送信するループ
    loop {
        match rx.recv().await {
            Ok(event) => {
                // イベントを JSON にシリアライズする
                // Arc<ExternalWebEvent> の中身を参照してシリアライズ（プラン §8.4 Arc 最適化）
                let Ok(json) = serde_json::to_string(event.as_ref()) else {
                    log::warn!("External Web UI: failed to serialize event");
                    continue;
                };

                // WebSocket でクライアントに送信する
                if sender.send(Message::Text(json.into())).await.is_err() {
                    // 送信失敗 = クライアントが切断した
                    log::info!("External Web UI: WebSocket client disconnected");
                    break;
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                // クライアントの受信が追いつかず、一部イベントが破棄された
                log::warn!(
                    "External Web UI: WebSocket client lagged, {} events dropped",
                    count
                );
                // 接続は維持して続行する（クライアント側でリカバリ可能）
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                // broadcast チャネルが閉じた（通常はアプリ終了時）
                log::info!("External Web UI: broadcast channel closed");
                break;
            }
        }
    }

    // 受信タスクを中断する
    recv_task.abort();
}

// =============================================================================
// テスト
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    /// テスト用のインメモリ SQLite プールを作成するヘルパー。
    /// マイグレーションを適用して全テーブルを利用可能にする。
    /// max_connections(1) でシングルコネクションにし、全クエリが同一の
    /// インメモリ DB を参照することを保証する（複数コネクション時は各々が独立した DB を持つ）。
    async fn test_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("Failed to create in-memory SQLite pool");
        // マイグレーションを適用してテスト用テーブルを作成する
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("Failed to run migrations");
        pool
    }

    /// テスト用の ServerState を作成するヘルパー
    async fn test_state() -> ServerState {
        ServerState {
            external_state: ExternalWebState::new(),
            token: "test-token".to_string(),
            pool: test_pool().await,
        }
    }

    #[tokio::test]
    async fn test_health_endpoint_returns_ok() {
        let router = build_router(test_state().await);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_current_session_requires_token() {
        let router = build_router(test_state().await);

        // トークンなしでアクセスすると 401 が返る
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/sessions/current")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_current_session_with_valid_token() {
        let router = build_router(test_state().await);

        // 正しいトークンでアクセスすると 200 が返る
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/sessions/current?token=test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_current_session_with_invalid_token() {
        let router = build_router(test_state().await);

        // 不正なトークンでアクセスすると 401 が返る
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/sessions/current?token=wrong-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_current_session_returns_null_when_no_session() {
        let router = build_router(test_state().await);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/sessions/current?token=test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(json.is_null());
    }

    #[tokio::test]
    async fn test_get_session_transcripts_returns_empty_list() {
        let router = build_router(test_state().await);

        // 存在しないセッション ID でも空リストを返す（エラーにはしない）
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/sessions/nonexistent-session/transcripts?token=test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["segments"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_get_meeting_transcripts_returns_empty_list() {
        let router = build_router(test_state().await);

        // 存在しない meeting ID でも空リストを返す
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/meetings/nonexistent-meeting/transcripts?token=test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["segments"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_create_revision_with_valid_segment() {
        let state = test_state().await;
        let pool = state.pool.clone();

        // テスト用にセッションとセグメントを作成する
        let session = ExternalWebRepository::create_session(&pool, Some("Test Meeting"))
            .await
            .unwrap();
        let segment = ExternalWebRepository::upsert_segment(
            &pool,
            &session.id,
            1,
            "Hello world",
            "14:30:00",
            Some("microphone"),
            false,
            Some(0.95),
            Some(0.0),
            Some(3.0),
            Some(3.0),
        )
        .await
        .unwrap();

        let router = build_router(state);

        // revision を作成する
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(&format!(
                        "/api/segments/{}/revisions?token=test-token",
                        segment.id
                    ))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!({
                            "editedText": "Hello, World!",
                            "editorName": "tester"
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CREATED);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["edited_text"], "Hello, World!");
        assert_eq!(json["editor_name"], "tester");
        assert_eq!(json["version"], 1);
    }

    #[tokio::test]
    async fn test_create_comment_with_valid_segment() {
        let state = test_state().await;
        let pool = state.pool.clone();

        // テスト用にセッションとセグメントを作成する
        let session = ExternalWebRepository::create_session(&pool, Some("Test Meeting"))
            .await
            .unwrap();
        let segment = ExternalWebRepository::upsert_segment(
            &pool,
            &session.id,
            1,
            "Hello world",
            "14:30:00",
            Some("microphone"),
            false,
            Some(0.95),
            Some(0.0),
            Some(3.0),
            Some(3.0),
        )
        .await
        .unwrap();

        let router = build_router(state);

        // コメントを作成する
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(&format!(
                        "/api/segments/{}/comments?token=test-token",
                        segment.id
                    ))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!({
                            "commentText": "ここは後で確認する",
                            "authorName": "shuto",
                            "anchorStart": 0,
                            "anchorEnd": 5
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CREATED);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["comment_text"], "ここは後で確認する");
        assert_eq!(json["author_name"], "shuto");
    }

    #[tokio::test]
    async fn test_create_highlight_with_valid_segment() {
        let state = test_state().await;
        let pool = state.pool.clone();

        // テスト用にセッションとセグメントを作成する
        let session = ExternalWebRepository::create_session(&pool, Some("Test Meeting"))
            .await
            .unwrap();
        let segment = ExternalWebRepository::upsert_segment(
            &pool,
            &session.id,
            1,
            "Hello world",
            "14:30:00",
            Some("microphone"),
            false,
            Some(0.95),
            Some(0.0),
            Some(3.0),
            Some(3.0),
        )
        .await
        .unwrap();

        let router = build_router(state);

        // ハイライトを作成する
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(&format!(
                        "/api/segments/{}/highlights?token=test-token",
                        segment.id
                    ))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_string(&serde_json::json!({
                            "color": "yellow",
                            "note": "重要",
                            "anchorStart": 0,
                            "anchorEnd": 11
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CREATED);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["color"], "yellow");
        assert_eq!(json["note"], "重要");
    }
}
