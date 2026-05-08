// =============================================================================
// TranscriptSegment コンポーネント
// =============================================================================
// 1つの文字起こしセグメントを表示するコンポーネント。
//
// 表示内容:
//   - タイムスタンプ（音声開始〜終了時間）
//   - 表示テキスト（revision があればその edited_text、なければ raw_text）
//   - 元テキスト（revision がある場合のみ折りたたみ表示）
//   - 音源種別バッジ（microphone / system）
//   - 途中結果インジケーター（is_partial=true の場合）
//   - コメント数・ハイライト数
//
// 後続 PR で追加予定:
//   - 編集ボタン → TranscriptEditor 起動
//   - コメントボタン → CommentPanel 表示
//   - ハイライトボタン → HighlightToolbar 表示
// =============================================================================

import { useState } from "react";
import type { TranscriptSegmentView } from "../types";

// =============================================================================
// Props 型定義
// =============================================================================

interface TranscriptSegmentProps {
  /** 表示するセグメントデータ */
  segment: TranscriptSegmentView;
}

// =============================================================================
// コンポーネント実装
// =============================================================================

/**
 * 文字起こしセグメントの表示コンポーネント。
 * プラン §13.5 の UI イメージに基づく実装。
 */
export function TranscriptSegment({ segment }: TranscriptSegmentProps) {
  // 元テキストの展開状態（revision がある場合のみ使用）
  const [showRawText, setShowRawText] = useState(false);

  // revision が存在するかどうか（display_text が raw_text と異なるか）
  const hasRevision = segment.revisions.length > 0;

  // コメント数とハイライト数
  const commentCount = segment.comments.length;
  const highlightCount = segment.highlights.length;

  return (
    <div
      style={{
        padding: "0.75rem 1rem",
        borderBottom: "1px solid #e5e7eb",
        // 途中結果（partial）の場合は半透明にする
        opacity: segment.isPartial ? 0.6 : 1,
        // ハイライトがある場合は左ボーダーで示す
        borderLeft: highlightCount > 0 ? "3px solid #fbbf24" : "3px solid transparent",
      }}
    >
      {/* --- ヘッダー行: タイムスタンプ + メタ情報 --- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "0.25rem",
          fontSize: "0.8rem",
          color: "#6b7280",
        }}
      >
        {/* タイムスタンプ: 音声の開始〜終了位置 */}
        <span style={{ fontFamily: "monospace" }}>
          [{formatTime(segment.audioStartTime)} - {formatTime(segment.audioEndTime)}]
        </span>

        {/* 音源種別バッジ */}
        <span
          style={{
            padding: "0.1rem 0.4rem",
            borderRadius: "4px",
            fontSize: "0.7rem",
            // microphone は青、system は緑で色分けする
            backgroundColor: segment.source === "microphone" ? "#dbeafe" : "#d1fae5",
            color: segment.source === "microphone" ? "#1e40af" : "#065f46",
          }}
        >
          {segment.source}
        </span>

        {/* 途中結果インジケーター */}
        {segment.isPartial && (
          <span style={{ color: "#f59e0b", fontStyle: "italic" }}>
            (認識中...)
          </span>
        )}

        {/* 信頼度スコア（デバッグ用、低い場合のみ表示） */}
        {segment.confidence < 0.5 && (
          <span style={{ color: "#ef4444", fontSize: "0.7rem" }}>
            信頼度: {(segment.confidence * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {/* --- メインテキスト: display_text --- */}
      <p style={{ margin: "0.25rem 0", lineHeight: 1.6 }}>
        {segment.displayText}
      </p>

      {/* --- 元テキスト（revision がある場合のみ表示） --- */}
      {hasRevision && (
        <div style={{ marginTop: "0.25rem" }}>
          <button
            onClick={() => setShowRawText(!showRawText)}
            style={{
              background: "none",
              border: "none",
              color: "#6b7280",
              fontSize: "0.75rem",
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
            }}
          >
            {showRawText ? "▼ 元テキストを隠す" : "▶ 元テキストを表示"}
          </button>
          {showRawText && (
            <p
              style={{
                margin: "0.25rem 0",
                padding: "0.5rem",
                backgroundColor: "#f9fafb",
                borderRadius: "4px",
                fontSize: "0.85rem",
                color: "#6b7280",
                lineHeight: 1.5,
              }}
            >
              {segment.rawText}
            </p>
          )}
        </div>
      )}

      {/* --- フッター: 操作ボタンとカウンター --- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginTop: "0.5rem",
          fontSize: "0.75rem",
          color: "#9ca3af",
        }}
      >
        {/* コメント数 */}
        {commentCount > 0 && (
          <span>💬 {commentCount}</span>
        )}

        {/* ハイライト数 */}
        {highlightCount > 0 && (
          <span>🔆 {highlightCount}</span>
        )}

        {/* revision 数 */}
        {hasRevision && (
          <span>✏️ v{segment.revisions.length}</span>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// ユーティリティ関数
// =============================================================================

/**
 * 秒数を "MM:SS" 形式にフォーマットする。
 * 例: 72.5 → "01:12"
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
