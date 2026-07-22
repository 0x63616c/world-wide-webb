/**
 * The two predicates every weight query needs, in one place.
 *
 * A calendar day does not exist without a timezone, and the api must never
 * infer one from its own environment — so the day expression takes the zone
 * the caller supplied and hands it to Postgres as a BOUND PARAMETER. Postgres
 * applies the correct UTC offset per row, which means DST transitions are
 * handled for free and no string interpolation ever touches the query.
 */
import { isNull, sql } from "drizzle-orm";
import { weightMeasurement } from "../db/schema";

/** Local calendar day of a reading, as YYYY-MM-DD in the caller's zone. */
export function dayExpr(tz: string) {
  return sql<string>`to_char(${weightMeasurement.measuredAt} AT TIME ZONE ${tz}, 'YYYY-MM-DD')`;
}

/** Tombstoned rows are invisible to every read. */
export function notDeleted() {
  return isNull(weightMeasurement.deletedAt);
}

/** True when Intl recognises the name, which is what Postgres also accepts. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
