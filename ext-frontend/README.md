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
| `VITE_MEETILY_API_BASE` | Meetily API ベース URL | 同一オリジン |
| `VITE_MEETILY_WS_URL` | WebSocket 接続先 | 同一オリジンの `/ws` |
| `VITE_MEETILY_ACCESS_TOKEN` | 認証トークン | *(なし)* |

## 前提条件

- Meetily デスクトップアプリが起動していること（External Web UI サーバーが `38391` ポートで待機）
- production build ではこのUIがMeetilyアプリに同梱され、`http://<Meetily-PC-IP>:38391/` から直接配信される
- トークン認証を有効にする場合は、デスクトップアプリ側で `MEETILY_EXT_TOKEN` を設定し、ブラウザで `http://<Meetily-PC-IP>:38391/?token=<トークン>` にアクセスする（未設定の場合は認証なしでアクセス可能）

## LAN 経由でのアクセス

デスクトップアプリはデフォルトで `0.0.0.0:38391` にバインドするため、同一ネットワーク内の他のデバイスからアクセスできます。

1. 疎通確認: 外部デバイスのブラウザから `http://<Meetily-PC-IP>:38391/health` にアクセスする（認証不要）
2. UI を開く: `http://<Meetily-PC-IP>:38391/`
3. トークン認証を使う場合: `http://<Meetily-PC-IP>:38391/?token=<トークン>`

固定トークンを使いたい場合は、デスクトップアプリ起動前に環境変数 `MEETILY_EXT_TOKEN` を設定してください。
