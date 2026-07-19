/**
 * Notification Center tRPC surface. Thin by construction: every procedure is a
 * one-line delegation to notification-service, which owns the dedupe, badge,
 * and push-fan-out rules. Input AND output are zod-validated so a schema drift
 * between backend and panel fails loudly at the boundary.
 */
import { z } from "zod";

import {
  dismiss,
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
} from "../../services/notification-service";
import { publicProcedure, router } from "../init";

/** Shared shape of every mutation that can change the badge. */
const unreadCountResultSchema = z.object({ unreadCount: z.number().int() });

const notificationIdSchema = z.object({ id: z.string().min(1) });

export const notificationsRouter = router({
  // Feed + badge in one read, so the panel never renders a list and a count
  // that disagree.
  list: publicProcedure
    .input(listNotificationsSchema)
    .output(listNotificationsResultSchema)
    .query(({ ctx, input }) => listNotifications(ctx.db, input)),

  markRead: publicProcedure
    .input(notificationIdSchema)
    .output(unreadCountResultSchema)
    .mutation(({ ctx, input }) => markRead(ctx.db, input.id)),

  markAllRead: publicProcedure
    .output(unreadCountResultSchema)
    .mutation(({ ctx }) => markAllRead(ctx.db)),

  dismiss: publicProcedure
    .input(notificationIdSchema)
    .output(unreadCountResultSchema)
    .mutation(({ ctx, input }) => dismiss(ctx.db, input.id)),

  // The iOS shell calls this on every boot; the token rotates, the device id
  // does not, so the service upserts on device id.
  registerToken: publicProcedure
    .input(registerPushTokenSchema)
    .output(z.void())
    .mutation(({ ctx, input }) => registerPushToken(ctx.db, input)),

  // Raise a notification from the panel or an external producer. Writes the row
  // and enqueues the APNs fan-out job.
  raise: publicProcedure
    .input(raiseNotificationSchema)
    .output(notificationItemSchema)
    .mutation(({ ctx, input }) => raiseNotification(ctx.db, input)),
});
