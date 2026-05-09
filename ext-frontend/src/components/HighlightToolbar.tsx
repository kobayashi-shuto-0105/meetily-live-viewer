// =============================================================================
// HighlightToolbar コンポーネント
// =============================================================================
// セグメントにハイライトを追加するツールバー。
//
// 機能:
//   - 既存ハイライトの一覧表示（色・メモ・アンカー情報付き）
//   - カラーパレットからハイライト色を選択
//   - 任意のメモ入力フィールド
//   - 「追加」ボタンで REST API にハイライトを送信
//   - ツールバーの開閉切り替え
//
// REST API:
//   POST /api/segments/:id/highlights { color, note?, ... }
//   → TranscriptHighlightResponse を返却
//   → WebSocket で TranscriptHighlightCreated イベントが配信され、
//     ストア側で highlights 配列が自動更新される
// =============================================================================

import { useState, useCallback } from "react";
import { apiClient } from "../api/client";
import type { TranscriptHighlightPayload } from "../types";

// =============================================================================
// 定数: ハイライトカラーパレット
// =============================================================================

/** 選択可能なハイライト色の一覧 */
const HIGHLIGHT_COLORS = [
  { key: "yellow", hex: "#fbbf24", label: "黄色" },
  { key: "green", hex: "#34d399", label: "緑" },
  { key: "blue", hex: "#60a5fa", label: "青" },
  { key: "pink", hex: "#f472b6", label: "ピンク" },
  { key: "purple", hex: "#a78bfa", label: "紫" },
  { key: "orange", hex: "#fb923c", label: "オレンジ" },
] as const;

// =============================================================================
// Props 型定義
// =============================================================================

interface HighlightToolbarProps {
  /** ハイライト対象のセグメント ID */
  segmentId: string;

  /** 既存のハイライト一覧（ストアから取得済み） */
  highlights: TranscriptHighlightPayload[];

  /** ツールバーを閉じるコールバック */
  onClose: () => void;
}

// =============================================================================
// コンポーネント実装
// =============================================================================

/**
 * セグメントのハイライトツールバー。
 * カラーパレットから色を選択し、オプションでメモを付けてハイライトを追加する。
 *
 * 追加時の流れ:
 *   1. REST API にハイライト作成リクエストを送信
 *   2. サーバーが保存し、WebSocket で全クライアントに通知
 *   3. ストアの addHighlight で highlights 配列が自動更新される
 *   → このコンポーネントではストア更新を直接行わない（サーバー経由で同期）
 */
