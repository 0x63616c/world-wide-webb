import { execSync } from "node:child_process";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env.API_PORT ?? "4201";

// Identifies the running web bundle. CI passes the commit SHA via the BUILD_HASH
// env (Docker ARG → ENV); a local build reads the current short SHA from git.
// The Docker builder has no .git, so the env path is what production uses; the
// git path is the dev/preview convenience, with "dev" as the last-resort fallback.
function resolveBuildHash(): string {
  if (process.env.BUILD_HASH) return process.env.BUILD_HASH;
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  plugins: [TanStackRouterVite({ target: "react" }), react(), tailwindcss()],
  define: {
    __BUILD_HASH__: JSON.stringify(resolveBuildHash()),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    host: true,
    port: Number(process.env.PORT ?? 4200),
    proxy: {
      "/trpc": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
