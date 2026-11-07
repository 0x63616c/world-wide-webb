import type { HaEntity } from "@www/core";
import { type TeslaEntities, teslaDataSchema } from "./contract";

/** Optional readings fail independently; never infer parked from absent motion. */
export async function readTeslaExtras(
  client: { getEntity(id: string): Promise<HaEntity | null> },
  ids: TeslaEntities,
) {
  const read = async (id: string | undefined) =>
    id ? client.getEntity(id).catch(() => null) : null;
  const [gear, online, cable, limit, complete] = await Promise.all([
    read(ids.shiftState),
    read(ids.vehicleOnline),
    read(ids.cableConnected),
    read(ids.chargeLimit),
    read(ids.chargeCompleteAt),
  ]);
  const binary = (entity: HaEntity | null) =>
    entity?.state === "on" ? true : entity?.state === "off" ? false : undefined;
  const driveState = ({ p: "parked", d: "driving", r: "reversing", n: "neutral" } as const)[
    gear?.state.trim().toLowerCase() as "p" | "d" | "r" | "n"
  ];
  const percent =
    limit?.attributes.unit_of_measurement === "%" && limit.state.trim()
      ? Number(limit.state)
      : undefined;
  const chargeLimit = teslaDataSchema.shape.chargeLimitPercent.safeParse(percent);
  const chargeComplete = teslaDataSchema.shape.chargeCompleteAt.safeParse(complete?.state);
  return {
    driveState,
    vehicleOnline: binary(online),
    cableConnected: binary(cable),
    chargeLimitPercent: chargeLimit.success ? chargeLimit.data : undefined,
    chargeCompleteAt: chargeComplete.success ? chargeComplete.data : undefined,
  };
}
