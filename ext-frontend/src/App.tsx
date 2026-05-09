// =============================================================================
// External Web UI メインアプリケーション
// =============================================================================
// Meetily の文字起こしをリアルタイムで閲覧・編集するための Web UI。
// WebSocket でリアルタイム更新を受信し、REST API で編集操作を行う。
//
// コンポーネント構成:
//   - ConnectionStatusBar: WebSocket 接続状態の表示
//   - TranscriptViewer: リアルタイム文字起こし一覧
//   - TranscriptEditor: セグメント編集 UI（TranscriptSegment 内で表示）
//   - CommentPanel: コメント追加 UI（TranscriptSegment 内で表示）
//   - HighlightToolbar: ハイライト追加 UI（TranscriptSegment 内で表示）
// =============================================================================

import { useEffect, useRef } from "react";
import { ConnectionStatusBar } from "./components/ConnectionStatusBar";
import { TranscriptViewer } from "./components/TranscriptViewer";
import { createWebSocketClient } from "./api/ws";
import type { WebSocketClient } from "./api/ws";
import { useTranscriptStore } from "./stores/transcriptStore";

function App() {
  // WebSocket クライアントの参照を保持する（再レンダリングで再生成しないため）
  const wsRef = useRef<WebSocketClient | null>(null);

  // Zustand ストアのアクションを取得する
  const setConnectionStatus = useTranscriptStore(
    (state) => state.setConnectionStatus
  );
  const upsertSegment = useTranscriptStore((state) => state.upsertSegment);
  const addRevision = useTranscriptStore((state) => state.addRevision);
  const addComment = useTranscriptStore((state) => state.addComment);
  const addHighlight = useTranscriptStore((state) => state.addHighlight);
  const startSession = useTranscriptStore((state) => state.startSession);
  const stopSession = useTranscriptStore((state) => state.stopSession);
  const setMeetingId = useTranscriptStore((state) => state.setMeetingId);

  // マウント時に WebSocket 接続を開始し、アンマウント時に切断する
  useEffect(() => {
    const ws = createWebSocketClient({
      // --- WebSocket イベントの処理 ---
      onEvent: (event) => {
        switch (event.type) {
          case "RecordingStarted":
            // 録音開始: セッション情報をストアにセットする
            startSession(
              event.payload.session_id,
              event.payload.meeting_title,
              event.payload.started_at
            );
            break;

          case "RecordingStopped":
            // 録音停止: セッション状態を更新する
            stopSession();
            break;

          case "MeetingPersisted":
            // meeting_id 確定: セッションに meeting_id を紐付ける
            setMeetingId(
              event.payload.session_id,
              event.payload.meeting_id
            );
            break;

          case "TranscriptSegmentUpserted":
            // セグメント追加/更新: ストアに upsert する
            upsertSegment(event.payload);
            break;

          case "TranscriptRevisionCreated":
            // revision 作成: 対象セグメントの displayText を更新する
            addRevision(event.payload);
            break;

          case "TranscriptCommentCreated":
            // コメント追加: 対象セグメントに追加する
            addComment(event.payload);
            break;

          case "TranscriptHighlightCreated":
            // ハイライト追加: 対象セグメントに追加する
            addHighlight(event.payload);
            break;
        }
      },

      // --- 接続状態の変更をストアに反映する ---
      onStatusChange: (status) => {
        setConnectionStatus(status);
      },
    });

    wsRef.current = ws;
    ws.connect();

    // アンマウント時に WebSocket 接続を切断する
    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // マウント時のみ実行する（ストアのアクションは安定した参照）

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* --- ヘッダー --- */}
      <header
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid #e5e7eb",
          backgroundColor: "#fff",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: "1.25rem",
            fontWeight: 600,
          }}
        >
          Meetily External Web UI
        </h1>
      </header>

      {/* --- 接続状態バー --- */}
      <ConnectionStatusBar />

      {/* --- メインコンテンツ: 文字起こし一覧 --- */}
      <TranscriptViewer />
    </div>
  );
}

export default App;
