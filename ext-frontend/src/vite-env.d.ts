// =============================================================================
// Vite 環境変数の型定義
// =============================================================================
// .env ファイルで定義した VITE_ プレフィックス付き環境変数の型を宣言する。
// import.meta.env 経由のアクセスで TypeScript の補完が効くようになる。
// =============================================================================

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Meetily External Web API のベース URL */
  readonly VITE_MEETILY_API_BASE: string;
  /** WebSocket 接続先 URL */
  readonly VITE_MEETILY_WS_URL: string;
  /** API アクセストークン */
  readonly VITE_MEETILY_ACCESS_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
