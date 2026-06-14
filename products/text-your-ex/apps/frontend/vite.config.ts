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
  build: { outDir: "dist", sourcemap: false },
});
