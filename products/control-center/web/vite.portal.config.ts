import { rename } from "node:fs/promises";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import legacy from "@vitejs/plugin-legacy";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Separate build for the guest captive-portal entry (task 2.3, SDD track 0).
// Deliberately does NOT share plugins with vite.config.ts beyond react +
// tailwindcss + the "@" alias: no TanStackRouter (portal has no router yet),
// no versionStampPlugin (panel-only OTA check), no /media proxies (panel-only
// streams). Ships @vitejs/plugin-legacy — ported verbatim from the original
// products/captive-portal/apps/frontend/vite.config.ts — because captive
// network webviews (Apple CNA) skip module scripts.
//
// Vite names the emitted HTML after the input file's basename, so the raw
// build output is dist-portal/portal.html (input: portal.html, both source
// HTMLs live next to index.html in this dir so they can't share a name).
// The guest listener (guest-server.ts, Task 4) requests "/" -> "index.html"
// like every other static-SPA server, so rename the emitted file at the end
// of the build , this is the ONE place the dist-portal/index.html contract
// gets established, so every consumer (the Dockerfile-baked prod image, a
// local `bun run --cwd web build:portal` + `bun server.ts` dev loop) sees the
// same layout without a duplicated packaging-time rename step.
function renamePortalHtmlToIndex(): Plugin {
  return {
    name: "rename-portal-html-to-index",
    async closeBundle() {
      await rename(
        resolve(__dirname, "dist-portal/portal.html"),
        resolve(__dirname, "dist-portal/index.html"),
      );
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    legacy({
      targets: ["defaults", "not IE 11", "iOS >= 10"],
    }),
    renamePortalHtmlToIndex(),
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
