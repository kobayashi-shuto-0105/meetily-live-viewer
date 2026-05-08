// =============================================================================
// External Web UI メインアプリケーション
// =============================================================================
// Meetily の文字起こしをリアルタイムで閲覧・編集するための Web UI。
// WebSocket でリアルタイム更新を受信し、REST API で編集操作を行う。
//
// 後続 PR で以下のコンポーネントを追加予定:
//   - TranscriptViewer: リアルタイム文字起こし表示
//   - TranscriptEditor: セグメント編集 UI
//   - CommentPanel: コメント追加 UI
//   - HighlightToolbar: ハイライト追加 UI
// =============================================================================

function App() {
  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Meetily External Web UI</h1>
      <p>リアルタイム文字起こしビューア（準備中）</p>
      <p style={{ color: "#888", fontSize: "0.9rem" }}>
        後続 PR で WebSocket 接続、文字起こし表示、編集機能を追加予定
      </p>
    </div>
  );
}

export default App;

