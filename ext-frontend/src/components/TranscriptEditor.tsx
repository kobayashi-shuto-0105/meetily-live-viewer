// =============================================================================
// TranscriptEditor コンポーネント
// =============================================================================
// セグメントの文字起こしテキストを編集するインラインエディター。
//
// 機能:
//   - 編集モードの切り替え（表示テキストをクリックで編集開始）
//   - テキスト入力フィールド（textarea）で編集
//   - 「保存」ボタンで REST API に revision を送信
//   - 「キャンセル」ボタンで編集を取り消し
//   - 保存中のローディング表示
//   - エラー発生時のエラーメッセージ表示
//
// REST API:
//   POST /api/segments/:id/revisions { editedText: string }
//   → TranscriptRevisionResponse を返却
//   → WebSocket で TranscriptRevisionCreated イベントが配信され、
//     ストア側で displayText が自動更新される
// =============================================================================

import { useState, useCallback, useRef, useEffect } from "react";
import { apiClient } from "../api/client";

// =============================================================================
// Props 型定義
// =============================================================================

interface TranscriptEditorProps {
  /** 編集対象のセグメント ID */
  segmentId: string;

  /** 現在の表示テキスト（編集フォームの初期値として使用） */
  currentText: string;

  /** 編集完了時のコールバック（保存成功・キャンセル両方で呼ばれる） */
  onClose: () => void;
}

// =============================================================================
// コンポーネント実装
// =============================================================================

/**
 * セグメントのテキストをインライン編集するコンポーネント。
 *
 * 使い方:
 *   <TranscriptEditor
 *     segmentId="seg-123"
 *     currentText="元のテキスト"
 *     onClose={() => setEditing(false)}
 *   />
 *
 * 保存時の流れ:
 *   1. REST API に revision 作成リクエストを送信
 *   2. サーバーが revision を保存し、WebSocket で全クライアントに通知
 *   3. ストアの addRevision で displayText が自動更新される
 *   → このコンポーネントではストア更新を直接行わない（サーバー経由で同期）
 */
export function TranscriptEditor({
  segmentId,
  currentText,
  onClose,
}: TranscriptEditorProps) {
  // --- ローカル状態 ---
  // 編集中のテキスト（textarea の値）
  const [editedText, setEditedText] = useState(currentText);
  // 保存中かどうか（ボタンの無効化とローディング表示に使用）
  const [isSaving, setIsSaving] = useState(false);
  // エラーメッセージ（保存失敗時に表示）
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // textarea に自動フォーカスするための ref
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // マウント時に textarea にフォーカスする
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // ---------------------------------------------------------------------------
  // 保存処理: REST API に revision を作成する
  // ---------------------------------------------------------------------------
  const handleSave = useCallback(async () => {
    // 変更がない場合はそのまま閉じる
    if (editedText.trim() === currentText.trim()) {
      onClose();
      return;
    }

    // 空テキストは保存しない
    if (editedText.trim() === "") {
      setErrorMessage("テキストを入力してください");
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      // REST API で revision を作成する
      // → サーバーが WebSocket 経由で TranscriptRevisionCreated を配信する
      // → ストアの addRevision で displayText が自動更新される
      await apiClient.createRevision(segmentId, {
        editedText: editedText.trim(),
      });

      // 保存成功: エディターを閉じる
      onClose();
    } catch (error) {
      // 保存失敗: エラーメッセージを表示する
      const message =
        error instanceof Error
          ? error.message
          : "保存に失敗しました。もう一度お試しください。";
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  }, [editedText, currentText, segmentId, onClose]);

  // ---------------------------------------------------------------------------
  // キーボードショートカット
  // ---------------------------------------------------------------------------
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl+Enter / Cmd+Enter で保存する
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSave();
        return;
      }

      // Escape でキャンセルする
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
    },
    [handleSave, onClose]
  );

  // ---------------------------------------------------------------------------
  // レンダリング
  // ---------------------------------------------------------------------------
  return (
    <div
      style={{
        marginTop: "0.5rem",
        padding: "0.5rem",
        border: "1px solid #3b82f6",
        borderRadius: "6px",
        backgroundColor: "#eff6ff",
      }}
    >
      {/* --- 編集テキストエリア --- */}
      <textarea
        ref={textareaRef}
        value={editedText}
        onChange={(e) => setEditedText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isSaving}
        rows={3}
        style={{
          width: "100%",
          padding: "0.5rem",
          border: "1px solid #d1d5db",
          borderRadius: "4px",
          fontSize: "0.9rem",
          lineHeight: 1.6,
          resize: "vertical",
          fontFamily: "inherit",
          // 保存中は操作不可にする
          opacity: isSaving ? 0.6 : 1,
          boxSizing: "border-box",
        }}
        placeholder="修正後のテキストを入力..."
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

      {/* --- 操作ボタン --- */}
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
          Ctrl/Cmd+Enter で保存 / Esc でキャンセル
        </span>

        {/* キャンセルボタン */}
        <button
          onClick={onClose}
          disabled={isSaving}
          style={{
            padding: "0.3rem 0.75rem",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            backgroundColor: "#fff",
            color: "#374151",
            fontSize: "0.8rem",
            cursor: isSaving ? "not-allowed" : "pointer",
          }}
        >
          キャンセル
        </button>

        {/* 保存ボタン */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          style={{
            padding: "0.3rem 0.75rem",
            border: "none",
            borderRadius: "4px",
            backgroundColor: isSaving ? "#93c5fd" : "#3b82f6",
            color: "#fff",
            fontSize: "0.8rem",
            cursor: isSaving ? "not-allowed" : "pointer",
          }}
        >
          {isSaving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}
