# Meetily Live Viewer (Fork)

> **本リポジトリは [Zackriya-Solutions/meeting-minutes (Meetily)](https://github.com/Zackriya-Solutions/meeting-minutes) の fork です。**
> Meetily 本体の機能・インストール方法・アーキテクチャについては [本家の README](https://github.com/Zackriya-Solutions/meeting-minutes#readme) を参照してください。

## このフォークで追加された機能

### 🌐 External Web UI（外部ブラウザ閲覧・編集）

Meetily デスクトップアプリで録音・文字起こし中の内容を、**同一ネットワーク内の別 PC やタブレットのブラウザ**からリアルタイムで閲覧・編集できる Web UI を追加しました。

**主な機能:**
- **リアルタイム文字起こし閲覧** – WebSocket で即座に反映
- **文字起こし修正（リビジョン）** – 誤認識のテキストを外部から修正
- **コメント追加** – セグメントへのメモ・コメント
- **ハイライト** – 重要な発言にマーク
- **セクション管理** – 議題ごとにセクションを作成・編集
- **トークン認証** – セキュアなアクセス制御

#### しくみ

```
┌──────────────────────────────────┐        ┌──────────────────────────┐
│   Meetily デスクトップアプリ      │        │   外部 Web UI            │
│   (Tauri + Rust + Next.js)       │        │   (Vite + React)         │
│                                  │        │                          │
│   ┌──────────────────────┐       │  HTTP  │   ブラウザで             │
│   │  External Web Server │◄──────┼────────┤   閲覧・編集            │
│   │  (axum, port 38391)  │       │   WS   │                          │
│   └──────────────────────┘       │        │   ext-frontend/          │
└──────────────────────────────────┘        └──────────────────────────┘
```

- デスクトップアプリ起動時に **axum ベースの HTTP/WebSocket サーバー**が自動起動（ポート `38391`）
- デフォルトで `0.0.0.0` にバインドするため、LAN 内の他デバイスからアクセス可能
- アクセストークンは起動時に自動生成され、アプリのログに表示される

---

## セットアップ・ビルド手順

### 前提条件

- **Node.js** >= 20.x
- **pnpm** (推奨パッケージマネージャ)
- **Rust** (stable, 1.77+)
- **CMake**
- プラットフォーム固有の依存:
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio Build Tools (C++ ワークロード)
  - **Linux**: `build-essential cmake git` ([詳細](docs/building_in_linux.md))

### 開発モード

開発時はホットリロードが有効です。

```bash
# 1. リポジトリのクローン
git clone https://github.com/kobayashi-shuto-0105/meetily-live-viewer.git
cd meetily-live-viewer

# 2. フロントエンド依存のインストール
cd frontend
pnpm install

# 3. 開発モードで起動（GPU 自動検出）
./dev-gpu.sh          # macOS / Linux
# または
.\dev-gpu.ps1         # Windows PowerShell

# 手動で GPU を指定する場合:
TAURI_GPU_FEATURE=metal ./dev-gpu.sh    # macOS Metal
TAURI_GPU_FEATURE=cuda  ./dev-gpu.sh    # NVIDIA CUDA
TAURI_GPU_FEATURE=vulkan ./dev-gpu.sh   # Vulkan
TAURI_GPU_FEATURE="" ./dev-gpu.sh       # CPU のみ
```

> **補足:** `dev-gpu.sh` は以下を自動で行います:
> 1. GPU の自動検出（`scripts/auto-detect-gpu.js`）
> 2. `llama-helper` サイドカーバイナリのビルド
> 3. `pnpm tauri:dev` の実行（Next.js dev server + Tauri）

デスクトップアプリが起動すると、External Web UI サーバーも自動的に `0.0.0.0:38391` で待機開始します。

### プロダクションビルド

```bash
cd frontend

# GPU 自動検出でプロダクションビルド
./build-gpu.sh          # macOS / Linux
# または
.\build-gpu.ps1         # Windows PowerShell

# 手動で GPU を指定する場合:
TAURI_GPU_FEATURE=metal ./build-gpu.sh    # macOS Metal
TAURI_GPU_FEATURE=cuda  ./build-gpu.sh    # NVIDIA CUDA
```

ビルド成果物の場所:

| OS | 出力先 |
|---|---|
| macOS | `frontend/src-tauri/target/release/bundle/dmg/meetily_*.dmg` |
| Windows | `frontend/src-tauri/target/release/bundle/nsis/meetily_*-setup.exe` |
| Linux | `frontend/src-tauri/target/release/bundle/appimage/meetily_*.AppImage` |

> **プロダクションビルドでも** External Web UI サーバーは自動起動します。`ext-frontend` の production build もアプリに同梱されるため、追加の Vite dev server は不要です。

### External Web UI（ext-frontend）の開発

外部 Web UI の開発サーバーを個別に起動する場合:

```bash
cd ext-frontend
pnpm install
cp .env.example .env    # 必要に応じて編集
pnpm dev                # http://localhost:5173 で起動
```

Vite の dev proxy により、API リクエストは自動的に `http://127.0.0.1:38391` に転送されます。

---

## External Web UI の利用方法

### 同一 PC からアクセス

デスクトップアプリが起動していれば、ブラウザで以下にアクセス:

```
http://localhost:38391/           # External Web UI
http://localhost:38391/health    # 疎通確認
```

トークン認証は**オプション**です。`MEETILY_EXT_TOKEN` を設定しない場合は認証なしでアクセスできます。
LAN で使う場合、同じネットワーク上の端末から文字起こしの閲覧・編集APIにアクセスできるため、信頼できないネットワークでは `MEETILY_EXT_TOKEN` の設定を推奨します。

### LAN 内の別デバイスからアクセス

1. 外部デバイスのブラウザから疎通確認:
   ```
   http://<Meetily-PC-IP>:38391/health
   ```

2. External Web UI にアクセス:
   ```
   http://<Meetily-PC-IP>:38391/
   ```

3. **トークン認証を使いたい場合**は、デスクトップアプリ側でトークンを設定して起動し、ブラウザURLにも同じトークンを付ける:
   ```bash
   # デスクトップアプリ起動時
   MEETILY_EXT_TOKEN=your-secret-token /Applications/meetily.app/Contents/MacOS/meetily
   ```
   ブラウザ:
   ```
   http://<Meetily-PC-IP>:38391/?token=your-secret-token
   ```

### 環境変数

| 変数名 | 説明 | デフォルト値 |
|---|---|---|
| `MEETILY_EXT_BIND` | サーバーバインドアドレス | `0.0.0.0:38391` |
| `MEETILY_EXT_TOKEN` | アクセストークン（未設定時は認証なし） | *(なし)* |
| `MEETILY_EXT_UI_DIR` | 同梱UIの代わりに配信する静的ファイルディレクトリ（開発/検証用） | *(同梱リソース)* |
| `MEETILY_EXT_CORS_PERMISSIVE` | `true` の場合のみ permissive CORS を有効化（開発用） | *(無効)* |

---

## API エンドポイント

| メソッド | パス | 説明 | 認証 |
|---|---|---|---|
| `GET` | `/health` | 疎通確認 | 不要 |
| `WS` | `/ws` | リアルタイム WebSocket 購読 | オプション |
| `GET` | `/api/sessions/current` | 現在の録音セッション | オプション |
| `GET` | `/api/sessions/{id}/transcripts` | セッション内セグメント | オプション |
| `GET` | `/api/sessions/{id}/sections` | セクション一覧 | オプション |
| `POST` | `/api/sessions/{id}/sections` | セクション作成 | オプション |
| `PUT` | `/api/sections/{id}` | セクション更新 | オプション |
| `DELETE` | `/api/sections/{id}` | セクション削除 | オプション |
| `GET` | `/api/meetings/{id}/transcripts` | 保存済み会議の文字起こし | オプション |
| `POST` | `/api/segments/{id}/revisions` | 文字起こし修正 | オプション |
| `POST` | `/api/segments/{id}/comments` | コメント追加 | オプション |
| `POST` | `/api/segments/{id}/highlights` | ハイライト追加 | オプション |
| `DELETE` | `/api/segments/{id}/highlights/{hid}` | ハイライト削除 | オプション |

> **認証「オプション」について:** `MEETILY_EXT_TOKEN` が設定されている場合のみ `?token=xxx` が必要になります。未設定時は全エンドポイントに認証なしでアクセスできます。LAN 公開時は必要に応じて `MEETILY_EXT_TOKEN` を設定してください。

---

## プロジェクト構成

```
meetily-live-viewer/
├── frontend/                 # Tauri デスクトップアプリ (Rust + Next.js)
│   ├── src/                  # Next.js フロントエンド
│   ├── src-tauri/            # Rust バックエンド
│   │   └── src/external_web/ # ← External Web UI サーバー（このフォークで追加）
│   ├── dev-gpu.sh            # 開発ビルドスクリプト
│   └── build-gpu.sh          # プロダクションビルドスクリプト
├── ext-frontend/             # External Web UI (Vite + React) ← このフォークで追加
├── backend/                  # Python FastAPI バックエンド
├── llama-helper/             # LLM サイドカーバイナリ
├── docs/                     # ドキュメント
└── scripts/                  # ユーティリティスクリプト
```

---

## 本家リポジトリ

本家 Meetily の詳細（インストール方法、機能紹介、アーキテクチャ、PRO 版、コントリビューションガイドなど）は以下を参照:

🔗 **[Zackriya-Solutions/meeting-minutes](https://github.com/Zackriya-Solutions/meeting-minutes)**

## ライセンス

MIT License – 本家と同じライセンスです。
