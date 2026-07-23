/**
 * Notification Center tRPC surface (Track C, S1 fold). Thin by construction:
 * every procedure is a one-line delegation to service.ts, which owns the
 * dedupe, badge, and push-fan-out rules. Input AND output are zod-validated so
 * a schema drift between backend and panel fails loudly at the boundary.
 *
 * The feature owns its wiring: it reaches the tRPC runtime ONLY through
 * `@app-kit/server` (the single sanctioned seam into apps/api's trpc/init ,
 * never a direct apps/api import), and every procedure runs against the
 * feature's OWN db (./db), not a request-scoped ctx.db , mirrors guest-wifi's
 * module-level singleton service pattern (the notify job handler needs its own
 * db reference anyway, so there is one db story for the whole feature, not two).
 */

import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { db } from "./db";
import {
  listNotifications,
  listNotificationsResultSchema,
  listNotificationsSchema,
  markAllRead,
  markRead,
  notificationItemSchema,
  raiseNotification,
  raiseNotificationSchema,
  registerPushToken,
  registerPushTokenSchema,
} from "./service";

/** Shared shape of every mutation that can change the badge. */
const unreadCountResultSchema = z.object({ unreadCount: z.number().int() });

const notificationIdSchema = z.object({ id: z.string().min(1) });

const notificationsRouter = router({
  // Feed + badge in one read, so the panel never renders a list and a count
  // that disagree.
  list: publicProcedure
    .input(listNotificationsSchema)
    .output(listNotificationsResultSchema)
    .query(({ input }) => listNotifications(db, input)),

  markRead: publicProcedure
    .input(notificationIdSchema)
    .output(unreadCountResultSchema)
    .mutation(({ input }) => markRead(db, input.id)),

  markAllRead: publicProcedure.output(unreadCountResultSchema).mutation(() => markAllRead(db)),

  // The iOS shell calls this on every boot; the token rotates, the device id
  // does not, so the service upserts on device id.
  registerToken: publicProcedure
    .input(registerPushTokenSchema)
    .output(z.void())
    .mutation(({ input }) => registerPushToken(db, input)),

  // Raise a notification from the panel or an external producer. Writes the row
  // and enqueues the APNs fan-out job.
  raise: publicProcedure
    .input(raiseNotificationSchema)
    .output(notificationItemSchema)
    .mutation(({ input }) => raiseNotification(db, input)),
});

/**
 * The branded `api` facet. Its single top-level key `notifications` keeps the
 * router namespace the panel already calls (`trpc.notifications.*`) unchanged
 * across the fold. The codegen reads these keys off `api._def.record`.
 */
export const api = defineApi(router({ notifications: notificationsRouter }));
