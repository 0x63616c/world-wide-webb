import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { db } from "./db";
import { frontendLogIngestSchema, ingestFrontendLogs } from "./service";

// EXPORTED (mirrors features/weight `export const weightRouter`) so the moved
// service.test.ts can `import { logsRouter } from "./api"` and assert the key
// locally.
export const logsRouter = router({
  // Devices ship their frontend logs here (spec 2026-07-18). Idempotent by the
  // composite PK. Thin wrapper: validation + persistence live in ./service.
  ingest: publicProcedure
    .input(frontendLogIngestSchema)
    .mutation(({ input }) => ingestFrontendLogs(db, input)),
});

/** The branded `api` facet — single top-level key `logs`. */
export const api = defineApi(router({ logs: logsRouter }));
