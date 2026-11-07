# システムアーキテクチャ / System Architecture

## 概要 / Overview

**Meetily** は、ローカルインフラストラクチャ上で完結するプライバシー重視のAIミーティングアシスタントです。会議を録音・文字起こし・要約する3層アーキテクチャを採用しています。

**Meetily** is a privacy-first AI meeting assistant that captures, transcribes, and summarizes meetings entirely on local infrastructure. It uses a three-tier architecture.

## 主要コンポーネント / Main Components

### 1. Frontend (Tauri Desktop Application)
- **技術スタック**: Tauri 2.x + Next.js 14 + React 18 + TypeScript
- **役割**: デスクトップUI、音声録音、ローカル文字起こし
- **ポート**: 3118 (開発時)

#### フロントエンドの構成要素:
```
Frontend (Tauri Desktop App)
├── Next.js UI (React/TypeScript)
│   ├── ページコンポーネント (src/app/)
│   ├── 再利用可能コンポーネント (src/components/)
│   └── グローバルステート管理 (SidebarProvider)
│
├── Rust Backend (src-tauri/src/)
│   ├── Audio System (audio/)
│   │   ├── デバイス管理 (devices/)
│   │   ├── 音声キャプチャ (capture/)
│   │   ├── 録音マネージャー (recording_manager.rs)
│   │   └── 音声パイプライン (pipeline.rs)
│   │
│   ├── Whisper Engine (whisper_engine/)
│   │   ├── モデル管理 (whisper_engine.rs)
│   │   └── 並列処理 (parallel_processor.rs)
│   │
│   ├── Database (database/)
│   │   ├── マネージャー (manager.rs)
│   │   ├── モデル (models.rs)
│   │   └── リポジトリ (repositories/)
│   │
│   └── LLM統合 (ollama/, anthropic/, openai/, groq/)
│
└── Tauri IPC Bridge
    ├── Tauri Commands (Rust関数)
    └── Tauri Events (Rust → Frontend)
```

### 2. Backend (FastAPI Server)
- **技術スタック**: FastAPI + SQLite (aiosqlite) + Python 3.9+
- **役割**: 会議データ永続化、LLM要約処理
- **ポート**: 5167

#### バックエンドの構成要素:
```
Backend (FastAPI)
├── API Server (app/main.py)
│   ├── CRUD Endpoints
│   ├── 要約エンドポイント
│   └── 設定管理
│
├── Database (SQLite)
│   ├── meetings テーブル
│   ├── transcripts テーブル
│   ├── summary_processes テーブル
│   └── settings テーブル
│
├── Transcript Processor (transcript_processor.py)
│   └── チャンク処理とLLM統合
│
└── Database Manager (db.py)
    └── 非同期DB操作
```

### 3. Whisper Server (Optional)
- **技術スタック**: Whisper.cpp + GPU加速
- **役割**: 高速ローカル文字起こし
- **ポート**: 8178

## 3層アーキテクチャ図 / Three-Tier Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (Tauri Desktop App)                  │
│  ┌──────────────────┐  ┌─────────────────┐  ┌────────────────┐ │
│  │   Next.js UI     │  │  Rust Backend   │  │ Whisper Engine │ │
│  │  (React/TS)      │←→│  (Audio + IPC)  │←→│  (Local STT)   │ │
│  └──────────────────┘  └─────────────────┘  └────────────────┘ │
│         ↑ Tauri Events           ↑ Audio Pipeline               │
└─────────┼────────────────────────┼─────────────────────────────┘
          │ HTTP/WebSocket         │
          ↓                        │
┌─────────────────────────────────┼─────────────────────────────┐
│              Backend (FastAPI)  │                              │
│  ┌────────────┐  ┌─────────────┴──────┐  ┌────────────────┐  │
│  │   SQLite   │←→│  Meeting Manager   │←→│  LLM Provider  │  │
│  │ (Meetings) │  │  (CRUD + Summary)  │  │ (Ollama/etc.)  │  │
│  └────────────┘  └────────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## データフロー / Data Flow

