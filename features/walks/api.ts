import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { historyInput, startInput, stopInput, updateInput, walkId } from "./contract";
import { walkService } from "./service";

export const api = defineApi(
  router({
    walks: router({
      state: publicProcedure.query(() => walkService.state()),
      history: publicProcedure.input(historyInput).query(({ input }) => walkService.history(input)),
      start: publicProcedure.input(startInput).mutation(({ input }) => walkService.start(input)),
      stop: publicProcedure.input(stopInput).mutation(({ input }) => walkService.stop(input)),
      delete: publicProcedure
        .input(z.object({ id: walkId }))
        .mutation(({ input }) => walkService.delete(input.id)),
      update: publicProcedure.input(updateInput).mutation(({ input }) => walkService.update(input)),
    }),
  }),
);
