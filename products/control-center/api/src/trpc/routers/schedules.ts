import { z } from "zod";

import { LIGHTS } from "../../config/lights";
import {
  createSchedule,
  deleteSchedule,
  getTodaySun,
  listSchedules,
  localDateKey,
  resolveTriggerTime,
  scheduleInputSchema,
  setScheduleEnabled,
  updateSchedule,
} from "../../services/schedule-service";
import { publicProcedure, router } from "../init";

export const schedulesRouter = router({
  // The selectable lights for the schedule editor's target picker (real config,
  // not a hardcoded web copy). id = the value stored in a schedule's targetIds.
  lights: publicProcedure.query(() =>
    LIGHTS.map((l) => ({ id: l.id, label: l.label, room: l.room, kind: l.kind })),
  ),

  list: publicProcedure.query(() => listSchedules()),

  create: publicProcedure.input(scheduleInputSchema).mutation(({ input }) => createSchedule(input)),

  update: publicProcedure
    .input(z.object({ id: z.string(), patch: scheduleInputSchema.partial() }))
    .mutation(({ input }) => updateSchedule(input.id, input.patch)),

  remove: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    await deleteSchedule(input.id);
    return { ok: true };
  }),

  setEnabled: publicProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ input }) => setScheduleEnabled(input.id, input.enabled)),

  // Next upcoming fire time per schedule, for the tile "next up" line. Computed
  // server-side so the web has no sun math. ISO string or null (no sun data).
  nextRuns: publicProcedure.query(async () => {
    const now = new Date();
    const sun = await getTodaySun(localDateKey(now));
    const schedules = await listSchedules();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    return schedules.map((s) => {
      const t = resolveTriggerTime(s.trigger, dayStart, sun);
      return { id: s.id, nextIso: t ? t.toISOString() : null };
    });
  }),
});
