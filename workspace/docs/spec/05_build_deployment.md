# ビルドとデプロイメント / Build and Deployment

## 概要 / Overview

Meetilyのビルドとデプロイメントプロセスには、フロントエンド (Tauri)、バックエンド (FastAPI)、Whisperサーバーの3つのコンポーネントが含まれます。

## 前提条件 / Prerequisites

### すべてのプラットフォーム共通

#### Rust
```bash
# rustup のインストール
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# バージョン確認
rustc --version  # 1.77以降必須
```

#### Node.js と pnpm
```bash
# Node.js 18+ のインストール (nvm推奨)
nvm install 18
nvm use 18

# pnpm のインストール
npm install -g pnpm

# バージョン確認
node --version  # v18以降
pnpm --version  # 8以降
```

#### Python
```bash
# Python 3.9+ のインストール
python3 --version  # 3.9以降必須

# 仮想環境作成 (推奨)
python3 -m venv venv
source venv/bin/activate  # macOS/Linux
venv\Scripts\activate     # Windows
```

### macOS

#### Xcode Command Line Tools
```bash
xcode-select --install
```

#### Homebrew (推奨)
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

#### BlackHole (システム音声キャプチャ用)
```bash
brew install blackhole-2ch
```

### Windows

#### Visual Studio Build Tools
```powershell
# Visual Studio 2022 Build Tools をインストール
# https://visualstudio.microsoft.com/downloads/

# C++ ビルドツール をチェック
# - MSVC v143 - VS 2022 C++ x64/x86 build tools
# - Windows 10/11 SDK
```

#### CMake
```powershell
# Chocolatey 経由でインストール
choco install cmake

# または公式サイトからダウンロード
# https://cmake.org/download/
```

### Linux

#### 必須パッケージ
```bash
# Debian/Ubuntu
sudo apt-get update
sudo apt-get install -y \
    build-essential \
    cmake \
    pkg-config \
    libssl-dev \
    libasound2-dev \
    libpulse-dev \
    libgtk-3-dev \
    libwebkit2gtk-4.0-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev

# Fedora/RHEL
sudo dnf install -y \
    gcc-c++ \
    cmake \
    openssl-devel \
    alsa-lib-devel \
    pulseaudio-libs-devel \
    gtk3-devel \
    webkit2gtk4.0-devel \
    libappindicator-gtk3-devel \
    librsvg2-devel
```

## フロントエンド (Tauri) ビルド

### 開発ビルド / Development Build

#### macOS/Linux
```bash
cd frontend

# 依存関係インストール
pnpm install

# クリーンビルド + 実行
./clean_run.sh

# デバッグログ有効
./clean_run.sh debug

# GPU指定ビルド
pnpm run tauri:dev:metal    # Metal GPU (macOS)
pnpm run tauri:dev:cpu      # CPU only
```

#### Windows
```powershell
cd frontend

# 依存関係インストール
pnpm install

# クリーンビルド + 実行
.\clean_run_windows.bat

# 手動実行
pnpm run tauri:dev
```

### プロダクションビルド / Production Build

#### macOS
```bash
cd frontend

# クリーンビルド (Metal GPU有効)
./clean_build.sh

# 出力先
# target/release/bundle/dmg/Meetily_0.3.0_x64.dmg
# target/release/bundle/macos/Meetily.app
```

**署名とノータリゼーション** (配布時):
```bash
# Apple Developer IDで署名
codesign --force --deep --sign "Developer ID Application: Your Name" \
    target/release/bundle/macos/Meetily.app

# ノータリゼーション
xcrun notarytool submit target/release/bundle/dmg/Meetily_0.3.0_x64.dmg \
    --apple-id "your@email.com" \
    --password "app-specific-password" \
    --team-id "TEAM_ID"
```

#### Windows
```powershell
cd frontend

# クリーンビルド (CPU + OpenBLAS)
.\clean_build_windows.bat

# NVIDIA GPU ビルド
cargo build --release --features cuda

# AMD/Intel GPU ビルド
cargo build --release --features vulkan

# 出力先
# target/release/bundle/msi/Meetily_0.3.0_x64_en-US.msi
# target/release/Meetily.exe
```

**署名** (配布時):
```powershell
# コード署名証明書で署名
signtool sign /f certificate.pfx /p password /tr http://timestamp.digicert.com /td sha256 /fd sha256 target/release/Meetily.exe
```

#### Linux
```bash
cd frontend

# ビルド
pnpm run tauri:build

# NVIDIA GPU ビルド
cargo build --release --features cuda

# AMD GPU ビルド (ROCm)
cargo build --release --features hipblas

# Vulkan GPU ビルド
cargo build --release --features vulkan

# 出力先
# target/release/bundle/deb/meetily_0.3.0_amd64.deb  # Debian/Ubuntu
# target/release/bundle/rpm/meetily-0.3.0.x86_64.rpm  # Fedora/RHEL
# target/release/bundle/appimage/meetily_0.3.0_amd64.AppImage
```

