// =============================================================================
// External Web UI モジュール
// =============================================================================
// 外部ブラウザから Meetily のリアルタイム文字起こしを閲覧・編集するための
// WebSocket/REST サーバー機能を提供するモジュール。
//
// モジュール構成:
//   - types  : WebSocket で配信するイベントの型定義
//   - state  : broadcast チャネルとセッション管理の共有ステート
//   - server : axum ベースの HTTP/WebSocket サーバー（後続 PR で追加）
//   - service: ビジネスロジック層（後続 PR で追加）
//
// 実装順序（プラン §20）:
//   Step 3a: types + state（本 PR）
//   Step 3b: server（axum サーバー骨格）
//   Step 3c: service（セッション管理 + transcript forwarding）
// =============================================================================

pub mod state;
pub mod types;

// 後続 PR で追加予定:
// pub mod server;
// pub mod service;
