import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index";
import { weightMeasurement } from "../../db/schema";
import { dailyMedians, summarize } from "../../services/weight-domain";
import { publicProcedure, router } from "../init";

const RANGE_DAYS = { "7d": 7, "30d": 30, all: null } as const;

export const weightRouter = router({
  // Daily-median series + window stats for the tile and Trend page. Null until
  // the first included reading exists (day-one skeleton).
  summary: publicProcedure
    .input(z.object({ range: z.enum(["7d", "30d", "all"]) }))
    .query(async ({ input }) => {
      const days = RANGE_DAYS[input.range];
      const cutoff = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
      const rows = await db
        .select({
          measuredAt: weightMeasurement.measuredAt,
          weightKg: weightMeasurement.weightKg,
        })
        .from(weightMeasurement)
        .where(
          cutoff
            ? and(
                isNull(weightMeasurement.excludedReason),
                gte(weightMeasurement.measuredAt, cutoff),
              )
            : isNull(weightMeasurement.excludedReason),
        )
        .orderBy(weightMeasurement.measuredAt);
      if (rows.length === 0) return null;
      const daily = dailyMedians(rows);
      const s = summarize(daily);
      if (!s) return null;
      const latest = rows[rows.length - 1];
      if (!latest) return null;
      return {
        latestKg: latest.weightKg,
        latestAt: latest.measuredAt.toISOString(),
        daily,
        ...s,
      };
    }),

  // Every raw measurement newest-first, included AND excluded, for the Readings
  // page. deltaKg compares against the previous *included* reading.
  readings: publicProcedure.query(async () => {
    const rows = await db
      .select()
      .from(weightMeasurement)
      .orderBy(desc(weightMeasurement.measuredAt));
    let prevIncluded: number | null = null;
    return [...rows]
      .reverse()
      .map((r) => {
        const deltaKg =
          r.excludedReason == null && prevIncluded != null ? r.weightKg - prevIncluded : null;
        if (r.excludedReason == null) prevIncluded = r.weightKg;
        return {
          id: r.id,
          measuredAt: r.measuredAt.toISOString(),
          weightKg: r.weightKg,
          excludedReason: r.excludedReason,
          deltaKg,
        };
      })
      .reverse();
  }),

  // Manual include/exclude toggle from the Readings page; overrides the
  // auto sanity-band flag in both directions.
  setExcluded: publicProcedure
    .input(z.object({ id: z.string(), excluded: z.boolean() }))
    .mutation(async ({ input }) => {
      await db
        .update(weightMeasurement)
        .set({ excludedReason: input.excluded ? "manual" : null })
        .where(eq(weightMeasurement.id, input.id));
      return { ok: true } as const;
    }),
});
