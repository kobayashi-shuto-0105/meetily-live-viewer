// =============================================================================
// External Web UI モジュール
// =============================================================================
// 外部ブラウザから Meetily のリアルタイム文字起こしを閲覧・編集するための
// WebSocket/REST サーバー機能を提供するモジュール。
//
// モジュール構成:
//   - types   : WebSocket で配信するイベントの型定義（Step 3a）
//   - state   : broadcast チャネルとセッション管理の共有ステート（Step 3a）
//   - server  : axum ベースの HTTP/WebSocket サーバー + REST API（Step 3b + 本 PR）
//   - service : セッション管理 + transcript forwarding（Step 3c）
//
// REST API エンドポイント:
//   GET  /health                                - 疎通確認（認証不要）
//   WS   /ws?token=xxx                          - リアルタイム WebSocket 購読
//   GET  /api/sessions/current?token=xxx        - 現在の録音セッション取得
//   GET  /api/sessions/:id/transcripts?token=xxx - セッション内セグメント取得
//   GET  /api/meetings/:id/transcripts?token=xxx - 保存済み会議の文字起こし取得
//   POST /api/segments/:id/revisions?token=xxx  - 文字起こし修正
//   POST /api/segments/:id/comments?token=xxx   - コメント追加
//   POST /api/segments/:id/highlights?token=xxx - ハイライト追加
// =============================================================================

pub mod server;
pub mod service;
pub mod state;
pub mod types;
