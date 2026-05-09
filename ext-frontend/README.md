# Meetily External Web UI

Meetily のリアルタイム文字起こしを外部ブラウザから閲覧・編集するための Web UI。

## 技術スタック

- **Vite** + **React 19** + **TypeScript**
- **Zustand** - 状態管理
- **Zod** - ランタイム型検証

## セットアップ

```bash
# 依存パッケージのインストール
pnpm install

# 環境変数ファイルを作成
cp .env.example .env

# 開発サーバー起動（http://localhost:5173）
pnpm dev

# LAN 公開時
pnpm dev -- --host 0.0.0.0
```

## 環境変数

| 変数名 | 説明 | デフォルト値 |
|---|---|---|
| `VITE_MEETILY_API_BASE` | Meetily API ベース URL | `http://127.0.0.1:38391` |
| `VITE_MEETILY_WS_URL` | WebSocket 接続先 | `ws://127.0.0.1:38391/ws` |
| `VITE_MEETILY_ACCESS_TOKEN` | 認証トークン | `dev-token` |

## 前提条件

- Meetily デスクトップアプリが起動していること（External Web UI サーバーが `38391` ポートで待機）
- トークンが Meetily 側の `MEETILY_EXT_TOKEN` と一致していること
