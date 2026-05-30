import { z } from "zod";
import { listEvents } from "../../services/events-service";
import { publicProcedure, router } from "../init";

const EventSchema = z.object({
  name: z.string(),
  place: z.string(),
  days: z.number().int().nonnegative(),
});

export const eventsRouter = router({
  list: publicProcedure
    .input(z.object({}).optional())
    .output(z.array(EventSchema))
    .query(async ({ ctx }) => {
      return listEvents(ctx.db);
    }),
});
