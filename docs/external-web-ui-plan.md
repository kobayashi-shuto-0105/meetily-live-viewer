# External Web UI 実装プラン

> ## 0. レビュー反映メモ（2026-04-26 追記）
>
> このプランを `kobayashi-shuto-0105/meetily-live-viewer` の `develop` ブランチの実コードと突き合わせてレビューした結果、進行可能（feasible）と判断した上で、以下の小さな不一致・抜けを補足する。本文（1章以降）は元プランをそのまま残し、本セクションを「優先される修正点」として参照すること。
>
> ### 0.1 `TranscriptUpdate` のフィールド型は `f64`
>
> 実コード `frontend/src-tauri/src/audio/transcription/worker.rs` の `TranscriptUpdate` では、`chunk_start_time` / `audio_start_time` / `audio_end_time` / `duration` は `f32` ではなく **`f64`**。本文 3章のフィールド一覧、および 8.5 章の `TranscriptSegmentPayload` の同名フィールドはすべて `f64` として実装する。マイグレーションの `REAL` カラムは SQLite 側ではどちらでも問題ないが、Rust 構造体は `f64` で揃えること。
>
> ### 0.2 `external_web/server.rs` のトークン検証は実装が必要
>
> 8.6 章のサンプルでは `ServerState.token` を保持するだけで実際の検証はしていない。少なくとも以下を実装する前提で進めること。
>
> - REST: クエリ `?token=...` または `Authorization: Bearer ...` を `axum` の middleware (`axum::middleware::from_fn_with_state` など) でチェックし、不一致なら 401 を返す。
> - WebSocket: `WebSocketUpgrade` ハンドラの中で `Query<HashMap<String, String>>` を取り出して token を検証し、不一致なら upgrade 前に 401 を返す。
> - 既定 bind は `127.0.0.1:38391` のままとし、`MEETILY_EXT_BIND` で `0.0.0.0` にする場合は token 必須を強制する（空 token を弾く）。
>
> ### 0.3 DB pool は `AppState` から取得する
>
> `external_web::service::*` および `external_web::repository::*` から SQLite pool にアクセスする際は、`app.state::<crate::state::AppState>()` 経由で `state.db_manager.pool()` を使う（`api/api.rs` の既存パターンと同じ）。`ExternalWebState` には pool を直接持たせない。
>
> ### 0.4 `api.rs::api_save_transcript` の `_app` 引数の扱い
>
> 現状 `api_save_transcript<R: Runtime>(_app: AppHandle<R>, ...)` のように引数名がアンダースコア接頭辞で「未使用」扱いになっている。10.3 章の `finalize_external_session(app.clone(), ...)` を呼ぶには、
>
> - 引数名を `app` にリネームする
> - `finalize_external_session` 側を `<R: Runtime>` でジェネリックに受けるか、`AppHandle` (default Wry) に絞る
>
> のいずれかで対応する。プランの疑似コードはこのリネーム前提で読むこと。
>
> ### 0.5 `recording_commands.rs` には listener が複数ある
>
> 9 章で言及されている `transcript-update` の listener は、現状 `recording_commands.rs` の中に **2 箇所**（おおよそ L262 / L430）登場する。`handle_transcript_update` 呼び出しは両方に同じパターンで追加する必要がある。共通ヘルパー関数（例: `fn forward_to_external(app: &AppHandle, update: TranscriptUpdate)`）に切り出してから呼ぶのが望ましい。
>
> ### 0.6 `external_transcript_segments` の upsert 戦略
>
> `is_partial = true` の途中結果は同一 `(session_id, sequence_id)` で上書きされる前提。マイグレーションの UNIQUE 制約に合わせ、INSERT は `INSERT INTO external_transcript_segments (...) VALUES (...) ON CONFLICT(session_id, sequence_id) DO UPDATE SET raw_text = excluded.raw_text, is_partial = excluded.is_partial, ..., updated_at = excluded.updated_at` の形にすること。
>
> ### 0.7 既存の依存
>
> `frontend/src-tauri/Cargo.toml` には既に `tokio` (full)、`sqlx` (sqlite, runtime-tokio)、`uuid`、`serde`、`serde_json`、`anyhow`、`futures-util` が入っている。8.1 章で追加するのは実質 **`axum` と `tower-http` のみ**。重複追加に注意。
>
> ### 0.8 初回起動（First Launch）時の `AppState` 未初期化を考慮する
>
> `lib.rs` の setup では `database::setup::initialize_database_on_startup` が呼ばれるが、初回起動では DB 未作成のため `AppState` がまだ `manage` されない分岐がある。したがって `external_web::server::run` 内で `app.state::<AppState>()` を前提にすると panic しうる。
>
> 対応方針は以下のいずれかにする。
>
> - `run` の起動前に `app.try_state::<AppState>()` を確認し、未初期化なら起動をスキップ（またはリトライ）
> - DB初期化完了イベント（`initialize_fresh_database` / `import_and_initialize_database` 後）で外部サーバーを起動する
>
> これを先に決めておかないと、初回起動ユーザー環境で外部サーバー機能が不安定になる。
>
> ### 0.9 結論
>
> 上記 0.1〜0.8 を踏まえれば、本プランの方針（生データ `transcripts` を変更せず、`external_*` テーブルを overlay として持ち、Rust 側に WS/REST サーバーを生やす）はそのまま実装に進められる。実装は本文 20 章の優先順位どおり、**Step 1 (DB migration) → Step 3 (`external_web` module) → Step 4 (`recording_commands` 接続) → Step 6 (`ext-frontend`)** の順で進める。

---

## 1. 目的

Meetily本体のリアルタイム文字起こし結果を、外部ブラウザから閲覧できる **External Web UI** として公開する。

今回の要件は以下。

* Meetily本体が生成・保存する文字起こしは **生データ** として扱う
* External Web UI側では、生データを直接更新せず、以下を別データとして持つ

  * 文字起こし修正後のテキスト
  * コメント
  * ハイライト
