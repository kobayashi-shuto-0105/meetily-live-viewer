// =============================================================================
// External Web UI HTTP/WebSocket サーバー
// =============================================================================
// axum ベースの HTTP/WebSocket サーバーを提供する。
// Tauri アプリの setup 内で `tokio::spawn` により非同期に起動される。
//
// エンドポイント一覧（プラン §8.6）:
//   GET  /health                                - 疎通確認
//   WS   /ws?token=xxx                          - リアルタイム WebSocket 購読
//   GET  /api/sessions/current?token=xxx        - 現在の録音セッション取得
//   （以下は後続 PR で追加予定）
//   GET  /api/sessions/:id/transcripts          - セッション内セグメント取得
//   GET  /api/meetings/:id/transcripts          - 保存済み会議の文字起こし取得
//   POST /api/segments/:id/revisions            - 文字起こし修正
//   POST /api/segments/:id/comments             - コメント追加
//   POST /api/segments/:id/highlights           - ハイライト追加
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
        Query, State,
    },
    http::StatusCode,
    middleware::{self, Next},
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use tower_http::cors::CorsLayer;

use super::state::ExternalWebState;

// =============================================================================
// サーバー共有ステート
// =============================================================================

/// axum ルーター全体で共有するステート。
/// `ExternalWebState`（broadcast チャネル + セッション情報）と認証トークンを保持する。
#[derive(Clone)]
pub struct ServerState {
    /// External Web UI の broadcast チャネルとセッション管理
    pub external_state: ExternalWebState,
    /// API アクセス用の認証トークン
    pub token: String,
}

// =============================================================================
// サーバー起動
// =============================================================================

/// External Web UI サーバーを起動する。
/// `lib.rs` の setup 内から `tokio::spawn` で呼び出される。
///
/// # エラー
/// バインドアドレスのパースや TCP リスナーの作成に失敗した場合にエラーを返す。
pub async fn run(external_state: ExternalWebState) -> anyhow::Result<()> {
    // 認証トークンを環境変数から取得する（ローカル開発のみ未設定時はデフォルト値）
    let token_from_env = std::env::var("MEETILY_EXT_TOKEN").ok();

    // バインドアドレスを環境変数から取得する（デフォルトはローカルのみ）
    let bind = std::env::var("MEETILY_EXT_BIND")
        .unwrap_or_else(|_| "127.0.0.1:38391".to_string());

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
async fn get_current_session(
    State(state): State<ServerState>,
) -> impl IntoResponse {
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
// WebSocket ハンドラ
// =============================================================================

/// WebSocket アップグレードを処理するハンドラ。
/// HTTP → WebSocket へのプロトコルアップグレードを行い、`handle_ws` に接続を渡す。
async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<ServerState>,
) -> impl IntoResponse {
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

    /// テスト用の ServerState を作成するヘルパー
    fn test_state() -> ServerState {
        ServerState {
            external_state: ExternalWebState::new(),
            token: "test-token".to_string(),
        }
    }

    #[tokio::test]
    async fn test_health_endpoint_returns_ok() {
        let router = build_router(test_state());

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
        let router = build_router(test_state());

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
        let router = build_router(test_state());

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
        let router = build_router(test_state());

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
        let router = build_router(test_state());

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
}
