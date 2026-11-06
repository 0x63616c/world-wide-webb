import {
  DeviceKind,
  type DeviceLightState,
  type DeviceStateStore,
  isLightState,
  LIGHTS,
  type LightEntry,
  LightKind,
  Room,
} from "@www/core";

export const BEDROOM_LAMPS = LIGHTS.filter(
  (entry) => entry.kind === LightKind.Lamp && entry.room === Room.Bedroom,
);

/** Caller holds lightTransaction. Shared by explicit app targets and input inversion. */
export async function writeLightGroup(
  entries: readonly LightEntry[],
  mutate: (entry: LightEntry, previous: DeviceLightState | null) => DeviceLightState,
  store: DeviceStateStore,
): Promise<void> {
  const rows = await store.list({ entityIds: entries.map((entry) => entry.entityId) });
  const byEntity = new Map(rows.map((row) => [row.entityId, row]));
  for (const entry of entries) {
    const value = byEntity.get(entry.entityId)?.desiredState;
    await store.upsertDesired({
      ...entry,
      kind: entry.kind === LightKind.Lamp ? DeviceKind.Light : DeviceKind.Switch,
      desired: mutate(entry, isLightState(value) ? value : null),
    });
  }
}
