# データベーススキーマ / Database Schema

## 概要 / Overview

Meetilyは以下の2つのデータベースを使用します:

1. **Frontend Database (SQLite)**: Tauriアプリ内で管理
2. **Backend Database (SQLite)**: FastAPIサーバーで管理

## Frontend Database (Tauri)

### 保存場所 / Storage Location

- **開発時**: `frontend/src-tauri/target/debug/meetily.db`
- **本番 (macOS)**: `~/Library/Application Support/Meetily/meetily.db`
- **本番 (Windows)**: `%APPDATA%\Meetily\meetily.db`

### マイグレーション管理 / Migration Management

- **ツール**: sqlx (Rust)
- **マイグレーションディレクトリ**: `frontend/src-tauri/migrations/`
- **実行タイミング**: アプリ起動時に自動実行

```rust
// frontend/src-tauri/src/database/manager.rs
pub async fn new() -> Result<Self> {
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await?;
    Ok(Self { pool })
}
```

### テーブル定義 / Table Definitions

#### 1. meetings テーブル

会議の基本情報を格納します。

```sql
CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,           -- UUID v4
    title TEXT NOT NULL,            -- 会議タイトル
    created_at TEXT NOT NULL,       -- ISO 8601形式 (UTC)
    updated_at TEXT NOT NULL        -- ISO 8601形式 (UTC)
);
```

**インデックス**:
- PRIMARY KEY: `id`

**使用例**:
```sql
-- 会議作成
INSERT INTO meetings (id, title, created_at, updated_at)
VALUES ('550e8400-e29b-41d4-a716-446655440000', 'Team Standup', '2026-05-07T07:00:00Z', '2026-05-07T07:00:00Z');

-- 会議一覧取得
SELECT * FROM meetings ORDER BY created_at DESC;

-- 会議タイトル更新
UPDATE meetings SET title = '新しいタイトル', updated_at = '2026-05-07T08:00:00Z'
WHERE id = '550e8400-e29b-41d4-a716-446655440000';
```

#### 2. transcripts テーブル

会議の文字起こしデータを格納します。

```sql
CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,           -- UUID v4
    meeting_id TEXT NOT NULL,      -- meetings.idへの外部キー
    transcript TEXT NOT NULL,      -- 文字起こしテキスト
    timestamp TEXT NOT NULL,       -- ISO 8601形式 (UTC)
    summary TEXT,                  -- 要約 (オプション)
    action_items TEXT,             -- アクションアイテム (JSON)
    key_points TEXT,               -- キーポイント (JSON)
    
    -- 音声-テキスト同期用フィールド (Migration: 20251006000000)
    audio_start_time REAL,         -- 録音開始からの相対時間 (秒)
    audio_end_time REAL,           -- 録音開始からの相対時間 (秒)
    duration REAL,                 -- 発話時間 (秒)
    speaker TEXT,                  -- 話者名 (Migration: 20251110000001)
    
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
```

**インデックス**:
- PRIMARY KEY: `id`
- FOREIGN KEY: `meeting_id` → `meetings(id)`

**カスケード削除**: 会議が削除されるとすべてのトランスクリプトも削除されます。

**使用例**:
```sql
-- トランスクリプト追加
INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_start_time, audio_end_time, duration, speaker)
VALUES (
    '660e8400-e29b-41d4-a716-446655440001',
    '550e8400-e29b-41d4-a716-446655440000',
    'こんにちは、本日の議題は...',
    '2026-05-07T07:05:30Z',
    5.3,
    12.8,
    7.5,
    'John Doe'
);

-- 会議のトランスクリプト取得
SELECT * FROM transcripts
WHERE meeting_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY timestamp ASC;
```

#### 3. summary_processes テーブル

要約処理の進行状況を追跡します。

```sql
CREATE TABLE IF NOT EXISTS summary_processes (
    meeting_id TEXT PRIMARY KEY,   -- meetings.idへの外部キー
    status TEXT NOT NULL,           -- 'pending', 'processing', 'completed', 'failed'
    created_at TEXT NOT NULL,       -- ISO 8601形式
    updated_at TEXT NOT NULL,       -- ISO 8601形式
    error TEXT,                     -- エラーメッセージ (失敗時)
    result TEXT,                    -- 要約結果 (JSON)
    start_time TEXT,                -- 処理開始時刻
    end_time TEXT,                  -- 処理終了時刻
    chunk_count INTEGER DEFAULT 0,  -- 処理したチャンク数
    processing_time REAL DEFAULT 0.0, -- 処理時間 (秒)
    metadata TEXT,                  -- メタデータ (JSON)
    
    -- バックアップフィールド (Migration: 20251101000000)
    backup_result TEXT,             -- 以前の要約結果のバックアップ
    
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
```

**ステータス遷移**:
```
pending → processing → completed
                    ↘ failed
```

