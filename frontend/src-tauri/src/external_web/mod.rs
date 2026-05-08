// =============================================================================
// External Web UI モジュール
// =============================================================================
// 外部ブラウザから Meetily のリアルタイム文字起こしを閲覧・編集するための
// WebSocket/REST サーバー機能を提供するモジュール。
//
// モジュール構成:
//   - types   : WebSocket で配信するイベントの型定義（Step 3a）
//   - state   : broadcast チャネルとセッション管理の共有ステート（Step 3a）
//   - server  : axum ベースの HTTP/WebSocket サーバー（Step 3b）
//   - service : セッション管理 + transcript forwarding（Step 3c / 本 PR）
//
// 実装順序（プラン §20）:
//   Step 3a: types + state ✅
//   Step 3b: server（axum サーバー骨格）✅
//   Step 3c: service（セッション管理 + transcript forwarding）✅
//   Step 4 : recording_commands.rs との接続（後続 PR）
//   Step 5 : api_save_transcript との接続（後続 PR）
// =============================================================================

pub mod server;
pub mod service;
pub mod state;
pub mod types;