* WebSocketでリアルタイムに文字起こしが更新される
* 外部ブラウザから閲覧できる
* 新規Web UIは既存の `frontend/` ではなく、`ext-frontend/` に作成する

---

## 2. 現状のMeetily構成

Meetilyは通常のWebアプリではなく、**Tauri + Rust backend + Next.js frontend** のデスクトップアプリ構成になっている。アーキテクチャ上も、Tauri Core、Audio Engine、Transcription Engine、Database、Summary Engineが同一アプリ内に存在する構成になっている。([GitHub][1])

また、README上でも、Meetilyはローカルマシン上で動作し、会議音声のキャプチャ、リアルタイム文字起こし、要約をローカルで行うことが特徴として説明されている。([GitHub][2])

そのため、外部ブラウザから見るには、Tauri内部のUIをそのまま公開するのではなく、**Rust側に外部公開用のHTTP/WebSocketサーバーを追加する**のがよい。

---

## 3. 現状の文字起こし処理

現在のリアルタイム文字起こしは、Rust側の以下の流れで処理されている。

```txt
音声キャプチャ
  ↓
audio/transcription/worker.rs
  ↓
TranscriptUpdate を生成
  ↓
app.emit("transcript-update", &update)
  ↓
Tauri frontend / recording manager が受け取る
```

`TranscriptUpdate` は `frontend/src-tauri/src/audio/transcription/worker.rs` に定義されており、現在のフィールドは以下に近い。

```rust
pub struct TranscriptUpdate {
    pub text: String,
    pub timestamp: String,
    pub source: String,
    pub sequence_id: u64,
    pub chunk_start_time: f64,
    pub is_partial: bool,
    pub confidence: f32,
    pub audio_start_time: f64,
    pub audio_end_time: f64,
    pub duration: f64,
}
```

実際に `worker.rs` では `TranscriptUpdate` を作成し、`app_clone.emit("transcript-update", &update)` でTauriイベントとしてemitしている。([GitHub][3]) ([GitHub][3])

また、`frontend/src-tauri/src/audio/recording_commands.rs` 側では `app.listen("transcript-update", ...)` でこのイベントを購読し、録音保存用の `TranscriptSegment` として `RECORDING_MANAGER` に追加している。([GitHub][4])

したがって、External Web UI用には、**`worker.rs` を大きく変更せず、既存の `transcript-update` イベントを横取りしてWebSocketにも配信する**のが最小変更で済む。

---

## 4. 現状の保存データ

Meetilyの既存DBでは、文字起こしは `transcripts` テーブルに保存されている。

現在の `Transcript` モデルは、概ね以下のフィールドを持つ。

```rust
pub struct Transcript {
    pub id: String,
    pub meeting_id: String,
    pub transcript: String,
    pub timestamp: String,
    pub summary: Option<String>,
    pub action_items: Option<String>,
    pub key_points: Option<String>,
    pub audio_start_time: Option<f64>,
    pub audio_end_time: Option<f64>,
    pub duration: Option<f64>,
}
```

このモデルは `frontend/src-tauri/src/database/models.rs` に存在する。([GitHub][5])

初期マイグレーションでも `meetings` と `transcripts` テーブルが作成されており、`transcripts` は `meeting_id`, `transcript`, `timestamp`, `audio_start_time`, `audio_end_time`, `duration` などを持つ。([GitHub][6])

さらに後続マイグレーションで `speaker` カラムも追加されている。([GitHub][7])

保存処理は `TranscriptsRepository::save_transcript` にあり、`meetings` に会議を作成した後、各文字起こしセグメントを `transcripts` にINSERTしている。([GitHub][8])

また、Tauri command側では `api_save_transcript` が `TranscriptsRepository::save_transcript(...)` を呼び出して保存している。([GitHub][9])

既存の取得処理は `api_get_meeting_transcripts` で、`MeetingsRepository::get_meeting_transcripts_paginated(...)` を使って保存済み文字起こしを返している。([GitHub][9])

---

## 5. 基本方針

### 5.1 生データは変更しない

既存の `transcripts.transcript` は **Meetilyが生成した生データ** として扱う。

External Web UIで編集された文字起こしは、`transcripts` を直接UPDATEしない。

```txt
transcripts
  = Meetilyが保存したオリジナル文字起こし

external_transcript_revisions
  = External Web UIで編集した後のテキスト

external_transcript_comments
  = コメント

external_transcript_highlights
  = ハイライト
```

### 5.2 External Web UI用のデータを別テーブルに持つ

編集、コメント、ハイライトは、既存の `transcripts` とは別テーブルに保存する。

既存コードには `meeting_notes` という追加情報用のテーブルが存在しており、`meetings` に対して別データを紐づける設計はすでにある。今回も同じ考え方で、External Web UI用のテーブルを追加する。([GitHub][10])

### 5.3 WebSocketはRust側に追加する

外部ブラウザはTauriイベントを直接購読できないため、Rust側に以下を追加する。

```txt
frontend/src-tauri/src/external_web/
  ├── mod.rs
  ├── server.rs
  ├── state.rs
  ├── types.rs
  ├── repository.rs
  └── service.rs
```

役割は以下。

| ファイル            | 役割                                  |
| --------------- | ----------------------------------- |
| `server.rs`     | HTTP/WebSocketサーバー                  |
| `state.rs`      | WebSocket broadcaster、現在の録音セッション管理  |
| `types.rs`      | REST/WSで使うDTO                       |
| `repository.rs` | external系テーブルへのDB操作                 |
| `service.rs`    | transcript-updateの処理、DB保存、broadcast |

---

## 6. 追加・変更するファイル一覧

## Rust側

