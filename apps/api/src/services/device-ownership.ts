import { DeviceKind, findLight } from "@www/core";

/**
 * The four reconcile loops that write the `device_state` table. Exactly one of
 * them OWNS any given row (see `ownerOf`).
 */
export const DeviceOwner = {
  LightEnforcer: "light-enforcer",
  ClimateEnforcer: "climate-enforcer",
  SonosVolumeEnforcer: "sonos-volume-enforcer",
  DeviceSync: "device-sync",
} as const;
export type DeviceOwner = (typeof DeviceOwner)[keyof typeof DeviceOwner];

/**
 * Which reconcile loop OWNS a `device_state` row , the single authority on who
 * writes its reported/available state and sweeps its expired command window.
 * This is row ownership expressed as DATA: device-sync used to carry the same
 * classification twice, as hand-maintained negative guards duplicated in
 * reconcile() and sweepExpiredWindows(), and every new enforcer had to remember
 * to extend both or silently reintroduce a double-drive. This function is the one
 * place that decision lives now.
 *
 * The fight-loop rationale, stated ONCE here: four loops write device_state. If
 * two claimed the same row they would double-drive it , e.g. device-sync would
 * snap a lamp to HA every cycle while the light enforcer pushed desired back onto
 * HA (or mark a speaker unavailable while the sonos enforcer holds its sticky
 * desired). So every row shape has EXACTLY ONE owner:
 *   - light-enforcer       : a configured LIGHTS entry (lamps + switch fixtures)
 *   - climate-enforcer      : the thermostat singleton (kind = climate)
 *   - sonos-volume-enforcer : a speaker row (kind = speaker; its entityId is a LAN
 *                             IP that never appears in the HA snapshot)
 *   - device-sync           : everything else (fans + plain HA devices)
 *
 * "Owner" means WHO RECONCILES/SWEEPS the row , NOT who may write desired onto
 * it. Any caller (a tRPC mutation, party mode) may write desired onto a row the
 * light-enforcer owns: that is a writer/owner distinction, by design, and not a
 * violation of single ownership (the light-enforcer still reconciles the row).
 */
export function ownerOf(row: { kind: string; entityId: string }): DeviceOwner {
  if (findLight(row.entityId)) return DeviceOwner.LightEnforcer;
  if (row.kind === DeviceKind.Climate) return DeviceOwner.ClimateEnforcer;
  if (row.kind === DeviceKind.Speaker) return DeviceOwner.SonosVolumeEnforcer;
  return DeviceOwner.DeviceSync;
}
