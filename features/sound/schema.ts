import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Per-room volume calibration, one row PER SONOS ROOM keyed on the Home
// Assistant media_player entity id (the room's stable `uuid` in the sound
// facet). Mirrors the Hammerspoon Sonos panel's persisted baselines
// (dotfiles `hammerspoon/sonos.lua`), but shared: calibration describes the
// speakers, not the viewer, so the wall panel and a phone must agree on it.
//
// `baseline` is the raw Sonos volume the room is considered "100%" at. It is
// stored as raw*2 at the moment of calibration (so that moment reads back as
// exactly 50%, leaving headroom) and is deliberately allowed above 100: a
// clamp was tried in Hammerspoon and reverted because calibrating a room
// already above half volume became a no-op. See ./calibration.ts.
//
// A room with no row is uncalibrated and displays its raw volume. Clearing
// calibration DELETES the row rather than zeroing it (a zero baseline would be
// a divide-by-zero in the display math and is never stored).
export const soundCalibration = pgTable("sound_calibration", {
  roomId: text("room_id").primaryKey(),
  baseline: integer("baseline").notNull(),
  updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).notNull().defaultNow(),
});
