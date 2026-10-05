import {
  createPgDeviceStateStore,
  DeviceKind,
  type DeviceStateStore,
  findLight,
  type HomeAssistantClient,
  haFromConfig,
  isLightState,
  mapHaToReported,
} from "@www/core";
import { config } from "./config";
import { db } from "./db";

const ha = haFromConfig(config);
const store = createPgDeviceStateStore(db);

export async function turnOnAlarmLights(
  target: string,
  client: HomeAssistantClient = ha,
  devices: DeviceStateStore = store,
) {
  if (target.startsWith("scene.")) {
    const scene = await client.getEntity(target);
    const members = scene.attributes.entity_id;
    if (!Array.isArray(members) || !members.every((id): id is string => typeof id === "string")) {
      throw new Error("Alarm scene must expose its entity_id members");
    }
    const changed = await client.activateScene(target);
    for (const entityId of members) {
      const entry = findLight(entityId);
      if (!entry) continue;
      const entity =
        changed.find((state) => state.entity_id === entityId) ?? (await client.getEntity(entityId));
      const kind = entry.domain === "light" ? DeviceKind.Light : DeviceKind.Switch;
      const mapped = mapHaToReported(kind, entity);
      if (!mapped.available || !isLightState(mapped.reported))
        throw new Error("Alarm scene light is unavailable");
      await devices.upsertDesired({
        id: entry.id,
        entityId,
        kind,
        domain: entry.domain,
        label: entry.label,
        desired: mapped.reported,
      });
    }
    return;
  }
  for (const entityId of target.split(",")) {
    const entry = findLight(entityId);
    const domain = entityId.split(".")[0];
    if (entry) {
      const current = (await devices.readEffective(entry.id))?.state;
      const desired = { ...(isLightState(current) ? current : {}), on: true };
      // A stored zero brightness would make turn_on immediately turn a Hue off.
      if (domain === "light" && !desired.brightness) desired.brightness = 180;
      await devices.upsertDesired({
        id: entry.id,
        entityId,
        kind: domain === "light" ? DeviceKind.Light : DeviceKind.Switch,
        domain,
        label: entry.label,
        desired,
      });
    }
    await client.callService(domain, "turn_on", { entity_id: entityId });
  }
}
