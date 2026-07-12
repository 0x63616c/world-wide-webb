import { z } from "zod";
import { EventInputSchema, EventSelectSchema } from "../../db/zod-schemas";
import { createEvent, deleteEvent, listEvents, updateEvent } from "../../services/events-service";
import { publicProcedure, router } from "../init";

export const eventsRouter = router({
  list: publicProcedure
    .input(z.object({}).optional())
    // EventSelectSchema is derived from createSelectSchema(events): id + name +
    // place come directly from DB column types; date is overridden to z.string()
    // (the service serialises the timestamptz to ISO); days is extended as the
    // computed days-until field.  No hand-written shadow needed.
    .output(z.array(EventSelectSchema))
    .query(async ({ ctx }) => {
      return listEvents(ctx.db);
    }),

  create: publicProcedure
    .input(EventInputSchema)
    .output(EventSelectSchema)
    .mutation(async ({ ctx, input }) => {
      return createEvent(ctx.db, input);
    }),

  update: publicProcedure
    .input(z.object({ id: z.number().int().positive() }).and(EventInputSchema))
    .output(EventSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      return updateEvent(ctx.db, id, fields);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .output(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      return deleteEvent(ctx.db, input.id);
    }),
});