| ファイル                                                                          | 変更内容                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `frontend/src-tauri/Cargo.toml`                                               | `axum`, `tower-http`, `futures-util` などを追加                  |
| `frontend/src-tauri/src/lib.rs`                                               | `external_web` moduleを追加し、起動時に外部Webサーバーをspawn               |
| `frontend/src-tauri/src/external_web/mod.rs`                                  | 新規追加                                                        |
| `frontend/src-tauri/src/external_web/server.rs`                               | 新規追加。HTTP/WS API                                            |
| `frontend/src-tauri/src/external_web/state.rs`                                | 新規追加。broadcast channelとsession state                        |
| `frontend/src-tauri/src/external_web/types.rs`                                | 新規追加。DTO定義                                                  |
| `frontend/src-tauri/src/external_web/repository.rs`                           | 新規追加。DB操作                                                   |
| `frontend/src-tauri/src/external_web/service.rs`                              | 新規追加。イベント処理                                                 |
| `frontend/src-tauri/src/audio/recording_commands.rs`                          | `transcript-update` listener内からExternal Web側にもpublish       |
| `frontend/src-tauri/src/api/api.rs`                                           | `api_save_transcript` 完了時にExternal sessionと保存済みmeetingを紐づける |
| `frontend/src-tauri/src/database/models.rs`                                   | External Web UI用モデルを追加                                      |
| `frontend/src-tauri/src/database/repositories/mod.rs`                         | external repositoryを追加                                      |
| `frontend/src-tauri/src/database/repositories/external_web.rs`                | 新規追加                                                        |
| `frontend/src-tauri/migrations/20260425000000_add_external_web_ui_tables.sql` | 新規追加                                                        |

## Web UI側

| ファイル/ディレクトリ                                        | 内容                      |
| -------------------------------------------------- | ----------------------- |
| `ext-frontend/`                                    | 新規React + TypeScript UI |
| `ext-frontend/src/api/client.ts`                   | REST API client         |
| `ext-frontend/src/api/ws.ts`                       | WebSocket client        |
| `ext-frontend/src/types.ts`                        | 型定義                     |
| `ext-frontend/src/components/TranscriptViewer.tsx` | 文字起こし表示                 |
| `ext-frontend/src/components/TranscriptEditor.tsx` | 編集UI                    |
| `ext-frontend/src/components/CommentPanel.tsx`     | コメントUI                  |
| `ext-frontend/src/components/HighlightToolbar.tsx` | ハイライトUI                 |

---

## 7. DB設計

### 7.1 方針

既存の `transcripts` は変更しない。

ただし、リアルタイム中はまだ `transcripts.id` が存在しない可能性がある。現在の保存処理は `api_save_transcript` 経由で最終的に `TranscriptsRepository::save_transcript` が呼ばれたタイミングで `meetings` と `transcripts` を作成する構造になっている。([GitHub][9]) ([GitHub][8])

そのため、External Web UI側では、リアルタイム表示中の単位として `external_recording_sessions` と `external_transcript_segments` を持つ。

```txt
録音中:
  external_recording_sessions.id = session_id
  external_transcript_segments に sequence_id ベースで保存

録音停止後:
  api_save_transcript により meetings/transcripts が作成される
  external_recording_sessions.meeting_id に保存済み meeting_id を紐づける
```

---

## 7.2 追加マイグレーション

追加ファイル：

```txt
frontend/src-tauri/migrations/20260425000000_add_external_web_ui_tables.sql
```

内容案：

```sql
CREATE TABLE IF NOT EXISTS external_recording_sessions (
    id TEXT PRIMARY KEY,
    meeting_id TEXT,
    meeting_title TEXT,
    started_at TEXT NOT NULL,
    stopped_at TEXT,
    finalized_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS external_transcript_segments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    meeting_id TEXT,
    source_transcript_id TEXT,
    sequence_id INTEGER NOT NULL,
    raw_text TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    source TEXT,
    is_partial INTEGER NOT NULL DEFAULT 0,
    confidence REAL,
    audio_start_time REAL,
    audio_end_time REAL,
    duration REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(session_id, sequence_id),
    FOREIGN KEY (session_id) REFERENCES external_recording_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL,
    FOREIGN KEY (source_transcript_id) REFERENCES transcripts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS external_transcript_revisions (
    id TEXT PRIMARY KEY,
    external_segment_id TEXT NOT NULL,
    edited_text TEXT NOT NULL,
    editor_name TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (external_segment_id) REFERENCES external_transcript_segments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS external_transcript_comments (
    id TEXT PRIMARY KEY,
    external_segment_id TEXT NOT NULL,
    comment_text TEXT NOT NULL,
    author_name TEXT,
    anchor_start INTEGER,
    anchor_end INTEGER,
    anchor_revision_id TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (external_segment_id) REFERENCES external_transcript_segments(id) ON DELETE CASCADE,
    FOREIGN KEY (anchor_revision_id) REFERENCES external_transcript_revisions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS external_transcript_highlights (
    id TEXT PRIMARY KEY,
    external_segment_id TEXT NOT NULL,
    color TEXT NOT NULL,
    note TEXT,
    anchor_start INTEGER,
    anchor_end INTEGER,
    anchor_revision_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (external_segment_id) REFERENCES external_transcript_segments(id) ON DELETE CASCADE,
    FOREIGN KEY (anchor_revision_id) REFERENCES external_transcript_revisions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_external_sessions_meeting_id
    ON external_recording_sessions(meeting_id);

CREATE INDEX IF NOT EXISTS idx_external_segments_session_id
    ON external_transcript_segments(session_id);

CREATE INDEX IF NOT EXISTS idx_external_segments_meeting_id
    ON external_transcript_segments(meeting_id);

CREATE INDEX IF NOT EXISTS idx_external_segments_source_transcript_id
    ON external_transcript_segments(source_transcript_id);

CREATE INDEX IF NOT EXISTS idx_external_revisions_segment_id
    ON external_transcript_revisions(external_segment_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_revisions_one_active_per_segment
    ON external_transcript_revisions(external_segment_id)
    WHERE is_active = 1;

CREATE INDEX IF NOT EXISTS idx_external_comments_segment_id
    ON external_transcript_comments(external_segment_id);

CREATE INDEX IF NOT EXISTS idx_external_highlights_segment_id
    ON external_transcript_highlights(external_segment_id);
```

### 7.3 なぜ `external_transcript_segments` を持つのか

`transcripts` テーブルは保存済み会議のデータであり、リアルタイム中の `sequence_id`, `confidence`, `is_partial`, `source` などは既存の `transcripts` にはそのまま保存されない。

