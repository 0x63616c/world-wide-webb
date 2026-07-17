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

/** Wrap an angle in degrees to the (-180, 180] range. */
export function normalizeDegrees(angle: number): number {
  const wrapped = ((angle % 360) + 540) % 360; // 0..360, shifted
  return wrapped - 180 === -180 ? 180 : wrapped - 180;
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
