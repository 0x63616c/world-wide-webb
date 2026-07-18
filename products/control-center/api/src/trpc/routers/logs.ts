import { frontendLogIngestSchema, ingestFrontendLogs } from "../../services/frontend-log-service";
import { publicProcedure, router } from "../init";

export const logsRouter = router({
  // Devices ship their frontend logs here (spec 2026-07-18). Idempotent by the
  // composite PK, so a batch may re-send rows the backend already holds. Thin
  // wrapper: validation + persistence live in frontend-log-service.
  ingest: publicProcedure
    .input(frontendLogIngestSchema)
    .mutation(({ ctx, input }) => ingestFrontendLogs(ctx.db, input)),
});
