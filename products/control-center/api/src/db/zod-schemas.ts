// Zod schemas derived from Drizzle table definitions via drizzle-zod.
// Using createSelectSchema as the source of truth means field types stay in
// sync with the DB schema automatically , no hand-written shadow to drift.
//
// Router output schemas that need computed or renamed fields extend/override
// the base here; routers import from this file rather than re-declaring shapes.

import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { events } from "./schema";

// ─── events ──────────────────────────────────────────────────────────────────

// events.list output: name + place from the table; date is serialised to an
// ISO string by the service layer (DB column is timestamptz); days is computed
// (calendar days until the event in America/Los_Angeles).
export const EventSelectSchema = createSelectSchema(events, {
  // Override: the service converts the DB Date to an ISO string before
  // returning so the router output carries a string, not a native Date.
  date: z.string(),
})
  // `id` is surfaced so the manage UI can target edit/delete on a specific row.
  .pick({ id: true, name: true, place: true, date: true })
  .extend({ days: z.number().int().nonnegative() });

// events.create / events.update input: the writable fields. `name` and `date`
// are required; `place` is the optional location/venue (defaults to "" when the
// user leaves it blank). `date` is an ISO-8601 string the service parses to a Date.
export const EventInputSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  place: z.string().trim().default(""),
  date: z.string().datetime({ offset: true }),
});