### GPU加速設定 / GPU Acceleration

#### macOS
```toml
# Cargo.toml (自動設定)
[features]
default = ["platform-default"]
platform-default = ["metal", "coreml"]
```

Metal + CoreMLは自動で有効化されます。

#### Windows
```bash
# NVIDIA GPU (CUDA)
cargo build --release --features cuda

# AMD/Intel GPU (Vulkan)
cargo build --release --features vulkan

# CPU only (フォールバック)
cargo build --release
```

**CUDA要件**:
- CUDA Toolkit 11.8以降
- NVIDIA Driver 520以降
- NVIDIA GPU (Compute Capability 3.5以降)

**Vulkan要件**:
- Vulkan SDK
- 対応GPU (AMD/Intel/NVIDIA)

#### Linux
```bash
# NVIDIA GPU (CUDA)
cargo build --release --features cuda

# AMD GPU (ROCm)
cargo build --release --features hipblas

# Vulkan
cargo build --release --features vulkan

# CPU only
cargo build --release
```

## バックエンド (FastAPI) ビルド

### 開発環境 / Development

```bash
cd backend

# 仮想環境作成
python3 -m venv venv
source venv/bin/activate  # macOS/Linux
venv\Scripts\activate     # Windows

# 依存関係インストール
pip install -r requirements.txt

# Whisperビルド
./build_whisper.sh small      # macOS/Linux
.\build_whisper.cmd small     # Windows

# サーバー起動
./clean_start_backend.sh      # macOS/Linux
.\clean_start_backend.cmd     # Windows

# または
uvicorn app.main:app --reload --port 5167
```

### Docker ビルド / Docker Build

#### CPU版
```bash
cd backend

# ビルド
docker build -f Dockerfile.server-cpu -t meetily-backend:cpu .

# 実行
docker run -p 5167:5167 -p 8178:8178 meetily-backend:cpu
```

#### GPU版 (NVIDIA)
```bash
# ビルド
docker build -f Dockerfile.server-gpu -t meetily-backend:gpu .

# 実行 (CUDA必須)
docker run --gpus all -p 5167:5167 -p 8178:8178 meetily-backend:gpu
```

#### macOS版
```bash
# ビルド (Metal GPU)
docker build -f Dockerfile.server-macos -t meetily-backend:macos .

# 実行
docker run -p 5167:5167 -p 8178:8178 meetily-backend:macos
```

### Docker Compose

```bash
cd backend

# インタラクティブセットアップ
./run-docker.sh start --interactive   # macOS/Linux
.\run-docker.ps1 start -Interactive   # Windows

# サービス起動
docker-compose up -d

# ログ確認
./run-docker.sh logs --service app
docker-compose logs -f app

# サービス停止
docker-compose down
```

## Whisperモデル管理 / Whisper Model Management

### モデルダウンロード

```bash
cd backend

# macOS/Linux
./download-ggml-model.sh small

# Windows
.\download-ggml-model.cmd small
```

**利用可能なモデル**:
- `tiny` (75 MB) - 最速、低精度
- `tiny.en` (75 MB) - 英語専用
- `base` (142 MB) - 高速、中精度
- `base.en` (142 MB) - 英語専用
- `small` (466 MB) - 推奨、中-高精度
- `small.en` (466 MB) - 英語専用
- `medium` (1.5 GB) - 高精度
- `medium.en` (1.5 GB) - 英語専用
- `large-v1` (2.9 GB) - 最高精度
- `large-v2` (2.9 GB) - 最高精度
- `large-v3` (2.9 GB) - 最高精度 (最新)
- `large-v3-turbo` (809 MB) - 高速、高精度

### モデル保存場所

**開発時**:
- `frontend/models/`
- `backend/whisper-server-package/models/`

**本番環境**:
- macOS: `~/Library/Application Support/Meetily/models/`
- Windows: `%APPDATA%\Meetily\models\`
- Linux: `~/.local/share/Meetily/models/`

## デプロイメント / Deployment

### デスクトップアプリ配布

#### macOS
```bash
# DMGファイル配布
# target/release/bundle/dmg/Meetily_0.3.0_x64.dmg

# Homebrew Cask (推奨)
# brew install --cask meetily
```

#### Windows
```powershell
# MSIインストーラー配布
# target/release/bundle/msi/Meetily_0.3.0_x64_en-US.msi

# Chocolatey (推奨)
# choco install meetily
```

#### Linux
```bash
# DEBパッケージ (Debian/Ubuntu)
sudo dpkg -i target/release/bundle/deb/meetily_0.3.0_amd64.deb

