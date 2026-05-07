# Meetily 技術仕様書 / Technical Specifications

## 概要 / Overview

このディレクトリには、Meetilyプロジェクトのシステムアーキテクチャ、データベーススキーマ、API仕様、および実装詳細に関する包括的なドキュメントが含まれています。

This directory contains comprehensive documentation about the Meetily project's system architecture, database schema, API specifications, and implementation details.

## ドキュメント一覧 / Document Index

### 1. [システムアーキテクチャ / System Architecture](./01_system_architecture.md)

Meetilyの全体的なシステム設計、3層アーキテクチャ、コンポーネント構成、データフロー、プラットフォーム対応について説明します。

- 3層アーキテクチャ (Frontend/Backend/Whisper)
- 技術スタック詳細
- プラットフォーム別実装 (macOS/Windows/Linux)
- Tauri IPC通信プロトコル
- セキュリティモデル

**対象読者**: アーキテクト、新規参加者、システム全体を理解したい開発者

### 2. [データベーススキーマ / Database Schema](./02_database_schema.md)

SQLiteデータベースの詳細なスキーマ定義、テーブル構造、リレーションシップ、マイグレーション履歴を提供します。

- すべてのテーブル定義 (meetings, transcripts, settings等)
- ER図とリレーションシップ
- マイグレーション履歴
- データベース操作例 (Rust/Python)
- バックアップとリカバリ

**対象読者**: バックエンド開発者、データベース管理者、データモデルを理解したい開発者

### 3. [API仕様 / API Specification](./03_api_specification.md)

Tauri CommandsとREST APIの完全な仕様、リクエスト/レスポンス形式、エラーハンドリングを文書化します。

- Tauri Commands (Frontend ↔ Rust)
  - 録音コマンド
  - デバイス管理コマンド
  - データベースコマンド
  - Whisperコマンド
- REST API (FastAPI)
  - 会議管理エンドポイント
  - 要約エンドポイント
  - 設定エンドポイント
- Tauri Events (リアルタイム通知)

**対象読者**: フロントエンド開発者、API統合担当者、バックエンド開発者

### 4. [音声処理パイプライン / Audio Processing Pipeline](./04_audio_pipeline.md)

音声キャプチャ、ミキシング、VAD (Voice Activity Detection)、Whisper統合の詳細な技術仕様を説明します。

- 二重パス設計 (Recording/Transcription)
- プロフェッショナル音声ミキシング (RMS-based ducking)
- VADアルゴリズム
- プラットフォーム別音声キャプチャ
- パフォーマンス最適化
- トラブルシューティング

**対象読者**: 音声処理エンジニア、パフォーマンスチューニング担当者、音声機能を理解したい開発者

### 5. [ビルドとデプロイメント / Build and Deployment](./05_build_deployment.md)

開発環境のセットアップ、ビルドプロセス、GPU加速設定、デプロイメント手順を詳述します。

- プラットフォーム別セットアップ (macOS/Windows/Linux)
- 開発ビルド vs 本番ビルド
- GPU加速設定 (Metal/CUDA/Vulkan)
- Dockerビルド
- Whisperモデル管理
- CI/CD設定
- トラブルシューティング

**対象読者**: DevOps、ビルドエンジニア、新規開発者

## クイックスタート / Quick Start

### 開発環境のセットアップ

```bash
# 1. リポジトリクローン
git clone https://github.com/kobayashi-shuto-0105/meetily-live-viewer.git
cd meetily-live-viewer

# 2. フロントエンド起動
cd frontend
pnpm install
pnpm run tauri:dev

# 3. バックエンド起動 (別ターミナル)
cd backend
./clean_start_backend.sh  # macOS/Linux
```

詳細は [05_build_deployment.md](./05_build_deployment.md) を参照してください。

### 主要コマンド

```bash
# フロントエンド開発
cd frontend
./clean_run.sh              # クリーンビルド + 実行 (macOS/Linux)
clean_run_windows.bat       # クリーンビルド + 実行 (Windows)

# バックエンド開発
cd backend
./clean_start_backend.sh    # サーバー起動 (macOS/Linux)
clean_start_backend.cmd     # サーバー起動 (Windows)

# Dockerで起動
cd backend
./run-docker.sh start --interactive
```

