// =============================================================================
// ConnectionStatusBar コンポーネント
// =============================================================================
// WebSocket の接続状態をヘッダーバーで表示するコンポーネント。
//
// 表示内容:
//   - 接続中: 緑のインジケーター + "接続中"
//   - 接続試行中: 黄色のインジケーター + "接続中..."
//   - 切断: 赤のインジケーター + "切断" + 再接続ボタン
//   - エラー: 赤のインジケーター + "エラー"
// =============================================================================

import { useTranscriptStore } from "../stores/transcriptStore";
import type { ConnectionStatus } from "../types";

// =============================================================================
// 接続状態の表示情報マッピング
// =============================================================================

/** 各接続状態に対応する表示情報 */
const STATUS_CONFIG: Record<
  ConnectionStatus,
  { label: string; color: string; bgColor: string }
> = {
  connected: { label: "接続中", color: "#059669", bgColor: "#d1fae5" },
  connecting: { label: "接続中...", color: "#d97706", bgColor: "#fef3c7" },
  disconnected: { label: "切断", color: "#dc2626", bgColor: "#fee2e2" },
  error: { label: "エラー", color: "#dc2626", bgColor: "#fee2e2" },
};

// =============================================================================
// コンポーネント実装
// =============================================================================

/**
 * WebSocket 接続状態をヘッダーバーに表示する。
 * 切断時やエラー時にはユーザーに視覚的にフィードバックする。
 */
export function ConnectionStatusBar() {
  const connectionStatus = useTranscriptStore(
    (state) => state.connectionStatus
  );

  const config = STATUS_CONFIG[connectionStatus];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 1rem",
        backgroundColor: config.bgColor,
        borderBottom: `1px solid ${config.color}20`,
        fontSize: "0.85rem",
      }}
    >
      {/* 接続状態インジケーター（丸いドット） */}
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          backgroundColor: config.color,
          // 接続中はアニメーションで点滅させる
          animation:
            connectionStatus === "connecting"
              ? "pulse 1.5s ease-in-out infinite"
              : undefined,
        }}
      />

      {/* 状態ラベル */}
      <span style={{ color: config.color, fontWeight: 500 }}>
        {config.label}
      </span>

      {/* サーバー URL 表示（開発ビルドのみ） */}
      {import.meta.env.DEV && (
        <span style={{ color: "#9ca3af", fontSize: "0.75rem", marginLeft: "auto" }}>
          {import.meta.env.VITE_MEETILY_API_BASE}
        </span>
      )}
    </div>
  );
}
