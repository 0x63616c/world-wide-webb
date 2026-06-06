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

// Unix-ms timestamp of the running web bundle, for the "built N ago" readout.
// CI passes the commit time via BUILD_TIME; a local build reads the current
// commit's author date from git. Returns "NaN" (the string) when unknown so
// that Number("NaN") correctly parses to NaN — callers treat non-finite as
// "no age to show". An empty string must NOT be returned: Number("") === 0,
// which is finite and causes formatRelativeAge to render "56 years".
function resolveBuildTime(): string {
  if (process.env.BUILD_TIME) return process.env.BUILD_TIME;
  try {
    const secs = execSync("git log -1 --format=%ct").toString().trim();
    return String(Number(secs) * 1000);
  } catch {
    return "NaN";
  }
}

export default defineConfig({
  plugins: [TanStackRouterVite({ target: "react" }), react(), tailwindcss()],
  define: {
    __BUILD_HASH__: JSON.stringify(resolveBuildHash()),
    __BUILD_TIME__: JSON.stringify(resolveBuildTime()),
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