### 録音・文字起こしフロー:
```
1. マイク/システム音声
   ↓
2. Audio Capture (Rust)
   ↓
3. Audio Pipeline Manager
   ├→ Recording Path (録音保存)
   └→ Transcription Path (VADフィルタ)
      ↓
4. Whisper Engine (文字起こし)
   ↓
5. Frontend UI (リアルタイム表示)
   ↓
6. Backend API (永続化)
   ↓
7. SQLite Database
```

### 要約フロー:
```
1. Frontend: 要約リクエスト
   ↓
2. Backend: トランスクリプト取得
   ↓
3. Transcript Processor: チャンク分割
   ↓
4. LLM Provider (Ollama/Claude/etc.)
   ↓
5. Backend: 要約結果保存
   ↓
6. Frontend: 要約表示
```

## プラットフォーム対応 / Platform Support

### macOS
- **音声キャプチャ**: ScreenCaptureKit (macOS 13+)
- **GPU加速**: Metal + CoreML (自動有効化)
- **システム音声**: BlackHole 2ch (仮想音声デバイス)
- **権限**: マイク + 画面録画

### Windows
- **音声キャプチャ**: WASAPI (Windows Audio Session API)
- **GPU加速**: CUDA (NVIDIA) / Vulkan (AMD/Intel)
- **システム音声**: WASAPI loopback
- **ビルドツール**: Visual Studio Build Tools with C++

### Linux
- **音声キャプチャ**: ALSA/PulseAudio
- **GPU加速**: CUDA (NVIDIA) / Vulkan
- **依存関係**: cmake, llvm, libomp

## 通信プロトコル / Communication Protocols

### Tauri IPC (Frontend ↔ Rust)
- **Command Pattern**: Frontend → Rust (同期/非同期関数呼び出し)
- **Event Pattern**: Rust → Frontend (イベント発火・リスニング)

### HTTP REST API (Frontend/Backend)
- **ベースURL**: http://localhost:5167
- **認証**: なし (ローカル専用)
- **フォーマット**: JSON

### WebSocket (オプション)
- **用途**: リアルタイム更新
- **接続先**: Backend API

## セキュリティモデル / Security Model

### プライバシー重視設計:
- ✅ すべての処理がローカルで完結
- ✅ データは外部サーバーに送信されない
- ✅ LLM統合もローカル優先 (Ollama)
- ✅ オプションでクラウドLLM (Claude, OpenAI等)

### データストレージ:
- **開発時**: ローカルSQLiteファイル
- **本番 (macOS)**: `~/Library/Application Support/Meetily/`
- **本番 (Windows)**: `%APPDATA%\Meetily\`

## パフォーマンス最適化 / Performance Optimizations

### 音声処理:
- リングバッファによる非同期音声ミキシング
- VAD (Voice Activity Detection) による不要区間削除
- RMSベースのダッキング (マイク優先)
- バッファプール (`AudioBufferPool`)

### Whisper文字起こし:
- GPU加速 (Metal/CUDA/Vulkan)
- モデルキャッシング
- 並列処理 (`parallel_processor.rs`)

### Frontend:
- React state batching
- トランスクリプトの仮想化レンダリング
- 音声レベル監視の60fps throttling

## 開発環境セットアップ / Development Setup

### 必須ツール:
- **Rust**: 1.77+ (rustup経由)
- **Node.js**: 18+ (pnpm推奨)
- **Python**: 3.9+
- **pnpm**: 8+

### 起動コマンド:
```bash
# Frontend (Tauri)
cd frontend
pnpm install
pnpm run tauri:dev

# Backend (FastAPI)
cd backend
./clean_start_backend.sh  # macOS/Linux
clean_start_backend.cmd   # Windows
```

### ビルドコマンド:
```bash
# Frontend
cd frontend
./clean_build.sh          # macOS/Linux
clean_build_windows.bat   # Windows

# Backend (Docker)
cd backend
./run-docker.sh start --interactive
```

## 参考リンク / References

- [CLAUDE.md](../../../CLAUDE.md) - 詳細な開発ガイド
- [API Documentation](../../../backend/API_DOCUMENTATION.md)
- [Frontend README](../../../frontend/README.md)
- [Backend README](../../../backend/README.md)
