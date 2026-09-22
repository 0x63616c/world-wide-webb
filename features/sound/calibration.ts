/**
 * Volume calibration math, shared by the API (which stores baselines and
 * reports them per room) and the web (which displays and drives volumes as a
 * percentage of the baseline). Browser-safe on purpose: no db, no HA.
 *
 * Ported from the Hammerspoon Sonos panel (dotfiles `hammerspoon/lib/sonos.lua`)
 * and kept behaviour-identical, including the two decisions that were learned
 * the hard way there:
 *
 *  - The baseline stored at calibration is `raw * 2`, UNCAPPED. Doubling makes
 *    the calibrated moment read back as exactly 50%, so there is headroom to
 *    go louder instead of pinning the raw volume at calibration time as the
 *    ceiling. A clamp to <=100 was tried and reverted: for any room already at
 *    or above raw 50 (the common case, calibrating at listening volume) it
 *    collapsed the baseline back to raw, so the room redisplayed as its raw
 *    number and calibration silently did nothing.
 *  - The displayed percentage is UNCAPPED above 100. A room that has been
 *    turned up past its calibration (from the Sonos app, say) reads as ">100%",
 *    which is the signal that it is past its calibrated ceiling. The raw
 *    volume actually SENT is always clamped to the speaker's real 0-100.
 *
 * A missing or zero baseline means "not calibrated": both directions pass the
 * value straight through (clamped, for the raw direction).
 */

/** Raw Sonos volume -> the percentage to display. Uncapped above 100. */
export function displayVolume(raw: number, baseline: number | null | undefined): number {
  if (!baseline || baseline <= 0) return raw;
  return Math.round((raw / baseline) * 100);
}

/**
 * The inverse: a displayed/dragged percentage -> the raw value to send.
 * Always clamped to Sonos' real 0-100 range, since a calibrated room showing
 * >100% (or a baseline above 100) would otherwise ask for a raw volume the
 * speaker doesn't accept.
 */
export function rawVolume(display: number, baseline: number | null | undefined): number {
  const raw = !baseline || baseline <= 0 ? display : (display * baseline) / 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * What calibrating stores as a room's new baseline, given the raw volume read
 * at that moment: double it, so that moment reads back as exactly 50%,
 * unconditionally. Do NOT reintroduce a clamp here (see the module comment).
 */
export function calibratedBaseline(raw: number): number {
  return raw * 2;
}

/** Per-room baselines keyed by room id (HA entity id). Absent = uncalibrated. */
export type CalibrationBaselines = Record<string, number>;

/**
 * Compute the new baselines for a calibration pass over `rooms`. A room read
 * as raw 0 (muted or silent) keeps whatever baseline it already had rather
 * than storing an unusable zero, exactly as the Hammerspoon panel does.
 * Returns only the rooms that get a NEW baseline.
 */
export function baselinesForCalibration(
  rooms: ReadonlyArray<{ uuid: string; volume: number }>,
): CalibrationBaselines {
  const next: CalibrationBaselines = {};
  for (const room of rooms) {
    if (room.volume > 0) next[room.uuid] = calibratedBaseline(room.volume);
  }
  return next;
}
