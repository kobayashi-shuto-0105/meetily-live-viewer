# API仕様 / API Specification

## 概要 / Overview

Meetilyは以下の2種類のAPIを提供します:

1. **Tauri Commands**: Frontend (React) ↔ Rust Backend
2. **REST API**: Frontend/Backend ↔ FastAPI Server

## 1. Tauri Commands (IPC API)

### 概要

Tauri CommandsはReactコンポーネントからRust関数を直接呼び出すための仕組みです。

### 呼び出し方法

```typescript
import { invoke } from '@tauri-apps/api/tauri';

// コマンド呼び出し
const result = await invoke<ReturnType>('command_name', {
  param1: 'value1',
  param2: 'value2'
});
```

### 録音関連コマンド / Recording Commands

#### start_recording
会議の録音を開始します。

```typescript
await invoke('start_recording', {
  mic_device_name: string | null,      // マイクデバイス名
  system_device_name: string | null,   // システム音声デバイス名
  meeting_name: string | null          // 会議名
});
```

**戻り値**: `Promise<void>`

**エラー**:
- デバイスが見つからない
- 録音が既に開始されている
- 権限エラー

#### stop_recording
録音を停止します。

```typescript
await invoke('stop_recording');
```

**戻り値**: `Promise<void>`

#### pause_recording
録音を一時停止します。

```typescript
await invoke('pause_recording');
```

**戻り値**: `Promise<void>`

#### resume_recording
録音を再開します。

```typescript
await invoke('resume_recording');
```

**戻り値**: `Promise<void>`

### 音声デバイス関連コマンド / Audio Device Commands

#### list_audio_devices
利用可能な音声デバイスをリストします。

```typescript
const devices = await invoke<{
  input_devices: AudioDevice[];
  output_devices: AudioDevice[];
}>('list_audio_devices');

interface AudioDevice {
  name: string;
  is_default: boolean;
}
```

#### get_default_input_device
デフォルトの入力デバイスを取得します。

```typescript
const device = await invoke<string>('get_default_input_device');
```

#### get_default_output_device
デフォルトの出力デバイスを取得します。

```typescript
const device = await invoke<string>('get_default_output_device');
```

#### trigger_audio_permission
音声権限をリクエストします (macOS)。

```typescript
await invoke('trigger_audio_permission');
```

### Whisper関連コマンド / Whisper Commands

#### load_whisper_model
Whisperモデルをロードします。

```typescript
await invoke('load_whisper_model', {
  model_name: string  // 'tiny', 'base', 'small', 'medium', 'large-v3'
});
```

**戻り値**: `Promise<void>`

**エラー**:
- モデルファイルが見つからない
- GPUメモリ不足

#### unload_whisper_model
Whisperモデルをアンロードします。

```typescript
await invoke('unload_whisper_model');
```

#### get_loaded_whisper_model
現在ロードされているモデル名を取得します。

```typescript
const modelName = await invoke<string | null>('get_loaded_whisper_model');
```

### データベース関連コマンド / Database Commands

#### get_all_meetings
すべての会議を取得します。

```typescript
const meetings = await invoke<Meeting[]>('get_all_meetings');

interface Meeting {
  id: string;
  title: string;
  created_at: string;  // ISO 8601
  updated_at: string;  // ISO 8601
}
```

#### get_meeting_with_transcripts
会議とそのトランスクリプトを取得します。

```typescript
const meeting = await invoke<MeetingWithTranscripts>('get_meeting_with_transcripts', {
  meeting_id: string
});

interface MeetingWithTranscripts {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  transcripts: Transcript[];
}

interface Transcript {
  id: string;
  meeting_id: string;
  transcript: string;
  timestamp: string;
  audio_start_time?: number;
  audio_end_time?: number;
  duration?: number;
  speaker?: string;
}
```

#### delete_meeting
会議を削除します (カスケード)。

```typescript
await invoke('delete_meeting', {
  meeting_id: string
});
```

#### update_meeting_title
会議タイトルを更新します。

```typescript
await invoke('update_meeting_title', {
  meeting_id: string,
  new_title: string
});
```

### 設定関連コマンド / Settings Commands

#### get_settings
LLM設定を取得します。

```typescript
const settings = await invoke<Settings>('get_settings');

interface Settings {
  provider: 'ollama' | 'claude' | 'openai' | 'groq';
  model: string;
  whisperModel: string;
  apiKey?: string;
}
```

#### save_settings
LLM設定を保存します。

```typescript
await invoke('save_settings', {
  settings: Settings
});
```

### Tauri Events (Rust → Frontend)

#### transcript-update
文字起こしの更新を通知します。

```typescript
import { listen } from '@tauri-apps/api/event';

await listen<TranscriptUpdate>('transcript-update', (event) => {
  console.log('Transcript:', event.payload);
});

interface TranscriptUpdate {
  text: string;
  timestamp: string;
  audio_start_time?: number;
  audio_end_time?: number;
  duration?: number;
  speaker?: string;
}
```

#### recording-status
録音状態の変化を通知します。

```typescript
await listen<RecordingStatus>('recording-status', (event) => {
  console.log('Status:', event.payload);
});

interface RecordingStatus {
  is_recording: boolean;
  is_paused: boolean;
  duration: number;  // 秒
}
```

#### audio-level
音声レベルを通知します (60fps)。