# RPMパッケージ (Fedora/RHEL)
sudo rpm -i target/release/bundle/rpm/meetily-0.3.0.x86_64.rpm

# AppImage
chmod +x target/release/bundle/appimage/meetily_0.3.0_amd64.AppImage
./target/release/bundle/appimage/meetily_0.3.0_amd64.AppImage
```

### バックエンドサーバー配布

#### Docker Hub
```bash
# タグ付け
docker tag meetily-backend:latest your-dockerhub-user/meetily-backend:0.3.0

# プッシュ
docker push your-dockerhub-user/meetily-backend:0.3.0

# プル & 実行
docker pull your-dockerhub-user/meetily-backend:0.3.0
docker run -p 5167:5167 your-dockerhub-user/meetily-backend:0.3.0
```

#### Kubernetes
```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: meetily-backend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: meetily-backend
  template:
    metadata:
      labels:
        app: meetily-backend
    spec:
      containers:
      - name: backend
        image: your-dockerhub-user/meetily-backend:0.3.0
        ports:
        - containerPort: 5167
        - containerPort: 8178
        env:
        - name: DATABASE_PATH
          value: "/data/meetily.db"
        volumeMounts:
        - name: data
          mountPath: /data
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: meetily-data
```

## 環境変数 / Environment Variables

### フロントエンド (Tauri)

```bash
# ログレベル
RUST_LOG=debug              # debug, info, warn, error
RUST_LOG=app_lib::audio=debug  # モジュール別

# GPU設定
CUDA_VISIBLE_DEVICES=0      # 使用するGPU ID
```

### バックエンド (FastAPI)

```bash
# データベース
DATABASE_PATH=/path/to/meetily.db

# ポート
PORT=5167
WHISPER_PORT=8178

# LLM API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...

# ログレベル
LOG_LEVEL=INFO              # DEBUG, INFO, WARNING, ERROR
```

## トラブルシューティング / Troubleshooting

### ビルドエラー

#### "rustc version too old"
```bash
rustup update
rustc --version  # 1.77以降を確認
```

#### "pnpm: command not found"
```bash
npm install -g pnpm
```

#### "CUDA not found" (Windows/Linux)
```bash
# CUDA Toolkit インストール
# https://developer.nvidia.com/cuda-downloads

# 環境変数確認
echo $CUDA_HOME  # /usr/local/cuda
```

#### "Metal not found" (macOS)
```bash
# Xcode Command Line Tools インストール
xcode-select --install
```

### 実行時エラー

#### "Permission denied" (macOS)
```bash
# マイク権限
システム環境設定 → セキュリティとプライバシー → マイク → Meetily ✓

# 画面録画権限 (システム音声用)
システム環境設定 → セキュリティとプライバシー → 画面録画 → Meetily ✓
```

#### "BlackHole not found" (macOS)
```bash
# BlackHole インストール
brew install blackhole-2ch

# Audio MIDI設定で確認
open /System/Applications/Utilities/Audio\ MIDI\ Setup.app
```

#### "Port 5167 already in use"
```bash
# 使用中のポートを確認
lsof -i :5167  # macOS/Linux
netstat -ano | findstr :5167  # Windows

# プロセスを終了
kill -9 <PID>  # macOS/Linux
taskkill /PID <PID> /F  # Windows
```

## 継続的インテグレーション / Continuous Integration

### GitHub Actions

```yaml
# .github/workflows/build.yml
name: Build

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-tauri:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Rust
        uses: actions-rust-lang/setup-rust-toolchain@v1
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: 18
      
      - name: Install pnpm
        run: npm install -g pnpm
      
      - name: Build
        run: |
          cd frontend
          pnpm install
          pnpm run tauri:build
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: meetily-${{ matrix.os }}
          path: frontend/target/release/bundle/
```

## パフォーマンスベンチマーク / Performance Benchmarks

### ビルド時間 (参考)

| プラットフォーム | Debug | Release |
|------------------|-------|---------|
| macOS M1 | 2-3分 | 5-7分 |
| Windows (CUDA) | 3-4分 | 8-10分 |
| Linux (CPU) | 2-3分 | 6-8分 |

### バイナリサイズ

| プラットフォーム | サイズ |
|------------------|--------|
| macOS (DMG) | 80-100 MB |
| Windows (MSI) | 70-90 MB |
| Linux (AppImage) | 90-110 MB |

## 参考リンク / References

- [Tauri Documentation](https://tauri.app/v1/guides/)
- [Rust Installation](https://www.rust-lang.org/tools/install)
- [pnpm Documentation](https://pnpm.io/)
- [Docker Documentation](https://docs.docker.com/)
- [Whisper.cpp](https://github.com/ggerganov/whisper.cpp)
