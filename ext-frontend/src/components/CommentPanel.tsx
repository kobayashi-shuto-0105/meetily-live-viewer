// =============================================================================
// CommentPanel コンポーネント
// =============================================================================
// セグメントにコメントを追加・表示するパネル。
//
// 機能:
//   - 既存コメントの一覧表示（投稿者名・投稿日時・アンカー情報付き）
//   - 新規コメントの入力フォーム（テキスト + 投稿者名）
//   - 「送信」ボタンで REST API にコメントを送信
//   - パネルの開閉切り替え
//
// REST API:
//   POST /api/segments/:id/comments { commentText, authorName?, ... }
//   → TranscriptCommentResponse を返却
//   → WebSocket で TranscriptCommentCreated イベントが配信され、
//     ストア側で comments 配列が自動更新される
// =============================================================================

import { useState, useCallback } from "react";
import { apiClient } from "../api/client";
import type { TranscriptCommentPayload } from "../types";

// =============================================================================
// Props 型定義
// =============================================================================

interface CommentPanelProps {
  /** コメント対象のセグメント ID */
  segmentId: string;

  /** 既存のコメント一覧（ストアから取得済み） */
  comments: TranscriptCommentPayload[];

  /** パネルを閉じるコールバック */
  onClose: () => void;
}

// =============================================================================
// コンポーネント実装
// =============================================================================

/**
 * セグメントのコメントパネル。
 * 既存コメントの一覧表示と、新規コメントの投稿フォームを提供する。
 *
 * 投稿時の流れ:
 *   1. REST API にコメント作成リクエストを送信
 *   2. サーバーが保存し、WebSocket で全クライアントに通知
 *   3. ストアの addComment で comments 配列が自動更新される
 *   → このコンポーネントではストア更新を直接行わない（サーバー経由で同期）
 */
export function CommentPanel({
  segmentId,
  comments,
  onClose,
}: CommentPanelProps) {
  // --- ローカル状態 ---
  // 新規コメントのテキスト
  const [commentText, setCommentText] = useState("");
  // 投稿者名（任意入力）
  const [authorName, setAuthorName] = useState("");
  // 送信中かどうか
  const [isSending, setIsSending] = useState(false);
  // エラーメッセージ
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // コメント送信処理: REST API にコメントを作成する
  // ---------------------------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    // 空のコメントは送信しない
    if (commentText.trim() === "") {
      setErrorMessage("コメントを入力してください");
      return;
    }

    setIsSending(true);
    setErrorMessage(null);

    try {
      // REST API でコメントを作成する
      // → サーバーが WebSocket 経由で TranscriptCommentCreated を配信する
      // → ストアの addComment で comments 配列が自動更新される
      await apiClient.createComment(segmentId, {
        commentText: commentText.trim(),
        // 投稿者名が入力されていれば送信する
        authorName: authorName.trim() || undefined,
      });

      // 送信成功: 入力フォームをクリアする（パネルは閉じない）
      setCommentText("");
    } catch (error) {
      // 送信失敗: エラーメッセージを表示する
      const message =
        error instanceof Error
          ? error.message
          : "コメントの送信に失敗しました。もう一度お試しください。";
      setErrorMessage(message);
    } finally {
      setIsSending(false);
    }
  }, [commentText, authorName, segmentId]);

  // ---------------------------------------------------------------------------
  // キーボードショートカット
  // ---------------------------------------------------------------------------
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl+Enter / Cmd+Enter で送信する
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSubmit();
        return;
      }

      // Escape でパネルを閉じる
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
    },
    [handleSubmit, onClose]
  );

  // ---------------------------------------------------------------------------
  // レンダリング
  // ---------------------------------------------------------------------------
  return (
    <div
      style={{
        marginTop: "0.5rem",
        padding: "0.5rem",
        border: "1px solid #f59e0b",
        borderRadius: "6px",
        backgroundColor: "#fffbeb",
      }}
    >
      {/* --- パネルヘッダー --- */}
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
            color: "#92400e",
          }}
        >
          💬 コメント ({comments.length})
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

      {/* --- 既存コメント一覧 --- */}
      {comments.length > 0 && (
        <div
          style={{
            marginBottom: "0.5rem",
            maxHeight: "150px",
            overflowY: "auto",
          }}
        >
          {comments.map((comment) => (
            <div
              key={comment.id}
              style={{
                padding: "0.4rem 0.5rem",
                marginBottom: "0.25rem",
                backgroundColor: "#fff",
                borderRadius: "4px",
                border: "1px solid #fde68a",
                fontSize: "0.8rem",
              }}
            >
              {/* コメント投稿者名（存在する場合のみ表示） */}
              {comment.author_name && (
                <div
                  style={{
                    fontWeight: 600,
                    color: "#92400e",
                    fontSize: "0.75rem",
                    marginBottom: "0.15rem",
                  }}
                >
                  {comment.author_name}
                </div>
              )}
              {/* コメント本文 */}
              <div style={{ color: "#374151", lineHeight: 1.5 }}>
                {comment.comment_text}
              </div>
              {/* アンカー情報（テキスト範囲指定がある場合のみ表示） */}
              {comment.anchor_start !== null &&
                comment.anchor_end !== null && (
                  <div
                    style={{
                      fontSize: "0.7rem",
                      color: "#9ca3af",
                      marginTop: "0.15rem",
                    }}
                  >
                    📌 文字位置: {comment.anchor_start}-{comment.anchor_end}
                  </div>
                )}
            </div>
          ))}
        </div>
      )}

      {/* --- 新規コメント入力フォーム --- */}
      <div>
        {/* 投稿者名入力（任意） */}
        <input
          type="text"
          value={authorName}
          onChange={(e) => setAuthorName(e.target.value)}
          disabled={isSending}
          placeholder="投稿者名（任意）"
          style={{
            width: "100%",
            padding: "0.3rem 0.5rem",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            fontSize: "0.8rem",
            marginBottom: "0.25rem",
            boxSizing: "border-box",
          }}
        />

        {/* コメント本文入力 */}
        <textarea
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSending}
          rows={2}
          placeholder="コメントを入力..."
          style={{
            width: "100%",
            padding: "0.4rem 0.5rem",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            fontSize: "0.8rem",
            lineHeight: 1.5,
            resize: "vertical",
            fontFamily: "inherit",
            opacity: isSending ? 0.6 : 1,
            boxSizing: "border-box",
          }}
        />
      </div>

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

      {/* --- 送信ボタン --- */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: "0.5rem",
          marginTop: "0.5rem",
        }}
      >
        {/* ショートカットヒント */}
        <span
          style={{
            fontSize: "0.7rem",
            color: "#9ca3af",
            marginRight: "auto",
          }}
        >
          Ctrl+Enter で送信
        </span>

        {/* 送信ボタン */}
        <button
          onClick={handleSubmit}
          disabled={isSending}
          style={{
            padding: "0.3rem 0.75rem",
            border: "none",
            borderRadius: "4px",
            backgroundColor: isSending ? "#fcd34d" : "#f59e0b",
            color: "#fff",
            fontSize: "0.8rem",
            cursor: isSending ? "not-allowed" : "pointer",
          }}
        >
          {isSending ? "送信中..." : "送信"}
        </button>
      </div>
    </div>
  );
}
