import { defineApi } from "@app-kit";
import { publicProcedure, router, TRPCError } from "@app-kit/server";
import { z } from "zod";
import { alarmIdSchema, alarmInputSchema, occurrenceActionSchema } from "./contract";
import { AlarmError, alarmService } from "./service";

const procedure = publicProcedure.use(async ({ next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof AlarmError) {
    const cause = result.error.cause;
    throw new TRPCError({
      code: cause.status === 404 ? "NOT_FOUND" : cause.status === 409 ? "CONFLICT" : "BAD_REQUEST",
      message: cause.message,
    });
  }
  return result;
});

export const api = defineApi(
  router({
    alarms: router({
      list: procedure.query(() => alarmService.snapshot()),
      create: procedure.input(alarmInputSchema).mutation(({ input }) => alarmService.create(input)),
      update: procedure
        .input(z.object({ id: alarmIdSchema, alarm: alarmInputSchema }))
        .mutation(({ input }) => alarmService.update(input.id, input.alarm)),
      setEnabled: procedure
        .input(z.object({ id: alarmIdSchema, enabled: z.boolean() }))
        .mutation(({ input }) => alarmService.setEnabled(input.id, input.enabled)),
      delete: procedure
        .input(z.object({ id: alarmIdSchema }))
        .mutation(({ input }) => alarmService.remove(input.id)),
      snooze: procedure
        .input(occurrenceActionSchema)
        .mutation(({ input }) => alarmService.act(input.id, input.version, "snooze")),
      stop: procedure
        .input(occurrenceActionSchema)
        .mutation(({ input }) => alarmService.act(input.id, input.version, "stop")),
    }),
  }),
);
