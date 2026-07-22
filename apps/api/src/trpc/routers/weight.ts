import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index";
import { weightMeasurement } from "../../db/schema";
import { dailyMedians, summarize } from "../../services/weight-domain";
import { dayExpr, isValidTimeZone, notDeleted } from "../../services/weight-sql";
import { publicProcedure, router } from "../init";

const RANGE_DAYS = { "7d": 7, "30d": 30, all: null } as const;

/** The panel states its own zone; the api never infers one. */
export const tzInput = z.string().refine(isValidTimeZone, {
  message: "not a recognised IANA time zone",
});

export const weightRouter = router({
  // Daily-median series + window stats for the tile and Trend page. Null until
  // the first included reading exists (day-one skeleton).
  summary: publicProcedure
    .input(z.object({ range: z.enum(["7d", "30d", "all"]), tz: tzInput }))
    .query(async ({ input }) => {
      const days = RANGE_DAYS[input.range];
      const cutoff = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
      const rows = await db
        .select({
          day: dayExpr(input.tz),
          weightKg: weightMeasurement.weightKg,
        })
        .from(weightMeasurement)
        .where(
          and(
            isNull(weightMeasurement.excludedReason),
            notDeleted(),
            ...(cutoff ? [gte(weightMeasurement.measuredAt, cutoff)] : []),
          ),
        )
        .orderBy(weightMeasurement.measuredAt);
      if (rows.length === 0) return null;

      const daily = dailyMedians(rows);
      const s = summarize(
        daily,
        rows.map((r) => r.weightKg),
      );
      if (!s) return null;
      const latestDay = daily[daily.length - 1];
      if (!latestDay) return null;
      return {
        // The hero number is the latest DAY's median, so it agrees with the
        // chart and the average. It used to be the latest raw reading, which
        // disagreed with every other number on the page.
        latestKg: latestDay.kg,
        latestDay: latestDay.day,
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