```typescript
await listen<AudioLevel>('audio-level', (event) => {
  console.log('Level:', event.payload);
});

interface AudioLevel {
  mic_level: number;      // 0.0 - 1.0
  system_level: number;   // 0.0 - 1.0
}
```

## 2. REST API (FastAPI)

### ベースURL

```
http://localhost:5167
```

### 認証

現在は認証なし (ローカル専用)。

### 会議管理エンドポイント / Meeting Management

#### GET /api/meetings
すべての会議を取得します。

**リクエスト**:
```http
GET /api/meetings HTTP/1.1
Host: localhost:5167
```

**レスポンス**:
```json
{
  "meetings": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Team Standup"
    }
  ]
}
```

#### GET /api/meetings/{meeting_id}
特定の会議とトランスクリプトを取得します。

**リクエスト**:
```http
GET /api/meetings/550e8400-e29b-41d4-a716-446655440000 HTTP/1.1
Host: localhost:5167
```

**レスポンス**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Team Standup",
  "created_at": "2026-05-07T07:00:00Z",
  "updated_at": "2026-05-07T07:30:00Z",
  "transcripts": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "text": "こんにちは、本日の議題は...",
      "timestamp": "2026-05-07T07:05:30Z",
      "audio_start_time": 5.3,
      "audio_end_time": 12.8,
      "duration": 7.5
    }
  ]
}
```

#### POST /api/meetings
新しい会議を作成します。

**リクエスト**:
```http
POST /api/meetings HTTP/1.1
Host: localhost:5167
Content-Type: application/json

{
  "meeting_title": "Team Standup",
  "transcripts": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "text": "こんにちは",
      "timestamp": "2026-05-07T07:05:30Z"
    }
  ],
  "folder_path": "/path/to/meeting/folder"
}
```

**レスポンス**:
```json
{
  "meeting_id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Team Standup"
}
```

#### PUT /api/meetings/title
会議タイトルを更新します。

**リクエスト**:
```http
PUT /api/meetings/title HTTP/1.1
Host: localhost:5167
Content-Type: application/json

{
  "meeting_id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "New Title"
}
```

**レスポンス**:
```json
{
  "success": true
}
```

#### DELETE /api/meetings/{meeting_id}
会議を削除します。

**リクエスト**:
```http
DELETE /api/meetings/550e8400-e29b-41d4-a716-446655440000 HTTP/1.1
Host: localhost:5167
```

**レスポンス**:
```json
{
  "success": true
}
```

### 要約エンドポイント / Summary Endpoints

#### POST /api/summarize
会議を要約します (非同期)。

**リクエスト**:
```http
POST /api/summarize HTTP/1.1
Host: localhost:5167
Content-Type: application/json

{
  "meeting_id": "550e8400-e29b-41d4-a716-446655440000",
  "provider": "claude",
  "model": "claude-3-sonnet-20240229",
  "api_key": "sk-ant-..."
}
```

**レスポンス**:
```json
{
  "meeting_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing"
}
```

#### GET /api/summary/{meeting_id}
要約の状態を取得します。

**リクエスト**:
```http
GET /api/summary/550e8400-e29b-41d4-a716-446655440000 HTTP/1.1
Host: localhost:5167
```

**レスポンス (処理中)**:
```json
{
  "meeting_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "chunk_count": 3,
  "processing_time": 45.2
}
```

**レスポンス (完了)**:
```json
{
  "meeting_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "result": {
    "summary": "会議の要約...",
    "action_items": [
      "タスク1",
      "タスク2"
    ],
    "key_points": [
      "重要ポイント1",
      "重要ポイント2"
    ]
  },
  "processing_time": 135.8
}
```

### 設定エンドポイント / Settings Endpoints

#### GET /api/settings/model
LLMモデル設定を取得します。

**レスポンス**:
```json
{
  "provider": "claude",
  "model": "claude-3-sonnet-20240229",
  "whisperModel": "base"
}
```

#### POST /api/settings/model
LLMモデル設定を保存します。

**リクエスト**:
```http
POST /api/settings/model HTTP/1.1
Host: localhost:5167
Content-Type: application/json

{
  "provider": "claude",
  "model": "claude-3-sonnet-20240229",
  "whisperModel": "base",
  "apiKey": "sk-ant-..."
}
```

**レスポンス**:
```json
{
  "success": true
}
```

### エラーレスポンス / Error Responses

すべてのエラーは以下の形式で返されます:

```json
{
  "detail": "エラーメッセージ"
}
```

**HTTPステータスコード**:
- `400`: リクエストエラー
- `404`: リソースが見つからない
- `500`: サーバーエラー

### CORS設定

開発時はすべてのオリジンを許可:
```python
allow_origins=["*"]
```

本番環境では特定のオリジンに制限することを推奨。

## Swagger UI

APIドキュメントはSwagger UIで確認できます:

```
http://localhost:5167/docs
```

ReDocも利用可能:
```
http://localhost:5167/redoc
```

## WebSocket API (将来実装予定)

リアルタイム更新用のWebSocket APIを計画中:

```
ws://localhost:5167/ws/{meeting_id}
```

## レート制限 / Rate Limiting

現在はレート制限なし (ローカル専用のため)。

## 参考リンク / References

- [backend/API_DOCUMENTATION.md](../../../backend/API_DOCUMENTATION.md) - 詳細なAPI仕様
- [backend/app/main.py](../../../backend/app/main.py) - FastAPI実装
- [frontend/src-tauri/src/lib.rs](../../../frontend/src-tauri/src/lib.rs) - Tauri Commands実装
