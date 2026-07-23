import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Authoring-surface aliases (Track C, C7). The unit project's tile-registry
    // imports a folded feature's manifest (`@features`), which reaches the
    // authoring surface (`@app-kit`); mirror vite.config.ts (the storybook
    // project extends that directly). `@app-kit/server` precedes `@app-kit`
    // (vite matches a string alias by equality or `alias + "/"` prefix, so the
    // bare `@app-kit` would otherwise swallow `@app-kit/server`).
    alias: {
      "@": resolve(__dirname, "src"),
      "@app-kit/server": resolve(__dirname, "../../app-kit/server.ts"),
      "@app-kit": resolve(__dirname, "../../app-kit/index.ts"),
      "@features": resolve(__dirname, "../../features"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.unit.ts"],
    // Board integration suites exceed the 5s default under CI's higher worker
    // parallelism (maxWorkers: 4 contends for CPU across runs; they pass in
    // well under 5s on an idle machine).
    testTimeout: 20_000,
    // Collect this project's own tests PLUS the jsdom-shaped facet tests of every
    // folded feature (Track C). A feature is self-contained (AGENTS.md), so its
    // tests live beside it in features/<id>/; collection is by facet filename
    // convention, mirroring codegen (manifest/api/web): `web.test.tsx` and
    // `web-view.test.tsx` are the frontend facet (single-tile features) and run
    // in jsdom here, `service.test.ts`/`api.test.ts`/etc run under apps/api
    // (node). A feature with a full web/ component subtree (weather is the
    // first — the full 33-file move includes its own component/story/test
    // closure, not just one tile+view pair) keeps its tests beside their
    // subjects under `web/**`, also collected here. Keep this in sync with
    // apps/api/vitest.config.ts. The default glob is restated first because
    // setting `include` overrides vitest's default.
    include: [
      "**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "../../features/**/web*.test.tsx",
      "../../features/*/web/**/*.test.tsx",
    ],
    // e2e-portal/*.spec.ts are Playwright specs (run via `bun run e2e:portal`
    // / e2e-portal/playwright.config.ts, not vitest). Vitest's default include
    // glob matches *.spec.ts too, so without an exclude it collects them and
    // crashes on their top-level `test.describe`/`test.beforeEach` (the
    // Playwright `test` fixture, not vitest's). Spread configDefaults.exclude
    // rather than a bare override, or setting `exclude` drops vitest's own
    // node_modules/dist/cypress/etc defaults (SDD track 0, Task 4).
    exclude: [...configDefaults.exclude, "e2e-portal/**"],
  },
});
