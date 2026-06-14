import { z } from "zod";
import { EventSelectSchema } from "../../db/zod-schemas";
import { listEvents } from "../../services/events-service";
import { publicProcedure, router } from "../init";

export const eventsRouter = router({
  list: publicProcedure
    .input(z.object({}).optional())
    // EventSelectSchema is derived from createSelectSchema(events): name +
    // place come directly from DB column types; date is overridden to z.string()
    // (the service serialises the timestamptz to ISO); days is extended as the
    // computed days-until field.  No hand-written shadow needed.
    .output(z.array(EventSelectSchema))
    .query(async ({ ctx }) => {
      return listEvents(ctx.db);
    }),
});
