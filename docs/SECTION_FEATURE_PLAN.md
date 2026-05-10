# セクション機能 実装計画

## 概要

文字起こしの External Web UI 上で、セグメント間に**セクション区切り**を挿入できる機能を追加する。
セクションには**タイトル**と**description（説明文）**を設定でき、会議の構造を視覚的に整理できる。

### 参考 UI イメージ

```
    +                          ← ホバーで表示される追加ボタン
  ┌─────────────────────────┐
  │  00:05  I don't see no  │   セグメント
  └─────────────────────────┘
    +                          ← ホバーで表示される追加ボタン
  ╔═════════════════════════╗
  ║  📌 Discussion          ║   ← セクションヘッダー（タイトル + description）
  ║  今日の議題について      ║
  ╚═════════════════════════╝
  ┌─────────────────────────┐
  │  00:10  They be on...   │   セグメント
  └─────────────────────────┘
    +                          ← ホバーで表示される追加ボタン
```

---

## Phase 1: フロントエンド（ローカル状態のみ）

まずバックエンド永続化なしで、フロントエンド側だけでセクション機能を完結させる。

### 1-1. 型定義の追加 (`ext-frontend/src/types.ts`)

```typescript
/** セクション区切りの型定義 */
export interface Section {
  /** 一意の ID（UUID v4） */
  id: string;
  /** セクションタイトル（例: "Discussion", "Opening"） */
  title: string;
  /** セクションの説明（オプション） */
  description: string;
  /** このセクションが挿入される位置（直後のセグメントの sequenceId） */
  beforeSequenceId: number;
  /** 作成日時 */
  createdAt: string;
}
```

**ポイント**: `beforeSequenceId` でセクションの位置を定義する。例えば `beforeSequenceId: 5` なら、`sequenceId=5` のセグメントの直前にセクションヘッダーが表示される。

### 1-2. Store の拡張 (`ext-frontend/src/stores/transcriptStore.ts`)

以下の state と action を追加する:

**State:**
- `sections: Section[]` — セクション一覧
- `sectionEditingId: string | null` — 現在編集中のセクション ID（新規追加時にインラインエディタを表示）

**Actions:**
- `addSection(beforeSequenceId: number, title: string, description: string): void`
  - UUID を生成してセクションを追加
- `updateSection(id: string, title: string, description: string): void`
  - 既存セクションのタイトル・description を更新
- `removeSection(id: string): void`
  - セクションを削除
- `setSectionEditingId(id: string | null): void`
  - インラインエディタの表示/非表示を制御

**Selector:**
- `selectSectionsMap`: `Map<number, Section>` — `beforeSequenceId` → `Section` のマップを返す。TranscriptViewer がセグメント描画時に参照する。

### 1-3. セクション追加ボタン UI (`ext-frontend/src/components/SectionDivider.tsx`)

新コンポーネント: **`SectionInsertButton`**

- **表示位置**: 各セグメントの**上部**（セグメントとセグメントの間の左端）
- **通常状態**: 非表示（`opacity: 0`）
- **ホバー状態**: セグメント間の領域にマウスを乗せると `+` ボタンがフェードイン（`opacity: 1`, `transition: opacity 0.2s`）
- **クリック時**: セクション作成のインラインエディタが展開される

```
  ホバー前:                    ホバー後:
  (何もなし)                   + ← さりげなく表示
  ┌──────────┐                ┌──────────┐
  │ segment  │                │ segment  │
  └──────────┘                └──────────┘
```

### 1-4. セクション作成インラインエディタ (`ext-frontend/src/components/SectionEditor.tsx`)

新コンポーネント: **`SectionEditor`**

`+` ボタンをクリックすると、セグメント間にインラインエディタが展開される:

```
  ┌────────────────────────────────────┐
  │  Title:  [________________]        │
  │  Desc:   [________________]        │
  │            [Save]  [Cancel]        │
  └────────────────────────────────────┘
```

- **Title フィールド**: テキスト入力（必須、プレースホルダー: "Section title"）
- **Description フィールド**: テキストエリア（任意、プレースホルダー: "Description (optional)"）
- **Enter キー**: タイトル入力中に Enter で保存
- **Escape キー**: キャンセル（エディタを閉じる）
- **Save ボタン**: セクションを追加して閉じる
- **Cancel ボタン**: 入力を破棄して閉じる
- オートフォーカス: 展開時にタイトルフィールドにフォーカスを当てる

### 1-5. セクションヘッダー表示 (`ext-frontend/src/components/SectionHeader.tsx`)

新コンポーネント: **`SectionHeader`**

保存済みのセクションを表示するヘッダーコンポーネント:

```
  ╔═══════════════════════════════════╗
  ║  📌 Discussion            ✏️  🗑  ║
  ║  今日の議題について               ║
  ╚═══════════════════════════════════╝
```

- **タイトル**: 太字で大きく表示
- **Description**: タイトルの下に小さめのテキストで表示（空なら非表示）
- **編集ボタン** (✏️): クリックで `SectionEditor` に切り替え（既存のタイトルと description を初期値としてセット）
- **削除ボタン** (🗑): クリックで確認なしに削除（undo は Phase 2 以降）
- デザインはセグメントカードと視覚的に区別できるように、背景色やボーダーを変える