## アーキテクチャ概要図 / Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (Tauri Desktop App)                  │
│  ┌──────────────────┐  ┌─────────────────┐  ┌────────────────┐ │
│  │   Next.js UI     │  │  Rust Backend   │  │ Whisper Engine │ │
│  │  (React/TS)      │←→│  (Audio + IPC)  │←→│  (Local STT)   │ │
│  └──────────────────┘  └─────────────────┘  └────────────────┘ │
│         ↑ Tauri Events           ↑ Audio Pipeline               │
└─────────┼────────────────────────┼─────────────────────────────┘
          │ HTTP/REST API          │
          ↓                        │
┌─────────────────────────────────┼─────────────────────────────┐
│              Backend (FastAPI)  │                              │
│  ┌────────────┐  ┌─────────────┴──────┐  ┌────────────────┐  │
│  │   SQLite   │←→│  Meeting Manager   │←→│  LLM Provider  │  │
│  │ (Meetings) │  │  (CRUD + Summary)  │  │ (Ollama/etc.)  │  │
│  └────────────┘  └────────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 技術スタック / Technology Stack

### Frontend
- **Desktop**: Tauri 2.x (Rust)
- **UI**: Next.js 14 + React 18 + TypeScript
- **Audio**: cpal, whisper-rs
- **Database**: SQLite (sqlx)

### Backend
- **API**: FastAPI (Python 3.9+)
- **Database**: SQLite (aiosqlite)
- **LLM**: Ollama, Claude, OpenAI, Groq

### Infrastructure
- **Transcription**: Whisper.cpp (GPU-accelerated)
- **Build**: Cargo (Rust), pnpm (Node.js), Docker
- **CI/CD**: GitHub Actions

## 主要な設計原則 / Key Design Principles

1. **プライバシー優先**: すべての処理をローカルで完結
2. **プラットフォーム対応**: macOS/Windows/Linux をサポート
3. **パフォーマンス**: GPU加速、バッファプール、VADフィルタリング
4. **モジュラー設計**: 疎結合なコンポーネント構成
5. **開発者体験**: 詳細なログ、デバッグツール、ドキュメント

## 関連ドキュメント / Related Documentation

### プロジェクトルート
- [README.md](../../../README.md) - プロジェクト概要
- [CLAUDE.md](../../../CLAUDE.md) - 開発者ガイド (Claude Code向け)
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) - コントリビューションガイド

### フロントエンド
- [frontend/README.md](../../../frontend/README.md) - フロントエンド概要
- [frontend/src-tauri/migrations/](../../../frontend/src-tauri/migrations/) - データベースマイグレーション

### バックエンド
- [backend/README.md](../../../backend/README.md) - バックエンド概要
- [backend/API_DOCUMENTATION.md](../../../backend/API_DOCUMENTATION.md) - API詳細ドキュメント
- [backend/SCRIPTS_DOCUMENTATION.md](../../../backend/SCRIPTS_DOCUMENTATION.md) - スクリプトドキュメント

### 追加ドキュメント
- [docs/AUDIO_MODULARIZATION_PLAN.md](../../../docs/AUDIO_MODULARIZATION_PLAN.md) - 音声モジュール化計画

## 貢献 / Contributing

ドキュメントの改善提案や誤りの修正は、以下の手順でお願いします:

1. Issue作成: 変更内容を説明
2. プルリクエスト作成
3. レビュー待ち

詳細は [CONTRIBUTING.md](../../../CONTRIBUTING.md) を参照してください。

## サポート / Support

質問や問題がある場合:

1. [GitHub Issues](https://github.com/kobayashi-shuto-0105/meetily-live-viewer/issues) で検索
2. 既存のIssueがなければ新規作成
3. ディスカッションに参加

## ライセンス / License

このプロジェクトはMITライセンスの下で公開されています。詳細は [LICENSE.md](../../../LICENSE.md) を参照してください。

---

**最終更新 / Last Updated**: 2026-05-07

**バージョン / Version**: 0.3.0

**メンテナ / Maintainer**: Meetily Development Team
