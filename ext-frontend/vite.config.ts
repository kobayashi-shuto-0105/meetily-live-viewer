import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ----------------------------------------------------------------
// Meetily External Web UI – Vite configuration
//
// Dev proxy: forwards /api, /health, /ws to the Meetily backend
// (default port 38391).  Override VITE_BACKEND_PORT in .env if needed.
//
// With the proxy in place, no .env is required for local development:
//   - API base URL defaults to "" (same origin, proxied)
//   - WS URL defaults to ws://localhost:5173/ws (proxied)
// ----------------------------------------------------------------

export default defineConfig(({ mode }) => {
  const backendPort = process.env.VITE_BACKEND_PORT ?? "38391";
  const backendBase = `http://127.0.0.1:${backendPort}`;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy:
        mode !== "production"
          ? {
              "/api": {
                target: backendBase,
                changeOrigin: true,
              },
              "/health": {
                target: backendBase,
                changeOrigin: true,
              },
              "/ws": {
                // IMPORTANT: target must use http:// (not ws://) even for WS
                // proxying. Vite's http-proxy upgrades the protocol internally
                // when ws:true is set.
                target: backendBase,
                ws: true,
                changeOrigin: true,
              },
            }
          : undefined,
    },
  };
});
