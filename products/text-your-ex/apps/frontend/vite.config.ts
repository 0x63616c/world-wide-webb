import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// VITE_API_BASE: baked at Docker build time for Capacitor/prod builds (no runtime server).
// In local dev the Vite dev server proxies /api to localhost:8787 (VITE_API_BASE unused).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  // `vite preview` (serving the built dist) needs its own proxy: the e2e harness
  // serves the built frontend via preview and proxies /api to the e2e API port
  // (VITE_PROXY_TARGET). Defaults to the dev API port for a manual `vite preview`.
  preview: {
    port: 5173,
    proxy: {
      "/api": {
        // biome-ignore lint/style/noProcessEnv: node-side vite config, env override is intentional
        target: process.env.VITE_PROXY_TARGET ?? "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
