// =============================================================================
// External Web UI エントリーポイント
// =============================================================================
// React アプリケーションのルートを DOM にマウントする。
// StrictMode を有効にして、開発時の問題を早期発見する。
// =============================================================================

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

