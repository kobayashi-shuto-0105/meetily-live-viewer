// =============================================================================
// TranscriptViewer コンポーネント
// =============================================================================
// リアルタイム文字起こし一覧を表示するコンテナコンポーネント。
//
// 機能:
//   - セグメント一覧の表示（sequence_id 昇順）
//   - 自動スクロール（新しいセグメント追加時に最下部へスクロール）
//   - セグメントがない場合のプレースホルダー表示
//
// 子コンポーネント:
//   - TranscriptSegment: 個々のセグメント表示
// =============================================================================

import { useEffect, useRef } from "react";
import { useTranscriptStore, selectSortedSegments } from "../stores/transcriptStore";
import { TranscriptSegment } from "./TranscriptSegment";

// =============================================================================
// コンポーネント実装
// =============================================================================

/**
 * 文字起こしセグメント一覧を表示するコンテナ。
 * Zustand ストアからセグメントを取得し、TranscriptSegment で描画する。
 */
export function TranscriptViewer() {
  // Zustand ストアからソート済みセグメントを取得する
  const segments = useTranscriptStore(selectSortedSegments);
  const session = useTranscriptStore((state) => state.session);

  // 自動スクロール用の ref（一覧末尾の空要素を参照する）
  const bottomRef = useRef<HTMLDivElement>(null);

  // セグメント追加時に最下部へ自動スクロールする
  useEffect(() => {
    // smooth スクロールで自然な動きにする
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments.length]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* --- セッション情報ヘッダー --- */}
      {session && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderBottom: "2px solid #e5e7eb",
            backgroundColor: "#f9fafb",
          }}
        >
          <div style={{ fontWeight: "bold", fontSize: "1rem" }}>
            {session.meetingTitle ?? "無題の会議"}
          </div>
          <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
            {/* セッション状態を表示する */}
            {session.isStopped ? (
              <span style={{ color: "#6b7280" }}>⏹ 録音停止</span>
            ) : (
              <span style={{ color: "#ef4444" }}>🔴 録音中</span>
            )}
            {session.meetingId && (
              <span style={{ marginLeft: "0.5rem", color: "#059669" }}>
                ✓ 保存済み
              </span>
            )}
          </div>
        </div>
      )}

      {/* --- セグメント一覧（スクロール領域） --- */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 0,
        }}
      >
        {segments.length === 0 ? (
          // セグメントがない場合のプレースホルダー
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#9ca3af",
              fontSize: "0.9rem",
            }}
          >
            {session && !session.isStopped ? (
              <span>🎙️ 文字起こしを待っています...</span>
            ) : (
              <span>セグメントがありません</span>
            )}
          </div>
        ) : (
          // セグメント一覧を描画する
          segments.map((segment) => (
            <TranscriptSegment key={segment.id} segment={segment} />
          ))
        )}

        {/* 自動スクロール用のアンカー要素 */}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
