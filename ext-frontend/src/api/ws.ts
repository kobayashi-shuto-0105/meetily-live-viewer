// =============================================================================
// WebSocket クライアント
// =============================================================================
// Meetily External Web API の WebSocket エンドポイントに接続し、
// リアルタイムイベントを受信するクライアント。
//
// 機能:
//   - 自動再接続（指数バックオフ付き）
//   - イベントコールバック登録
//   - 接続状態の通知
//
// 使い方:
//   const ws = createWebSocketClient({
//     onEvent: (event) => { /* イベント処理 */ },
//     onStatusChange: (status) => { /* 接続状態変更 */ },
//   });
//   ws.connect();
//   // ... 不要になったら
//   ws.disconnect();
// =============================================================================

import type { ExternalWebEvent, ConnectionStatus } from "../types";

// =============================================================================
// 定数
// =============================================================================

/** 再接続の初回待機時間（ミリ秒） */
const INITIAL_RECONNECT_DELAY_MS = 1000;

/** 再接続の最大待機時間（ミリ秒） */
const MAX_RECONNECT_DELAY_MS = 30000;

/** 再接続のバックオフ倍率 */
const BACKOFF_MULTIPLIER = 2;

// =============================================================================
// WebSocket クライアントのオプション
// =============================================================================

/** WebSocket クライアントの設定オプション */
export interface WebSocketClientOptions {
  /** サーバーから受信したイベントのコールバック */
  onEvent: (event: ExternalWebEvent) => void;

  /** 接続状態が変化した時のコールバック */
  onStatusChange: (status: ConnectionStatus) => void;

  /** WebSocket URL（省略時は環境変数から取得） */
  wsUrl?: string;

  /** 認証トークン（省略時は環境変数から取得） */
  token?: string;
}

// =============================================================================
// WebSocket クライアントのインターフェース
// =============================================================================

/** WebSocket クライアントの操作インターフェース */
export interface WebSocketClient {
  /** WebSocket 接続を開始する */
  connect: () => void;

  /** WebSocket 接続を切断する（再接続しない） */
  disconnect: () => void;

  /** 現在の接続状態を取得する */
  getStatus: () => ConnectionStatus;
}

// =============================================================================
// WebSocket クライアント生成
// =============================================================================

/**
 * WebSocket クライアントを生成する。
 *
 * 自動再接続機能付き。接続が切断された場合、指数バックオフで再接続を試みる。
 * disconnect() を呼ぶまで再接続を続ける。
 *
 * @param options - クライアントの設定オプション
 * @returns WebSocket クライアントの操作インターフェース
 */
export function createWebSocketClient(
  options: WebSocketClientOptions
): WebSocketClient {
  const { onEvent, onStatusChange } = options;

  // Derive WS URL: env var → same-origin proxy (works with Vite dev proxy)
  const wsUrl: string =
    options.wsUrl ??
    import.meta.env.VITE_MEETILY_WS_URL ??
    (() => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${proto}//${window.location.host}/ws`;
    })();

  const token: string =
    options.token ?? import.meta.env.VITE_MEETILY_ACCESS_TOKEN ?? "dev-token";

  // 内部状態
  let socket: WebSocket | null = null;
  let status: ConnectionStatus = "disconnected";
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  let intentionalDisconnect = false;

  // -------------------------------------------------------------------------
  // 接続状態の更新
  // -------------------------------------------------------------------------

  /** 接続状態を更新し、コールバックを呼び出す */
  function setStatus(newStatus: ConnectionStatus): void {
    status = newStatus;
    onStatusChange(newStatus);
  }

  // -------------------------------------------------------------------------
  // 再接続スケジュール
  // -------------------------------------------------------------------------

  /** 指数バックオフで再接続をスケジュールする */
  function scheduleReconnect(): void {
    // 意図的な切断の場合は再接続しない
    if (intentionalDisconnect) return;
    // 既にタイマーが起動中なら重複スケジュールしない
    if (reconnectTimer) return;

    console.log(
      `[WebSocket] ${reconnectDelay}ms 後に再接続を試みます...`
    );

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectInternal();
    }, reconnectDelay);

    // 次回の待機時間を指数バックオフで増やす（上限あり）
    reconnectDelay = Math.min(
      reconnectDelay * BACKOFF_MULTIPLIER,
      MAX_RECONNECT_DELAY_MS
    );
  }

  // -------------------------------------------------------------------------
  // 内部接続処理
  // -------------------------------------------------------------------------

  /** WebSocket 接続を実行する */
  function connectInternal(): void {
    // 既存の接続があれば閉じる。onclose を先にクリアして
    // 旧ソケットのイベントが新接続の再接続ロジックを誤発火させないようにする。
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
      socket = null;
    }

    setStatus("connecting");

    // トークンをクエリパラメータに付与して接続する（サーバー側の認証方式に合わせる）
    const url = new URL(wsUrl);
    url.searchParams.set("token", token);

    try {
      socket = new WebSocket(url.toString());
    } catch (error) {
      console.error("[WebSocket] 接続エラー:", error);
      setStatus("error");
      scheduleReconnect();
      return;
    }

    // --- 接続成功 ---
    socket.onopen = () => {
      console.log("[WebSocket] 接続しました");
      setStatus("connected");
      // 接続成功したら再接続遅延をリセットする
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    };

    // --- メッセージ受信 ---
    socket.onmessage = (event: MessageEvent) => {
      try {
        // サーバーからの JSON メッセージをパースする
        const data = JSON.parse(event.data as string) as ExternalWebEvent;
        onEvent(data);
      } catch (error) {
        console.warn("[WebSocket] メッセージのパースに失敗:", error);
      }
    };

    // --- 接続切断 ---
    socket.onclose = (event: CloseEvent) => {
      console.log(
        `[WebSocket] 切断されました (code=${event.code}, reason=${event.reason})`
      );
      socket = null;
      setStatus("disconnected");
      // 意図的でない切断の場合は再接続を試みる
      scheduleReconnect();
    };

    // --- エラー ---
    socket.onerror = (error: Event) => {
      console.error("[WebSocket] エラー:", error);
      setStatus("error");
      // onclose が続いて呼ばれるため、再接続はそちらで処理する
    };
  }

  // -------------------------------------------------------------------------
  // 公開 API
  // -------------------------------------------------------------------------

  return {
    connect(): void {
      intentionalDisconnect = false;
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      connectInternal();
    },

    disconnect(): void {
      intentionalDisconnect = true;

      // 再接続タイマーをクリアする
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      // 接続を閉じる
      if (socket) {
        socket.close();
        socket = null;
      }

      setStatus("disconnected");
    },

    getStatus(): ConnectionStatus {
      return status;
    },
  };
}
