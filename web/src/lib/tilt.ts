/**
 * Tilt math for the wall-mount level. Pure functions only , the sensor
 * subscription lives in useTiltAngle so this stays trivially unit-testable.
 *
 * Convention: the returned angle is the panel's roll in the plane of the wall,
 * in degrees, where 0 means level and POSITIVE means the RIGHT side of the
 * screen (as currently rendered) sits HIGH. That matches the iPhone Level app
 * and the full-screen level view, whose white plane lifts its right edge for
 * positive angles.
 */

/**
 * Screen-relative roll from a devicemotion gravity reading.
 *
 * `gx`/`gy` are `accelerationIncludingGravity` x/y in the DEVICE frame
 * (x toward the device's right edge in portrait, y toward its top). iOS
 * reports the gravity vector itself, so an upright portrait device reads
 * (0, -g). `screenAngle` is `screen.orientation.angle` , how far the rendered
 * screen is rotated from natural portrait , which re-expresses the reading in
 * the frame the user is actually looking at.
 *
 * Returns null when the device is lying flat (gravity has no usable in-plane
 * component, the wall-mount angle is undefined).
 */
export function tiltFromGravity(gx: number, gy: number, screenAngle: number): number | null {
  const magnitude = Math.hypot(gx, gy);
  // Below ~1 m/s² in-plane the device is face-up/face-down and the roll is
  // numerically unstable noise, not a mount angle.
  if (magnitude < 1) return null;
  // Angle of the gravity vector in the device x/y plane, measured from the
  // portrait "down" direction (0, -1). Positive when gravity swings toward +x,
  // i.e. the device's right side has dropped.
  const deviceRoll = (Math.atan2(gx, -gy) * 180) / Math.PI;
  // Rotating the rendered screen by `screenAngle` rotates "screen down" the
  // same amount within the device frame, so subtract it out.
  const screenRoll = deviceRoll - screenAngle;
  // Right side HIGH is positive (gravity swinging toward +x means right side
  // low, so flip), normalized to (-180, 180].
  return normalizeDegrees(-screenRoll);
}

/**
 * Screen-relative PITCH from a devicemotion gravity reading, in degrees.
 *
 * Roll (above) measures rotation within the plane of the wall; pitch measures
 * how far the panel leans out of it , the other thing you care about when
 * hanging a screen. Zero means perfectly vertical (the gravity vector lies in
 * the screen plane, so its out-of-plane component `gz` is nil); POSITIVE means
 * the panel is leaning BACK, top away from the viewer, screen tipped toward the
 * ceiling.
 *
 * Unlike roll this needs no `screenAngle`: `gz` is normal to the display, so it
 * is unaffected by how the rendered screen is rotated within that plane , which
 * also sidesteps the iPadOS screen-orientation mis-reporting that forces roll
 * through cardinalDeviation.
 *
 * Returns null when the reading has no usable magnitude (sensor garbage).
 */
export function pitchFromGravity(gx: number, gy: number, gz: number): number | null {
  const inPlane = Math.hypot(gx, gy);
  if (Math.hypot(inPlane, gz) < 1) return null;
  // Angle of gravity out of the screen plane. Face-up on a table reads +90°,
  // hanging flush on a wall reads 0°.
  return (Math.atan2(gz, inPlane) * 180) / Math.PI;
}

/**
 * Deviation from the nearest quarter-turn, in degrees, in [-45, 45].
 *
 * The wall panel always hangs a whole number of quarter-turns from portrait,
 * but iPadOS reports devicemotion axes and screen.orientation.angle
 * inconsistently inside the webview, so the absolute roll can come back offset
 * by ±90° (the mounted-landscape panel read "90" instead of "0"). The mount
 * error the level cares about is the distance to the nearest cardinal angle.
 */
export function cardinalDeviation(angle: number): number {
  return angle - Math.round(angle / 90) * 90;
}

/** Wrap an angle in degrees to the (-180, 180] range. */
export function normalizeDegrees(angle: number): number {
  const wrapped = ((angle % 360) + 540) % 360; // 0..360, shifted
  return wrapped - 180 === -180 ? 180 : wrapped - 180;
}

/** A single timestamped roll reading, as collected from the raw sensor. */
export interface TiltSample {
  /** Milliseconds on an arbitrary monotonic clock. */
  t: number;
  angle: number;
}

/**
 * Mean of the samples inside the trailing `windowMs`, or null when the window
 * is empty.
 *
 * The accelerometer fires at ~60Hz and every reading carries ~0.5° of jitter,
 * so publishing per event both re-renders 60 times a second and makes the
 * readout unreadable. Averaging a fixed time window instead of an exponential
 * blend keeps the settle time honest (it is exactly `windowMs`) regardless of
 * how fast the device happens to report.
 *
 * Mutates `samples` in place, dropping anything that has aged out, so callers
 * can keep one array alive for the life of the subscription.
 */
export function averageWindow(samples: TiltSample[], now: number, windowMs: number): number | null {
  const cutoff = now - windowMs;
  while (samples.length > 0 && samples[0].t < cutoff) samples.shift();
  if (samples.length === 0) return null;
  let sum = 0;
  for (const sample of samples) sum += sample.angle;
  return sum / samples.length;
}

/** Format an angle for display: "+0.4°", "-2.1°", "0°" when within `flatZone`. */
export function formatTilt(angle: number, flatZone = 0.15): string {
  if (Math.abs(angle) < flatZone) return "0°";
  const rounded = Math.abs(angle).toFixed(1).replace(/\.0$/, "");
  return `${angle > 0 ? "+" : "-"}${rounded}°`;
}

/** True when the panel counts as level (drives the blue flood + row color). */
export function isLevel(angle: number, flatZone = 0.15): boolean {
  return Math.abs(angle) < flatZone;
}