一方、`TranscriptUpdate` には `sequence_id`, `is_partial`, `confidence`, `audio_start_time`, `audio_end_time`, `duration` が含まれている。([GitHub][3])

そのため、External Web UI側のリアルタイム表示・編集・コメント・ハイライトのアンカーとして、`external_transcript_segments` を用意する。

---

## 8. Rust backend実装

## 8.1 `Cargo.toml` に依存追加

変更ファイル：

```txt
frontend/src-tauri/Cargo.toml
```

追加候補：

```toml
axum = { version = "0.7", features = ["ws", "macros"] }
tower-http = { version = "0.6", features = ["cors"] }
futures-util = "0.3"
```

既存の `tokio`, `serde`, `serde_json`, `uuid`, `sqlx` などがすでにある場合は、それを使う。

---

## 8.2 `external_web` moduleを追加

追加ファイル：

```txt
frontend/src-tauri/src/external_web/mod.rs
```

```rust
pub mod repository;
pub mod server;
pub mod service;
pub mod state;
pub mod types;
```

---

## 8.3 `lib.rs` にmodule追加

変更ファイル：

```txt
frontend/src-tauri/src/lib.rs
```

追加：

```rust
pub mod external_web;
```

Tauri setup内で外部Webサーバーを起動する。

```rust
.setup(|app| {
    let app_handle = app.handle().clone();

    tauri::async_runtime::spawn(async move {
        if let Err(error) = crate::external_web::server::run(app_handle).await {
            log::error!("External web server failed: {}", error);
        }
    });

    Ok(())
})
```

実際には既存の `.setup(...)` の中に追加する。
DB初期化より前に起動するとDB poolが使えない可能性があるため、**既存DB初期化が完了した後**にspawnする。

さらに、First Launch（DB未作成）分岐では `AppState` が未初期化の可能性があるため、起動時は以下のどちらかで防御する。

```rust
if app_handle.try_state::<crate::state::AppState>().is_some() {
    tauri::async_runtime::spawn(async move {
        let _ = crate::external_web::server::run(app_handle).await;
    });
}
```

または、DB初期化コマンド成功後にサーバー起動へ切り替える。

---

## 8.4 WebSocket state

追加ファイル：

```txt
frontend/src-tauri/src/external_web/state.rs
```

```rust
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use super::types::{ExternalRecordingSession, ExternalWebEvent};

#[derive(Clone)]
pub struct ExternalWebState {
    pub tx: broadcast::Sender<Arc<ExternalWebEvent>>,
    pub current_session: Arc<RwLock<Option<ExternalRecordingSession>>>,
}

impl ExternalWebState {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(1024);

        Self {
            tx,
            current_session: Arc::new(RwLock::new(None)),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Arc<ExternalWebEvent>> {
        self.tx.subscribe()
    }

    pub fn publish(&self, event: ExternalWebEvent) {
        let _ = self.tx.send(Arc::new(event));
    }
}
```

`broadcast` は receiver ごとに payload を clone するため、チャネルには `ExternalWebEvent` を直接流さず `Arc<ExternalWebEvent>` を流す。これにより複数クライアント fan-out 時も `String` 群の複製を避け、参照カウントの増減だけで配信できる。

`lib.rs` 側で `.manage(ExternalWebState::new())` する。

```rust
.manage(crate::external_web::state::ExternalWebState::new())
```

---

## 8.5 WebSocket event type

追加ファイル：

