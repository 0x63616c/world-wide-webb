import { z } from "zod";
import { db } from "../../db/index";
import {
  getInteractionSession,
  listInteractionSessions,
} from "../../services/interaction-session-service";
import { publicProcedure, router } from "../init";

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

export const sessionsRouter = router({
  list: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
    .output(z.array(SummarySchema))
    .query(({ input }) => listInteractionSessions(db, { limit: input?.limit })),
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(DetailSchema.nullable())
    .query(({ input }) => getInteractionSession(db, input.id)),
});
