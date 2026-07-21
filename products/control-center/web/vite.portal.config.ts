import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import legacy from "@vitejs/plugin-legacy";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Separate build for the guest captive-portal entry (task 2.3, SDD track 0).
// Deliberately does NOT share plugins with vite.config.ts beyond react +
// tailwindcss + the "@" alias: no TanStackRouter (portal has no router yet),
// no versionStampPlugin (panel-only OTA check), no /media proxies (panel-only
// streams). Ships @vitejs/plugin-legacy — ported verbatim from the original
// products/captive-portal/apps/frontend/vite.config.ts — because captive
// network webviews (Apple CNA) skip module scripts.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    legacy({
      targets: ["defaults", "not IE 11", "iOS >= 10"],
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist-portal",
    rollupOptions: {
      input: resolve(__dirname, "portal.html"),
    },
  },
  server: {
    host: true,
    port: 4206,
    proxy: {
      // Guest listener port lands in Task 3; until then, proxy to the same
      // local api dev port the panel uses.
      "/trpc": {
        target: "http://localhost:4211",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
