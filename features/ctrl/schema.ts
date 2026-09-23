import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Persistent lamp mode, a SINGLETON row (id = LAMP_MODE_SINGLETON_ID). Holds the
// active animated lamp mode that can't be inferred from a color snapshot, so it
// must be durable: the worker reconciles it (start/stop the party engine) and
// re-arms after a restart. `mode` is 'none' | 'party' (LampMode); `speed` is
// 'slow' | 'medium' | 'fast' (LampModeSpeed) and only meaningful for animated
// modes. Modeled on integration_sync_status's keyed-singleton shape (www-7d5b.3.2).
export const LAMP_MODE_SINGLETON_ID = "singleton";

/** Three durable, user-editable lamp colors. Their values share lamp_mode's
 * keyed storage without adding another singleton table. */
export const LampColorSlot = {
  Red: "red",
  Blue: "blue",
  Custom: "custom",
} as const;
export type LampColorSlot = (typeof LampColorSlot)[keyof typeof LampColorSlot];

export function lampColorRowId(slot: LampColorSlot): string {
  return `color:${slot}`;
}

/** The white scene's stored color temperature (kelvin, as text in `mode`),
 * one more keyed row in lamp_mode's storage beside the saved colors. */
export const WHITE_KELVIN_ROW_ID = "white:kelvin";

export const lampMode = pgTable("lamp_mode", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull().default("none"),
  speed: text("speed"),
  updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).notNull().defaultNow(),
});