```txt
frontend/src-tauri/src/external_web/types.rs
```

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalRecordingSession {
    pub id: String,
    pub meeting_id: Option<String>,
    pub meeting_title: Option<String>,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ExternalWebEvent {
    RecordingStarted(RecordingStartedPayload),
    RecordingStopped(RecordingStoppedPayload),
    MeetingPersisted(MeetingPersistedPayload),
    TranscriptSegmentUpserted(TranscriptSegmentPayload),
    TranscriptRevisionCreated(TranscriptRevisionPayload),
    TranscriptCommentCreated(TranscriptCommentPayload),
    TranscriptHighlightCreated(TranscriptHighlightPayload),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingStartedPayload {
    pub session_id: String,
    pub meeting_title: Option<String>,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingStoppedPayload {
    pub session_id: String,
    pub stopped_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingPersistedPayload {
    pub session_id: String,
    pub meeting_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegmentPayload {
    pub id: String,
    pub session_id: String,
    pub meeting_id: Option<String>,
    pub sequence_id: u64,
    pub raw_text: String,
    pub display_text: String,
    pub timestamp: String,
    pub source: String,
    pub is_partial: bool,
    pub confidence: f32,
    pub audio_start_time: f64,
    pub audio_end_time: f64,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptRevisionPayload {
    pub id: String,
    pub external_segment_id: String,
    pub edited_text: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptCommentPayload {
    pub id: String,
    pub external_segment_id: String,
    pub comment_text: String,
    pub author_name: Option<String>,
    pub anchor_start: Option<i64>,
    pub anchor_end: Option<i64>,
    pub anchor_revision_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptHighlightPayload {
    pub id: String,
    pub external_segment_id: String,
    pub color: String,
    pub note: Option<String>,
    pub anchor_start: Option<i64>,
    pub anchor_end: Option<i64>,
    pub anchor_revision_id: Option<String>,
}
```

`display_text` は以下の優先順位で決める。

```txt
active revision がある場合:
  display_text = edited_text

active revision がない場合:
  display_text = raw_text
```

---

## 8.6 External Web server

追加ファイル：

```txt
frontend/src-tauri/src/external_web/server.rs
```

提供するエンドポイント。

| Method | Path                                    | 用途                                |
| ------ | --------------------------------------- | --------------------------------- |
| `GET`  | `/health`                               | 疎通確認                              |
| `GET`  | `/api/sessions/current`                 | 現在の録音セッション取得                      |
| `GET`  | `/api/sessions/:session_id/transcripts` | リアルタイム中または録音後の外部セグメント取得           |
| `GET`  | `/api/meetings/:meeting_id/transcripts` | 保存済み会議の文字起こし + external overlay取得 |
| `POST` | `/api/segments/:segment_id/revisions`   | 文字起こし修正                           |
| `POST` | `/api/segments/:segment_id/comments`    | コメント追加                            |
| `POST` | `/api/segments/:segment_id/highlights`  | ハイライト追加                           |
| `WS`   | `/ws`                                   | リアルタイム購読                          |

実装イメージ：

```rust
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use tauri::AppHandle;
use tower_http::cors::CorsLayer;

use super::state::ExternalWebState;

#[derive(Clone)]
pub struct ServerState {
    pub app: AppHandle,
    pub external_state: ExternalWebState,
    pub token: String,
}

pub async fn run(app: AppHandle) -> anyhow::Result<()> {
    let external_state = app.state::<ExternalWebState>().inner().clone();

    let token = std::env::var("MEETILY_EXT_TOKEN")
        .unwrap_or_else(|_| "dev-token".to_string());

    let state = ServerState {
        app,
        external_state,
        token,
    };

    let router = Router::new()
        .route("/health", get(health))
        .route("/ws", get(ws_handler))
        .route("/api/sessions/current", get(get_current_session))
        .route("/api/sessions/:session_id/transcripts", get(get_session_transcripts))
        .route("/api/meetings/:meeting_id/transcripts", get(get_meeting_transcripts))
        .route("/api/segments/:segment_id/revisions", post(create_revision))
        .route("/api/segments/:segment_id/comments", post(create_comment))
        .route("/api/segments/:segment_id/highlights", post(create_highlight))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let bind = std::env::var("MEETILY_EXT_BIND")
        .unwrap_or_else(|_| "127.0.0.1:38391".to_string());

    let addr: SocketAddr = bind.parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;

    log::info!("External Web UI server listening on {}", addr);

    axum::serve(listener, router).await?;

    Ok(())
}

async fn health() -> impl IntoResponse {
    "ok"
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<ServerState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

async fn handle_ws(socket: WebSocket, state: ServerState) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.external_state.subscribe();

    tokio::spawn(async move {
        while let Some(Ok(_message)) = receiver.next().await {}
    });

    while let Ok(event) = rx.recv().await {
        let Ok(json) = serde_json::to_string(event.as_ref()) else {
            continue;
        };

        if sender.send(Message::Text(json)).await.is_err() {
            break;
        }
    }
}
```

初期実装では `CorsLayer::permissive()` でもよいが、LAN公開する段階で許可originを絞る。

---

## 8.7 認証

LAN公開・外部公開を考えるなら、最低限トークン認証を入れる。

WebSocketはブラウザから任意ヘッダーを付けづらいため、初期実装ではクエリパラメータでよい。

```txt
ws://192.168.1.20:38391/ws?token=xxxxxxxx
```

REST APIも同じく、

```txt
GET /api/sessions/current?token=xxxxxxxx
```

で認証する。

本格運用では以下に変更する。

* HTTPS/WSS
* Cookie session
* Basic Auth
* Cloudflare Access
* Tailscale経由のみアクセス許可

---

## 9. `recording_commands.rs` の変更

現在 `recording_commands.rs` では `transcript-update` をlistenして `RECORDING_MANAGER.add_transcript_segment(segment)` している。該当箇所は複数存在するため、直接同じ処理を増やすより、共通関数に寄せるのがよい。([GitHub][4])

### 9.1 追加する処理

既存の処理：

```rust
manager.add_transcript_segment(segment);
```

の後に、External Web UI側へも流す。

```rust
let app_for_external = app_handle.clone();
let update_for_external = update.clone();

tauri::async_runtime::spawn(async move {
    if let Err(error) = crate::external_web::service::handle_transcript_update(
        app_for_external,
        update_for_external,
    ).await {
        log::error!("Failed to publish external transcript update: {}", error);
    }
});
```

### 9.2 なぜ `worker.rs` ではなく `recording_commands.rs` に入れるか

`worker.rs` は文字起こしエンジンの責務に近い。

一方、External Web UIへの配信はアプリケーション層の責務なので、既存の `transcript-update` イベント購読側で扱うほうが安全。

```txt
worker.rs:
  文字起こし結果を生成する責務

recording_commands.rs:
  録音セッション中の文字起こしを受け取り、保存・外部配信する責務

external_web/service.rs:
  External Web UI向けに保存・broadcastする責務
```

---

## 10. 録音セッションの開始・停止

## 10.1 録音開始時

`start_recording` 系の処理で、External Web UI用のsessionを作成する。

追加処理のイメージ：

```rust
crate::external_web::service::start_external_session(
    app_handle.clone(),
    meeting_name.clone(),
).await?;
```

この中で、

* `external_recording_sessions` にINSERT
* `ExternalWebState.current_session` にセット
* WebSocketへ `RecordingStarted` をbroadcast

を行う。

### 注意

既存の `meetings.id` は、この時点ではまだ存在しない可能性がある。
そのため、録音中は `session_id` をExternal Web UIの主キーとして扱う。

---

## 10.2 録音停止時

既存では録音停止時に `recording-stopped` がemitされる。`recording_commands.rs` では停止時に `recording-stopped` をemitしている。([GitHub][4])

ここでExternal Web UIにも通知する。

```rust
crate::external_web::service::stop_external_session(
    app_handle.clone(),
).await?;
```

WebSocketには以下を流す。

```json
{
  "type": "RecordingStopped",
  "payload": {
    "session_id": "...",
    "stopped_at": "..."
  }
}
```

---

## 10.3 保存完了時

既存の `api_save_transcript` は保存後に `meeting_id` を返す構造になっている。([GitHub][9])

ここでExternal sessionと保存済みmeetingを紐づける。

変更ファイル：

```txt
frontend/src-tauri/src/api/api.rs
```

`TranscriptsRepository::save_transcript(...)` が成功した直後に追加：

```rust
if let Err(error) = crate::external_web::service::finalize_external_session(
    app.clone(),
    meeting_id.clone(),
).await {
    log::error!("Failed to finalize external session: {}", error);
}
```

これにより、

```txt
external_recording_sessions.meeting_id = saved meeting_id
external_transcript_segments.meeting_id = saved meeting_id
```

を更新する。

WebSocketには以下を流す。

```json
{
  "type": "MeetingPersisted",
  "payload": {
    "session_id": "...",
    "meeting_id": "..."
  }
}
```

---

## 11. `external_web/service.rs`

主な責務。

```rust
pub async fn start_external_session(
    app: AppHandle,
    meeting_title: Option<String>,
) -> anyhow::Result<()>;

pub async fn stop_external_session(
    app: AppHandle,
) -> anyhow::Result<()>;

pub async fn finalize_external_session(
    app: AppHandle,
    meeting_id: String,
) -> anyhow::Result<()>;

pub async fn handle_transcript_update(
    app: AppHandle,
    update: TranscriptUpdate,
) -> anyhow::Result<()>;
```

`handle_transcript_update` の流れ。

```txt
1. current_session を取得
2. sessionがなければ何もしない
3. external_transcript_segments に upsert
4. active revision があれば display_text = edited_text
5. なければ display_text = raw_text
6. ExternalWebEvent::TranscriptSegmentUpserted をbroadcast
```

疑似コード：

```rust
pub async fn handle_transcript_update(
    app: AppHandle,
    update: TranscriptUpdate,
) -> anyhow::Result<()> {
    let external_state = app.state::<ExternalWebState>().inner().clone();

    let Some(session) = external_state.current_session.read().await.clone() else {
        return Ok(());
    };

    let segment = repository::upsert_transcript_segment(
        &app,
        &session.id,
        &update,
    ).await?;

    let payload = TranscriptSegmentPayload {
        id: segment.id,
        session_id: session.id,
        meeting_id: session.meeting_id,
        sequence_id: update.sequence_id,
        raw_text: update.text.clone(),
        display_text: segment.display_text,
        timestamp: update.timestamp,
        source: update.source,
        is_partial: update.is_partial,
        confidence: update.confidence,
        audio_start_time: update.audio_start_time,
        audio_end_time: update.audio_end_time,
        duration: update.duration,
    };

    external_state.publish(ExternalWebEvent::TranscriptSegmentUpserted(payload));

    Ok(())
}
```

---

## 12. REST API設計

## 12.1 保存済み会議の文字起こし取得

```txt
GET /api/meetings/:meeting_id/transcripts
```

返却形式：

```ts
type TranscriptDocumentResponse = {
  meetingId: string;
  segments: TranscriptSegmentView[];
};

type TranscriptSegmentView = {
  id: string;
  sourceTranscriptId?: string;
  sequenceId?: number;
  rawText: string;
  displayText: string;
  timestamp: string;
  audioStartTime?: number;
  audioEndTime?: number;
  duration?: number;
  revision?: TranscriptRevision;
  comments: TranscriptComment[];
  highlights: TranscriptHighlight[];
};
```

`rawText` は必ずMeetilyの生データ。

`displayText` は以下。

```txt
revisionあり:
  revision.editedText

revisionなし:
  rawText
```

---

## 12.2 文字起こし修正

```txt
POST /api/segments/:segment_id/revisions
```

Request:

```json
{
  "editedText": "修正後の文字起こし",
  "editorName": "shuto"
}
```

処理：

```txt
1. 同じ external_segment_id の既存 active revision を is_active = 0 にする
2. version を +1 して新規INSERT
3. WebSocketで TranscriptRevisionCreated をbroadcast
```

補足:

- DB側で `is_active = 1` が同一セグメントに複数存在しないよう、partial unique index（`external_segment_id WHERE is_active = 1`）を張る。
- `create_revision` は同一セグメントに対して並行実行されうるため、トランザクション内で更新→INSERTを行い、ユニーク制約違反が出た場合はリトライ/エラー処理を検討する。

---

## 12.3 コメント追加

```txt
POST /api/segments/:segment_id/comments
```

Request:

```json
{
  "commentText": "ここは後で確認する",
  "authorName": "shuto",
  "anchorStart": 3,
  "anchorEnd": 12,
  "anchorRevisionId": "optional-revision-id"
}
```

処理：

```txt
1. external_transcript_comments にINSERT
2. WebSocketで TranscriptCommentCreated をbroadcast
```

補足:

- `anchorRevisionId` が **NULL** の場合、`anchorStart/End` は `raw_text` を基準とする
- `anchorRevisionId` が **NOT NULL** の場合、`anchorStart/End` はその revision の `edited_text` を基準とする（後から別revisionが作られても anchor がドリフトしない）

---

## 12.4 ハイライト追加

```txt
POST /api/segments/:segment_id/highlights
```

Request:

```json
{
  "color": "yellow",
  "note": "重要",
  "anchorStart": 0,
  "anchorEnd": 20,
  "anchorRevisionId": "optional-revision-id"
}
```

処理：

```txt
1. external_transcript_highlights にINSERT
2. WebSocketで TranscriptHighlightCreated をbroadcast
```

補足:

- `anchorRevisionId` が **NULL** の場合、`anchorStart/End` は `raw_text` を基準とする
- `anchorRevisionId` が **NOT NULL** の場合、`anchorStart/End` はその revision の `edited_text` を基準とする

---

## 13. `ext-frontend/` 実装

## 13.1 作成

```bash
mkdir ext-frontend
cd ext-frontend
pnpm create vite . --template react-ts
pnpm install
```

追加候補：

```bash
pnpm add @tanstack/react-query zustand zod lucide-react
```

---

## 13.2 ディレクトリ構成

```txt
ext-frontend/
  ├── index.html
  ├── package.json
  ├── vite.config.ts
  ├── .env.example
  └── src/
      ├── main.tsx
      ├── App.tsx
      ├── types.ts
      ├── api/
      │   ├── client.ts
      │   └── ws.ts
      ├── stores/
      │   └── transcriptStore.ts
      └── components/
          ├── TranscriptViewer.tsx
          ├── TranscriptSegment.tsx
          ├── TranscriptEditor.tsx
          ├── CommentPanel.tsx
          └── HighlightToolbar.tsx
```

---

## 13.3 `.env.example`

```env
VITE_MEETILY_API_BASE=http://127.0.0.1:38391
VITE_MEETILY_WS_URL=ws://127.0.0.1:38391/ws
VITE_MEETILY_ACCESS_TOKEN=dev-token
```

LAN公開時：

```env
VITE_MEETILY_API_BASE=http://192.168.1.20:38391
VITE_MEETILY_WS_URL=ws://192.168.1.20:38391/ws
VITE_MEETILY_ACCESS_TOKEN=your-token
```

---

## 13.4 WebSocket client

```ts
export type ExternalWebEvent =
  | {
      type: "TranscriptSegmentUpserted";
      payload: TranscriptSegmentView;
    }
  | {
      type: "TranscriptRevisionCreated";
      payload: TranscriptRevision;
    }
  | {
      type: "TranscriptCommentCreated";
      payload: TranscriptComment;
    }
  | {
      type: "TranscriptHighlightCreated";
      payload: TranscriptHighlight;
    }
  | {
      type: "RecordingStarted";
      payload: {
        sessionId: string;
        meetingTitle?: string;
        startedAt: string;
      };
    }
  | {
      type: "RecordingStopped";
      payload: {
        sessionId: string;
        stoppedAt: string;
      };
    }
  | {
      type: "MeetingPersisted";
      payload: {
        sessionId: string;
        meetingId: string;
      };
    };
```

```ts
const wsUrl = new URL(import.meta.env.VITE_MEETILY_WS_URL);
wsUrl.searchParams.set("token", import.meta.env.VITE_MEETILY_ACCESS_TOKEN);

const socket = new WebSocket(wsUrl.toString());

socket.onmessage = (event) => {
  const message = JSON.parse(event.data) as ExternalWebEvent;

  switch (message.type) {
    case "TranscriptSegmentUpserted":
      upsertSegment(message.payload);
      break;

    case "TranscriptRevisionCreated":
      applyRevision(message.payload);
      break;

    case "TranscriptCommentCreated":
      addComment(message.payload);
      break;

    case "TranscriptHighlightCreated":
      addHighlight(message.payload);
      break;
  }
};
```

---

## 13.5 UIの表示ルール

1つの文字起こしセグメントに対して、UIでは以下を表示する。

```txt
rawText:
  Meetilyが生成した元テキスト

displayText:
  編集済みなら editedText
  未編集なら rawText

comments:
  コメント一覧

highlights:
  ハイライト一覧
```

UIイメージ：

```txt
[10.2s - 14.8s]
表示テキスト: 今日は認証機能について話します
元テキスト:   今日は認証昨日について話します

[編集] [コメント] [ハイライト]
```

編集済みの場合は、元テキストを折りたたんで見られるようにする。

---

## 14. 外部公開方法

## 14.1 ローカル開発

Meetily側：

```bash
MEETILY_EXT_BIND=127.0.0.1:38391
MEETILY_EXT_TOKEN=dev-token
```

External Web UI側：

```bash
cd ext-frontend
pnpm dev
```

アクセス：

```txt
http://localhost:5173
```

---

## 14.2 LAN公開

Meetily側：

```bash
MEETILY_EXT_BIND=0.0.0.0:38391
MEETILY_EXT_TOKEN=ランダムな長い文字列
```

External Web UI：

```bash
pnpm dev -- --host 0.0.0.0
```

別PCから：

```txt
http://Meetily実行PCのIP:5173
```

---

## 14.3 インターネット公開

直接ポート公開は避ける。

推奨：

```txt
Tailscale
Cloudflare Tunnel
ngrok
VPN
```

外部公開時は必ず以下を満たす。

* HTTPS/WSS
* トークン認証
* 可能ならVPNまたはAccess制御
* 会議ごとにtokenを分ける
* URLを知っているだけで誰でも見える状態にしない

---

## 15. 実装ステップ

## Step 1: DB migrationを追加

追加：

```txt
frontend/src-tauri/migrations/20260425000000_add_external_web_ui_tables.sql
```

作成するテーブル：

* `external_recording_sessions`
* `external_transcript_segments`
* `external_transcript_revisions`
* `external_transcript_comments`
* `external_transcript_highlights`

---

## Step 2: Rust model/repositoryを追加

追加：

```txt
frontend/src-tauri/src/database/repositories/external_web.rs
```

実装する関数：

```rust
pub async fn create_session(...);
pub async fn stop_session(...);
pub async fn finalize_session(...);
pub async fn upsert_segment(...);
pub async fn get_session_document(...);
pub async fn get_meeting_document(...);
pub async fn create_revision(...);
pub async fn create_comment(...);
pub async fn create_highlight(...);
```

---

## Step 3: `external_web` moduleを追加

追加：

```txt
frontend/src-tauri/src/external_web/
```

実装するもの：

* WebSocket broadcaster
* REST API
* transcript-update handler
* current session管理

---

## Step 4: `recording_commands.rs` と接続

`transcript-update` listener内で、既存の録音保存処理に加えて、

```rust
crate::external_web::service::handle_transcript_update(...)
```

を呼ぶ。

この時点で、External Web UIはリアルタイム文字起こしをWebSocketで受信できる。

---

## Step 5: `api_save_transcript` と接続

`api_save_transcript` の保存成功後に、

```rust
crate::external_web::service::finalize_external_session(...)
```

を呼ぶ。

これにより、録音中の `session_id` と保存後の `meeting_id` を紐づける。

---

## Step 6: `ext-frontend/` を作成

Vite + React + TypeScriptで作る。

最低限の画面：

* 接続状態表示
* リアルタイム文字起こし一覧
* セグメント編集
* コメント追加
* ハイライト追加
* 元テキスト表示
* 編集済みテキスト表示

---

## Step 7: 動作確認

### リアルタイム表示

* Meetilyで録音開始
* `ext-frontend` を開く
* 話した内容がWebSocketで流れてくる
* 自動スクロールされる

### 編集

* セグメントを編集
* `external_transcript_revisions` に保存される
* `transcripts.transcript` は変更されない
* 他のブラウザにもWebSocketで反映される

### コメント

* セグメントにコメント追加
* `external_transcript_comments` に保存される
* 他のブラウザにも反映される

### ハイライト

* テキスト範囲を選択
* ハイライト追加
* `external_transcript_highlights` に保存される
* 他のブラウザにも反映される

### 録音停止後

* `api_save_transcript` により既存の `meetings/transcripts` が保存される
* `external_recording_sessions.meeting_id` が更新される
* 保存済みmeetingとして再取得できる

---

## 16. MVPの範囲

最初の実装では以下までをMVPとする。

* `ext-frontend/` でリアルタイム文字起こしを見る
* WebSocketでリアルタイム更新
* 文字起こしセグメント単位で編集
* コメント追加
* ハイライト追加
* 生データは変更しない
* LAN内ブラウザからアクセス可能

やらないこと：

* 複数会議の同時配信
* ユーザー認証/権限管理の本格実装
* 細かい共同編集
* 差分編集
* 話者分離UI
* インターネット一般公開

---

## 17. 将来的な拡張

* 会議ごとの閲覧URL発行
* 読み取り専用モード
* 編集可能ユーザーと閲覧のみユーザーの分離
* コメント解決機能
* ハイライト色の種類追加
* Markdown/HTML/PDF export
* 議事録生成結果との連携
* Speaker別フィルタ
* 検索
* タイムライン表示
* 音声再生位置との同期

---

## 18. 重要な注意点

External Web UIを作ると、Meetilyの「ローカル完結」という性質が一部変わる。

Meetily本体はローカル処理を特徴にしているが、External Web UIをLANやインターネットに公開すると、会議内容がネットワーク越しに閲覧可能になる。([GitHub][2])

そのため、少なくとも以下は必須。

* デフォルトbindは `127.0.0.1`
* LAN公開時のみ `0.0.0.0`
* トークン必須
* インターネット公開時はVPN/Tunnel前提
* 生の会議内容をログに出しすぎない
* 本番用途ではHTTPS/WSS必須

---

## 19. 最終構成

```txt
Meetily Desktop App
  frontend/
    src-tauri/
      audio/transcription/worker.rs
        └─ transcript-update emit

      audio/recording_commands.rs
        ├─ existing recording save
        └─ external_web::service::handle_transcript_update

      external_web/
        ├─ WebSocket server
        ├─ REST API
        ├─ external overlay repository
        └─ broadcast hub

      database/
        ├─ existing meetings/transcripts
        └─ external_* tables

ext-frontend/
  React + TypeScript
    ├─ WebSocket live transcript
    ├─ transcript edit
    ├─ comments
    └─ highlights
```

---

## 20. 実装の優先順位

1. DB migration
2. `external_web` module追加
3. WebSocket server起動
4. `transcript-update` をWebSocketへ流す
5. `ext-frontend/` でリアルタイム表示
6. revision/comment/highlight API
7. revision/comment/highlight UI
8. `api_save_transcript` 後のsession-finalize
9. LAN公開設定
10. 認証強化

---

この方針なら、**Meetilyの既存文字起こし保存処理を壊さずに、外部Web UI側で編集・コメント・ハイライトを独立管理**できます。
特に重要なのは、`transcripts` を直接更新せず、`external_*` テーブルを「UI用の上書きレイヤー」として扱う点です。

[1]: https://github.com/kobayashi-shuto-0105/meetily-live-viewer/blob/develop/docs/architecture.md "meetily-live-viewer/docs/architecture.md at develop · kobayashi-shuto-0105/meetily-live-viewer · GitHub"
[2]: https://github.com/kobayashi-shuto-0105/meetily-live-viewer/tree/develop "kobayashi-shuto-0105/meetily-live-viewer at develop · GitHub"
[3]: https://github.com/kobayashi-shuto-0105/meetily-live-viewer/blob/develop/frontend/src-tauri/src/audio/transcription/worker.rs "meetily-live-viewer/frontend/src-tauri/src/audio/transcription/worker.rs at develop · GitHub"
[4]: https://github.com/kobayashi-shuto-0105/meetily-live-viewer/blob/develop/frontend/src-tauri/src/audio/recording_commands.rs "meetily-live-viewer/frontend/src-tauri/src/audio/recording_commands.rs at develop · GitHub"
[5]: https://github.com/kobayashi-shuto-0105/meetily-live-viewer/blob/develop/frontend/src-tauri/src/database/models.rs "meetily-live-viewer/frontend/src-tauri/src/database/models.rs at develop · GitHub"
[6]: https://github.com/kobayashi-shuto-0105/meetily-live-viewer/blob/develop/frontend/src-tauri/migrations/20250916100000_initial_schema.sql "meetily-live-viewer/frontend/src-tauri/migrations/20250916100000_initial_schema.sql at develop · GitHub"
[7]: https://github.com/kobayashi-shuto-0105/meetily-live-viewer/blob/develop/frontend/src-tauri/migrations/20251110000001_add_speaker_field.sql "meetily-live-viewer/frontend/src-tauri/migrations/20251110000001_add_speaker_field.sql at develop · GitHub"
[8]: https://github.com/kobayashi-shuto-0105/meetily-live-viewer/blob/develop/frontend/src-tauri/src/database/repositories/transcript.rs "meetily-live-viewer/frontend/src-tauri/src/database/repositories/transcript.rs at develop · GitHub"
[9]: https://github.com/kobayashi-shuto-0105/meetily-live-viewer/blob/develop/frontend/src-tauri/src/api/api.rs "meetily-live-viewer/frontend/src-tauri/src/api/api.rs at develop · GitHub"
[10]: https://github.com/kobayashi-shuto-0105/meetily-live-viewer/blob/develop/frontend/src-tauri/migrations/20251223000000_add_meeting_notes.sql "meetily-live-viewer/frontend/src-tauri/migrations/20251223000000_add_meeting_notes.sql at develop · GitHub"