**使用例**:
```sql
-- 要約処理開始
INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, start_time)
VALUES (
    '550e8400-e29b-41d4-a716-446655440000',
    'processing',
    '2026-05-07T07:30:00Z',
    '2026-05-07T07:30:00Z',
    '2026-05-07T07:30:00Z'
);

-- 要約処理完了
UPDATE summary_processes
SET status = 'completed',
    end_time = '2026-05-07T07:32:15Z',
    result = '{"summary": "会議の要約...", "action_items": [...]}',
    chunk_count = 5,
    processing_time = 135.2,
    updated_at = '2026-05-07T07:32:15Z'
WHERE meeting_id = '550e8400-e29b-41d4-a716-446655440000';
```

#### 4. transcript_chunks テーブル

大きなトランスクリプトをチャンク分割して保存します。

```sql
CREATE TABLE IF NOT EXISTS transcript_chunks (
    meeting_id TEXT PRIMARY KEY,   -- meetings.idへの外部キー
    meeting_name TEXT,              -- 会議名 (冗長性)
    transcript_text TEXT NOT NULL,  -- 分割されたテキスト
    model TEXT NOT NULL,            -- 使用モデル (例: 'gpt-4')
    model_name TEXT NOT NULL,       -- モデル表示名
    chunk_size INTEGER,             -- チャンクサイズ
    overlap INTEGER,                -- オーバーラップサイズ
    created_at TEXT NOT NULL,       -- ISO 8601形式
    
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
```

**使用例**:
```sql
-- チャンク保存
INSERT INTO transcript_chunks (meeting_id, meeting_name, transcript_text, model, model_name, chunk_size, overlap, created_at)
VALUES (
    '550e8400-e29b-41d4-a716-446655440000',
    'Team Standup',
    'チャンク1のテキスト...',
    'gpt-4',
    'GPT-4',
    4096,
    200,
    '2026-05-07T07:30:00Z'
);
```

#### 5. settings テーブル

LLM統合の設定を保存します。

```sql
CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,           -- 通常は '1' (シングルトン)
    provider TEXT NOT NULL,         -- 'ollama', 'claude', 'openai', 'groq'
    model TEXT NOT NULL,            -- モデル名
    whisperModel TEXT NOT NULL,     -- Whisperモデル名
    groqApiKey TEXT,                -- Groq APIキー
    openaiApiKey TEXT,              -- OpenAI APIキー
    anthropicApiKey TEXT,           -- Anthropic APIキー
    ollamaApiKey TEXT,              -- Ollama APIキー (通常は不要)
    
    -- 追加APIキー (Migrations)
    openrouterApiKey TEXT,          -- OpenRouter (20250920155811)
    geminiApiKey TEXT,              -- Google Gemini (20251229000000)
    
    -- Pro License設定 (Migration: 20251105120000)
    custom_openai_endpoint TEXT,    -- カスタムOpenAIエンドポイント
    custom_openai_key TEXT,         -- カスタムOpenAI APIキー
    custom_openai_model TEXT,       -- カスタムOpenAIモデル
    
    -- Ollamaエンドポイント (Migration: 20251010153942)
    ollama_endpoint TEXT            -- カスタムOllamaエンドポイント
);
```

**使用例**:
```sql
-- 設定保存/更新 (UPSERT)
INSERT INTO settings (id, provider, model, whisperModel, anthropicApiKey)
VALUES ('1', 'claude', 'claude-3-sonnet-20240229', 'base', 'sk-ant-...')
ON CONFLICT(id) DO UPDATE SET
    provider = excluded.provider,
    model = excluded.model,
    anthropicApiKey = excluded.anthropicApiKey;

-- 設定取得
SELECT * FROM settings WHERE id = '1';
```

#### 6. transcript_settings テーブル

文字起こしプロバイダーの設定を保存します。

```sql
CREATE TABLE IF NOT EXISTS transcript_settings (
    id TEXT PRIMARY KEY,           -- 通常は '1' (シングルトン)
    provider TEXT NOT NULL,         -- 'whisper', 'deepgram', 'elevenlabs'
    model TEXT NOT NULL,            -- モデル名
    whisperApiKey TEXT,             -- Whisper APIキー (クラウド版)
    deepgramApiKey TEXT,            -- Deepgram APIキー
    elevenLabsApiKey TEXT,          -- ElevenLabs APIキー
    groqApiKey TEXT,                -- Groq APIキー
    openaiApiKey TEXT               -- OpenAI APIキー
);
```

#### 7. meeting_notes テーブル

会議メモを保存します (Migration: 20251223000000)。

```sql
CREATE TABLE IF NOT EXISTS meeting_notes (
    meeting_id TEXT PRIMARY KEY,   -- meetings.idへの外部キー
    notes TEXT NOT NULL,            -- メモ内容 (Markdown)
    created_at TEXT NOT NULL,       -- ISO 8601形式
    updated_at TEXT NOT NULL,       -- ISO 8601形式
    
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
```

### ER図 / Entity Relationship Diagram

