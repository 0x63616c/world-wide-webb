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
  .pick({ name: true, place: true, date: true })
  .extend({ days: z.number().int().nonnegative() });