export function HighlightToolbar({
  segmentId,
  highlights,
  onClose,
}: HighlightToolbarProps) {
  // --- ローカル状態 ---
  // 選択中のハイライト色（デフォルト: 黄色）
  const [selectedColor, setSelectedColor] = useState<string>(HIGHLIGHT_COLORS[0].key);
  // メモ入力（任意）
  const [note, setNote] = useState("");
  // 送信中かどうか
  const [isSending, setIsSending] = useState(false);
  // エラーメッセージ
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // ハイライト追加処理: REST API にハイライトを作成する
  // ---------------------------------------------------------------------------
  const handleAddHighlight = useCallback(async () => {
    setIsSending(true);
    setErrorMessage(null);

    try {
      // REST API でハイライトを作成する
      // → サーバーが WebSocket 経由で TranscriptHighlightCreated を配信する
      // → ストアの addHighlight で highlights 配列が自動更新される
      await apiClient.createHighlight(segmentId, {
        color: selectedColor,
        // メモが入力されていれば送信する
        note: note.trim() || undefined,
      });

      // 追加成功: メモ入力をクリアする（ツールバーは閉じない）
      setNote("");
      setErrorMessage(null);
    } catch (error) {
      // 追加失敗: エラーメッセージを表示する
      const message =
        error instanceof Error
          ? error.message
          : "ハイライトの追加に失敗しました。もう一度お試しください。";
      setErrorMessage(message);
    } finally {
      setIsSending(false);
    }
  }, [selectedColor, note, segmentId]);

  // ---------------------------------------------------------------------------
  // レンダリング
  // ---------------------------------------------------------------------------
  return (
    <div
      style={{
        marginTop: "0.5rem",
        padding: "0.5rem",
        border: "1px solid #a78bfa",
        borderRadius: "6px",
        backgroundColor: "#f5f3ff",
      }}
    >
      {/* --- ツールバーヘッダー --- */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.5rem",
        }}
      >
        <span
          style={{
            fontWeight: 600,
            fontSize: "0.85rem",
            color: "#5b21b6",
          }}
        >
          🔆 ハイライト ({highlights.length})
        </span>
        {/* 閉じるボタン */}
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            fontSize: "1rem",
            cursor: "pointer",
            color: "#9ca3af",
            padding: "0 0.25rem",
          }}
          title="閉じる"
        >
          ✕
        </button>
      </div>

      {/* --- 既存ハイライト一覧 --- */}
      {highlights.length > 0 && (
        <div
          style={{
            marginBottom: "0.5rem",
            maxHeight: "120px",
            overflowY: "auto",
          }}
        >
          {highlights.map((highlight) => (
            <div
              key={highlight.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.3rem 0.5rem",
                marginBottom: "0.2rem",
                backgroundColor: "#fff",
                borderRadius: "4px",
                border: "1px solid #e9d5ff",
                fontSize: "0.8rem",
              }}
            >
              {/* ハイライト色のドット */}
              <span
                style={{
                  display: "inline-block",
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  // カラーパレットから hex を取得、見つからなければデフォルト色を使用
                  backgroundColor:
                    HIGHLIGHT_COLORS.find((c) => c.key === highlight.color)
                      ?.hex ?? HIGHLIGHT_COLORS[0].hex,
                  flexShrink: 0,
                }}
              />
              {/* メモ（存在する場合のみ表示） */}
              <span style={{ color: "#374151", flex: 1 }}>
                {highlight.note ?? "(メモなし)"}
              </span>
              {/* アンカー情報（テキスト範囲指定がある場合のみ表示） */}
              {highlight.anchor_start !== null &&
                highlight.anchor_end !== null && (
                  <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>
                    📌 {highlight.anchor_start}-{highlight.anchor_end}
                  </span>
                )}
            </div>
          ))}
        </div>
      )}

      {/* --- カラーパレット: ハイライト色の選択 --- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          marginBottom: "0.4rem",
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            color: "#6b7280",
            marginRight: "0.25rem",
          }}
        >
          色:
        </span>
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color.key}
            onClick={() => setSelectedColor(color.key)}
            title={color.label}
            style={{
              width: "24px",
              height: "24px",
              borderRadius: "50%",
              backgroundColor: color.hex,
              // 選択中の色は太いボーダーで強調する
              border:
                selectedColor === color.key
                  ? "3px solid #1f2937"
                  : "2px solid #e5e7eb",
              cursor: "pointer",
              padding: 0,
              // 選択中は少し大きくする
              transform: selectedColor === color.key ? "scale(1.15)" : "none",
              transition: "transform 0.1s ease",
            }}
          />
        ))}
      </div>

      {/* --- メモ入力（任意） --- */}
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={isSending}
        placeholder="メモ（任意）"
        // Enter キーで追加する
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleAddHighlight();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        style={{
          width: "100%",
          padding: "0.3rem 0.5rem",
          border: "1px solid #d1d5db",
          borderRadius: "4px",
          fontSize: "0.8rem",
          boxSizing: "border-box",
          opacity: isSending ? 0.6 : 1,
        }}
      />

      {/* --- エラーメッセージ --- */}
      {errorMessage && (
        <div
          style={{
            marginTop: "0.25rem",
            padding: "0.25rem 0.5rem",
            color: "#dc2626",
            fontSize: "0.8rem",
            backgroundColor: "#fef2f2",
            borderRadius: "4px",
          }}
        >
          {errorMessage}
        </div>
      )}

      {/* --- 追加ボタン --- */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: "0.5rem",
        }}
      >
        <button
          onClick={handleAddHighlight}
          disabled={isSending}
          style={{
            padding: "0.3rem 0.75rem",
            border: "none",
            borderRadius: "4px",
            backgroundColor: isSending ? "#c4b5fd" : "#8b5cf6",
            color: "#fff",
            fontSize: "0.8rem",
            cursor: isSending ? "not-allowed" : "pointer",
          }}
        >
          {isSending ? "追加中..." : "ハイライト追加"}
        </button>
      </div>
    </div>
  );
}
