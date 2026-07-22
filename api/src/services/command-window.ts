// The app-command window (www-unxz.1). A control mutation writes desired and
// returns WITHOUT actuating HA , the enforcer pushes desired→HA. While
// `now < desiredUntilUtc` the enforcer pushes regardless of control policy, so a
// freshly-set desired is honored even on an `adopt` wall-switch fixture (which
// would otherwise revert it on the next cycle). The enforcer runs ~1s; 10s covers
// slow HA round-trips so the desired is pushed before the window lapses.
export const COMMAND_WINDOW_MS = 10_000;

/** The `desiredUntilUtc` value a control write stamps: `now` + the command window. */
export function stampCommandWindow(now: Date): Date {
  return new Date(now.getTime() + COMMAND_WINDOW_MS);
}

/** True while a stamped desired is still inside its command window. */
export function windowOpen(row: { desiredUntilUtc: Date | null }, now: Date): boolean {
  return row.desiredUntilUtc != null && now < row.desiredUntilUtc;
}
