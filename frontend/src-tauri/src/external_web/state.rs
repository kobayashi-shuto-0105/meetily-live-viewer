// =============================================================================
// External Web UI 共有ステート
// =============================================================================
// WebSocket broadcast 用のチャネルと、現在アクティブな録音セッションを管理する。
// Tauri の `app.manage()` に登録して、各 handler/service から共有アクセスする。
//
// 設計方針:
//   - `tokio::sync::broadcast` を使い、複数 WebSocket クライアントへ fan-out 配信する
//   - `current_session` は録音中のみ Some を持ち、停止/finalize 後は None に戻す
//   - DB pool は AppState から取得するため、ここには持たない（プラン §0.3）
// =============================================================================

use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use super::types::ExternalWebEvent;

// =============================================================================
// セッション情報（メモリ上で保持する軽量版）
// =============================================================================

/// 現在録音中のセッションを表す軽量構造体。
/// DB の ExternalRecordingSession とは別に、メモリ上で高速アクセスするために使う。
#[derive(Debug, Clone)]
pub struct CurrentSession {
    /// 録音セッション ID（external_recording_sessions.id）
    pub id: String,
    /// ユーザーが設定した会議タイトル
    pub meeting_title: Option<String>,
    /// 録音開始時刻（ISO8601 形式）
    pub started_at: String,
}

// =============================================================================
// メインステート構造体
// =============================================================================

/// External Web UI の共有ステート。
/// Tauri の managed state として登録し、server / service / handler から共有する。
///
/// 使い方:
/// ```rust
/// // lib.rs の setup 内で登録
/// app.manage(ExternalWebState::new());
///
/// // handler 内で取得
/// let state = app.state::<ExternalWebState>();
/// state.publish(event);
/// ```
#[derive(Clone)]
pub struct ExternalWebState {
    /// WebSocket クライアントへの broadcast 送信側。
    /// `subscribe()` で受信側を取得し、各 WebSocket 接続が受信ループを回す。
    tx: broadcast::Sender<Arc<ExternalWebEvent>>,

    /// 現在アクティブな録音セッション。
    /// 録音中のみ Some を持ち、停止後は None になる。
    /// RwLock で読み取り優先の並行アクセスを許可する。
    pub current_session: Arc<RwLock<Option<CurrentSession>>>,
}

impl ExternalWebState {
    /// 新しい ExternalWebState を作成する。
    /// broadcast チャネルのバッファサイズは 1024 イベント。
    /// 接続クライアントが追いつけない場合、古いイベントは破棄される（lagged）。
    pub fn new() -> Self {
        // バッファサイズ 1024: リアルタイム文字起こしの頻度を考慮した値
        // Whisper は通常 2-5秒間隔でセグメントを出力するため、十分な余裕がある
        let (tx, _rx) = broadcast::channel(1024);

        Self {
            tx,
            current_session: Arc::new(RwLock::new(None)),
        }
    }

    /// broadcast チャネルの受信側を取得する。
    /// 各 WebSocket 接続ごとに 1 つの Receiver を持ち、イベントループで受信する。
    pub fn subscribe(&self) -> broadcast::Receiver<Arc<ExternalWebEvent>> {
        self.tx.subscribe()
    }

    /// イベントを全 WebSocket クライアントへ broadcast する。
    /// 受信者がいない場合は何もしない（送信エラーは無視する）。
    pub fn publish(&self, event: ExternalWebEvent) {
        // send() は受信者がいない場合 Err を返すが、それは正常動作
        // （まだクライアントが接続していない状態）
        let _ = self.tx.send(Arc::new(event));
    }
}

impl Default for ExternalWebState {
    fn default() -> Self {
        Self::new()
    }
}
