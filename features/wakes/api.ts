/**
 * tRPC `wakePhotos` + `sessions` facets (Track C, Wave 5 fold), folded from
 * apps/api/src/trpc/routers/{wake-photos,sessions}.ts. The feature reaches the
 * tRPC runtime ONLY through `@app-kit/server` (the single sanctioned seam into
 * apps/api's trpc/init , never a direct apps/api import); its query bodies live
 * in ./photos and ./service against this feature's own db.
 */
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { db } from "./db";
import { listWakePhotos } from "./photos";
import { getInteractionSession, listInteractionSessions } from "./service";

const WakePhotoListingSchema = z.object({
  days: z.array(
    z.object({
      day: z.string(),
      photos: z.array(
        z.object({
          path: z.string(),
          capturedAt: z.number(),
          interactionSessionId: z.string().nullable(),
        }),
      ),
    }),
  ),
  totalCount: z.number(),
  totalBytes: z.number(),
});

const wakePhotosRouter = router({
  list: publicProcedure
    .input(z.object({}).optional())
    .output(WakePhotoListingSchema)
    .query(() => listWakePhotos(db)),
});

const SummarySchema = z.object({
  id: z.string(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  durationMs: z.number().nullable(),
  eventCount: z.number(),
  endReason: z.string().nullable(),
  deviceName: z.string(),
  photoPaths: z.array(z.string()),
  digest: z.string().nullable(),
});

const DetailSchema = SummarySchema.extend({
  events: z.array(
    z.object({ ts: z.number(), idx: z.number(), msg: z.string(), data: z.unknown() }),
  ),
});

const sessionsRouter = router({
  list: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
    .output(z.array(SummarySchema))
    .query(({ input }) => listInteractionSessions(db, { limit: input?.limit })),
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(DetailSchema.nullable())
    .query(({ input }) => getInteractionSession(db, input.id)),
});

/**
 * The branded `api` facet. Its two top-level keys , `wakePhotos` and
 * `sessions` , are the router namespaces the generated app router mounts. The
 * codegen reads these keys off `api._def.record`.
 */
export const api = defineApi(router({ wakePhotos: wakePhotosRouter, sessions: sessionsRouter }));
