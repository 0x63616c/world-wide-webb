import { getLogger } from "@www/logger";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index";
import { weightMeasurement } from "../../db/schema";
import { dailyMedians, median, summarize } from "../../services/weight-domain";
import { dayExpr, isValidTimeZone, notDeleted } from "../../services/weight-sql";
import { publicProcedure, router } from "../init";

const RANGE_DAYS = { "7d": 7, "30d": 30, all: null } as const;

/** The panel states its own zone; the api never infers one. */
export const tzInput = z.string().refine(isValidTimeZone, {
  message: "not a recognised IANA time zone",
});

interface DayRow {
  id: string;
  day: string;
  measuredAt: Date;
  weightKg: number;
  excludedReason: string | null;
}

/**
 * Rows (newest first, already day-keyed) → day groups.
 *
 * The day median counts only included readings — that is the number the trend
 * line plots — while the reading list shows everything so an auto-flagged
 * outlier stays visible and reversible. dayDeltaKg compares against the
 * previous RECORDED day, which with a gap in weigh-ins spans more than 24h.
 */
export function assembleDays(rows: DayRow[]) {
  const order: string[] = [];
  const byDay = new Map<string, DayRow[]>();
  for (const r of rows) {
    const existing = byDay.get(r.day);
    if (existing) existing.push(r);
    else {
      byDay.set(r.day, [r]);
      order.push(r.day);
    }
  }

  const days = order.map((day) => {
    const dayRows = byDay.get(day) ?? [];
    const included = dayRows.filter((r) => r.excludedReason == null);
    // Deltas compare against the previous OLDER included reading, so walk the
    // day oldest-first and reverse back.
    const oldestFirst = [...dayRows].reverse();
    let prevIncludedKg: number | null = null;
    const withDeltas = oldestFirst.map((r) => {
      const deltaKg =
        r.excludedReason == null && prevIncludedKg != null ? r.weightKg - prevIncludedKg : null;
      if (r.excludedReason == null) prevIncludedKg = r.weightKg;
      return {
        id: r.id,
        measuredAt: r.measuredAt.toISOString(),
        weightKg: r.weightKg,
        excludedReason: r.excludedReason,
        deltaKg,
      };
    });
    return {
      day,
      medianKg: median(included.map((r) => r.weightKg)),
      dayDeltaKg: null as number | null,
      readings: withDeltas.reverse(),
    };
  });

  return days.map((d, i) => {
    const older = days[i + 1];
    const comparable = older && Number.isFinite(d.medianKg) && Number.isFinite(older.medianKg);
    return { ...d, dayDeltaKg: comparable ? d.medianKg - older.medianKg : null };
  });
}

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

  // One page of days, newest first, for the Readings page. Two queries so a
  // page boundary can never split a day in half: pick the days, then fetch
  // every reading belonging to them.
  days: publicProcedure
    .input(
      z.object({
        tz: tzInput,
        /** Exclusive: return days strictly older than this YYYY-MM-DD. */
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(90).default(14),
      }),
    )
    .query(async ({ input }) => {
      const day = dayExpr(input.tz);
      const dayRows = await db
        .selectDistinct({ day })
        .from(weightMeasurement)
        .where(and(notDeleted(), ...(input.cursor ? [lt(day, input.cursor)] : [])))
        // Order by ORDINAL, not by repeating the expression. dayExpr() binds tz
        // as a parameter and is rendered independently per clause, so the SELECT
        // list gets $1 and an ORDER BY copy would get $4 — and Postgres matches
        // SELECT DISTINCT against ORDER BY by expression equality, where
        // Param(1) != Param(4). Repeating it raises 42P10 on every call.
        .orderBy(sql`1 desc`)
        .limit(input.limit + 1);

      // The extra row tells us whether another page exists without a count(*).
      const hasMore = dayRows.length > input.limit;
      const pageDays = dayRows.slice(0, input.limit).map((d) => d.day);
      if (pageDays.length === 0) return { days: [], nextCursor: null };

      const rows = await db
        .select({
          id: weightMeasurement.id,
          day,
          measuredAt: weightMeasurement.measuredAt,
          weightKg: weightMeasurement.weightKg,
          excludedReason: weightMeasurement.excludedReason,
        })
        .from(weightMeasurement)
        .where(and(notDeleted(), inArray(day, pageDays)))
        .orderBy(desc(weightMeasurement.measuredAt));

      return {
        days: assembleDays(rows),
        nextCursor: hasMore ? (pageDays[pageDays.length - 1] ?? null) : null,
      };
    }),

  // Manual include/exclude toggle from the Readings page; overrides the
  // auto sanity-band flag in both directions.
  setExcluded: publicProcedure
    .input(z.object({ id: z.string(), excluded: z.boolean() }))
    .mutation(async ({ input }) => {
      await db
        .update(weightMeasurement)
        .set({ excludedReason: input.excluded ? "manual" : null })
        .where(and(eq(weightMeasurement.id, input.id), notDeleted()));
      return { ok: true } as const;
    }),

  // Tombstone, never a hard DELETE: ingest re-inserts any row it can still see
  // in the HA sensor's current state (weight-service.ts).
  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    await db
      .update(weightMeasurement)
      .set({ deletedAt: new Date() })
      .where(eq(weightMeasurement.id, input.id));
    getLogger().info({ id: input.id }, "weight measurement deleted");
    return { ok: true } as const;
  }),
});