```
┌─────────────┐
│  meetings   │
│─────────────│
│ id (PK)     │───┐
│ title       │   │
│ created_at  │   │
│ updated_at  │   │
└─────────────┘   │
                  │ 1:N
     ┌────────────┼────────────┬──────────────┐
     │            │            │              │
     ↓            ↓            ↓              ↓
┌──────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌─────────────────┐
│ transcripts  │ │ summary_processes│ │transcript_chunks │ │ meeting_notes   │
│──────────────│ │──────────────────│ │──────────────────│ │─────────────────│
│ id (PK)      │ │ meeting_id (PK)  │ │ meeting_id (PK)  │ │ meeting_id (PK) │
│ meeting_id   │ │ status           │ │ transcript_text  │ │ notes           │
│ transcript   │ │ result           │ │ model            │ │ created_at      │
│ timestamp    │ │ error            │ │ chunk_size       │ │ updated_at      │
│ speaker      │ │ processing_time  │ │ created_at       │ └─────────────────┘
│ audio_*      │ │ ...              │ └──────────────────┘
└──────────────┘ └──────────────────┘

┌─────────────────────┐
│      settings       │
│─────────────────────│
│ id (PK)             │  (Singleton: id='1')
│ provider            │
│ model               │
│ whisperModel        │
│ *ApiKey             │
└─────────────────────┘

┌─────────────────────────┐
│  transcript_settings    │
│─────────────────────────│
│ id (PK)                 │  (Singleton: id='1')
│ provider                │
│ model                   │
│ *ApiKey                 │
└─────────────────────────┘
```

## Backend Database (FastAPI)

BackendはFrontendのデータベースと同じスキーマを使用しますが、独立したSQLiteファイルを持つ可能性があります。

**保存場所**: `backend/meetily.db` (設定で変更可能)

## データベース操作 / Database Operations

### Rust (Frontend)

```rust
// DatabaseManagerを使用
use crate::database::manager::DatabaseManager;

// 会議作成
let db = DatabaseManager::new().await?;
let meeting = db.create_meeting("Team Standup").await?;

// トランスクリプト追加
db.add_transcript(&meeting.id, "こんにちは", Utc::now()).await?;

// 会議削除 (カスケード)
db.delete_meeting(&meeting.id).await?;
```

### Python (Backend)

```python
# DatabaseManagerを使用
from db import DatabaseManager

db = DatabaseManager()

# 会議取得
meetings = await db.get_all_meetings()

# トランスクリプト保存
await db.save_transcript(meeting_id, transcript_text)
```

## マイグレーション履歴 / Migration History

| 日付 | ファイル | 内容 |
|------|---------|------|
| 2025-09-16 | 20250916100000_initial_schema.sql | 初期スキーマ作成 |
| 2025-09-20 | 20250920155811_add_openrouter_api_key.sql | OpenRouter APIキー追加 |
| 2025-10-06 | 20251006000000_add_audio_sync_fields.sql | 音声同期フィールド追加 |
| 2025-10-10 | 20251010153942_add_ollama_endpoint.sql | Ollamaエンドポイント追加 |
| 2025-11-01 | 20251101000000_add_summary_backup.sql | 要約バックアップ追加 |
| 2025-11-05 | 20251105120000_add_pro_license_custom_openai.sql | Pro License設定追加 |
| 2025-11-10 | 20251110000000_add_grace_period_to_licensing.sql | ライセンス猶予期間追加 |
| 2025-11-10 | 20251110000001_add_speaker_field.sql | 話者フィールド追加 |
| 2025-12-23 | 20251223000000_add_meeting_notes.sql | 会議メモテーブル追加 |
| 2025-12-29 | 20251229000000_add_gemini_api_key.sql | Gemini APIキー追加 |

## バックアップとリカバリ / Backup and Recovery

### 手動バックアップ:
```bash
# macOS
cp ~/Library/Application\ Support/Meetily/meetily.db ~/backups/

# Windows
copy %APPDATA%\Meetily\meetily.db C:\backups\
```

### リストア:
```bash
# macOS
cp ~/backups/meetily.db ~/Library/Application\ Support/Meetily/

# Windows
copy C:\backups\meetily.db %APPDATA%\Meetily\
```

## パフォーマンス考慮事項 / Performance Considerations

1. **インデックス**: 現在はPKとFKのみ。将来的にクエリパフォーマンス改善のために追加予定。
2. **トランザクション**: すべての書き込み操作は暗黙的なトランザクションで保護。
3. **接続プーリング**: sqlx経由で自動管理。
4. **カスケード削除**: 会議削除時に関連データを自動削除。

## 参考リンク / References

- [frontend/src-tauri/migrations/](../../../frontend/src-tauri/migrations/) - マイグレーションファイル
- [frontend/src-tauri/src/database/](../../../frontend/src-tauri/src/database/) - Database Manager実装
- [backend/app/db.py](../../../backend/app/db.py) - Backend Database Manager