### 1-6. TranscriptViewer の変更 (`ext-frontend/src/components/TranscriptViewer.tsx`)

セグメントのレンダリングループに、セクション挿入ロジックを追加する:

```tsx
segments.map((segment, index) => (
  <React.Fragment key={segment.id}>
    {/* セクション追加ボタン（セグメント上部） */}
    <SectionInsertButton beforeSequenceId={segment.sequenceId} />

    {/* このセグメントの前にセクションがあれば表示 */}
    {sectionsMap.has(segment.sequenceId) && (
      <SectionHeader section={sectionsMap.get(segment.sequenceId)!} />
    )}

    {/* セグメント本体 */}
    <TranscriptSegment segment={segment} />

    {/* 最後のセグメントの後にも追加ボタン */}
    {index === segments.length - 1 && (
      <SectionInsertButton beforeSequenceId={segment.sequenceId + 1} />
    )}
  </React.Fragment>
))
```

### 1-7. CSS スタイリング (`ext-frontend/src/index.css`)

追加するスタイル:

- `.section-insert-zone` — セグメント間のホバー領域（高さ ~24px、透明）
- `.section-insert-btn` — `+` ボタン（ホバーでフェードイン、丸ボタン）
- `.section-editor` — インラインエディタのカードスタイル
- `.section-header` — セクションヘッダーのカードスタイル（アクセントカラー使用）
- ダークテーマ / ライトテーマ両方に対応する CSS variables の追加

---

## Phase 2: バックエンド永続化

Phase 1 完了後、セクションをサーバーサイドに保存する機能を追加する。

### 2-1. DB スキーマ（Rust 側 migration）

```sql
CREATE TABLE IF NOT EXISTS external_transcript_sections (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  meeting_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  before_sequence_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, before_sequence_id)
);
```

### 2-2. REST API エンドポイント（Rust / Tauri 側）

| Method | Path | 説明 |
|--------|------|------|
| `GET` | `/api/sessions/:id/sections` | セッション内の全セクションを取得 |
| `POST` | `/api/sessions/:id/sections` | セクションを新規作成 |
| `PUT` | `/api/sections/:id` | セクションのタイトル・description を更新 |
| `DELETE` | `/api/sections/:id` | セクションを削除 |

### 2-3. WebSocket イベント

新イベント型を追加:

```typescript
| { type: "TranscriptSectionCreated"; payload: TranscriptSectionPayload }
| { type: "TranscriptSectionUpdated"; payload: TranscriptSectionPayload }
| { type: "TranscriptSectionDeleted"; payload: { id: string; session_id: string } }
```

### 2-4. フロントエンド API クライアント拡張

`ext-frontend/src/api/client.ts` に以下メソッドを追加:

- `getSessionSections(sessionId: string): Promise<Section[]>`
- `createSection(sessionId: string, body: CreateSectionRequest): Promise<Section>`
- `updateSection(sectionId: string, body: UpdateSectionRequest): Promise<Section>`
- `deleteSection(sectionId: string): Promise<void>`

### 2-5. Store の API 連携

- `addSection` アクション内で `apiClient.createSection()` を呼ぶ
- `updateSection` アクション内で `apiClient.updateSection()` を呼ぶ
- `removeSection` アクション内で `apiClient.deleteSection()` を呼ぶ
- WebSocket イベントを受信したら store を更新（マルチユーザー対応）

---

## Phase 3: UX 改善

- **ドラッグ&ドロップ**: セクションの位置をドラッグで変更
- **セクションの折りたたみ**: セクション内のセグメントを折りたためるようにする
- **セクションカラー**: セクションに色を設定できるようにする
- **Undo/Redo**: セクション削除の取り消し
- **キーボードショートカット**: `S` キーでセクション追加モード

---

## ファイル変更一覧（Phase 1）

| ファイル | 変更種別 | 内容 |
|---------|---------|------|
| `ext-frontend/src/types.ts` | 修正 | `Section` 型を追加 |
| `ext-frontend/src/stores/transcriptStore.ts` | 修正 | sections state と actions を追加 |
| `ext-frontend/src/components/SectionInsertButton.tsx` | 新規 | ホバーで表示される `+` ボタン |
| `ext-frontend/src/components/SectionEditor.tsx` | 新規 | セクション作成/編集インラインエディタ |
| `ext-frontend/src/components/SectionHeader.tsx` | 新規 | セクションヘッダー表示 |
| `ext-frontend/src/components/TranscriptViewer.tsx` | 修正 | セクション表示ロジック追加 |
| `ext-frontend/src/index.css` | 修正 | セクション関連スタイル追加 |

---

## 実装順序

1. **型定義** → 2. **Store 拡張** → 3. **SectionInsertButton** → 4. **SectionEditor** → 5. **SectionHeader** → 6. **TranscriptViewer 統合** → 7. **CSS** → 8. **動作確認**
