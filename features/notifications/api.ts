import { defineApi } from "@app-kit";
import { publicProcedure, router, TRPCError } from "@app-kit/server";
import { notificationIdSchema, notificationInputSchema, notificationListSchema } from "./contract";
import { notificationService } from "./service";

const action = async (id: string, kind: "read" | "dismiss") => {
  const row = await notificationService.act(id, kind);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Notification not found" });
  return row;
};
export const api = defineApi(
  router({
    notifications: router({
      create: publicProcedure
        .input(notificationInputSchema)
        .mutation(({ input }) => notificationService.create(input)),
      list: publicProcedure
        .input(notificationListSchema)
        .query(({ input }) => notificationService.list(input)),
      read: publicProcedure
        .input(notificationIdSchema)
        .mutation(({ input }) => action(input.id, "read")),
      dismiss: publicProcedure
        .input(notificationIdSchema)
        .mutation(({ input }) => action(input.id, "dismiss")),
      dismissAll: publicProcedure.mutation(() => notificationService.dismissAll()),
    }),
  }),
);
