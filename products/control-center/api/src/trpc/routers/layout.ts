import { getBoardLayout, layoutSchema, placementSchema, saveBoardLayout } from "../../services/board-layout-service";
import { publicProcedure, router } from "../init";
import { z } from "zod";

export const layoutRouter = router({
  /** Current board layout: per-tile placements + a revision (max updated_at). */
  get: publicProcedure.output(layoutSchema).query(({ ctx }) => getBoardLayout(ctx.db)),
  /** Replace the whole layout (last-write-wins across devices). */
  save: publicProcedure
    .input(z.object({ placements: z.array(placementSchema) }))
    .output(layoutSchema)
    .mutation(({ ctx, input }) => saveBoardLayout(ctx.db, input.placements)),
});
