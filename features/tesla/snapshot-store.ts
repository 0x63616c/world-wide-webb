import { DeviceKind, type DeviceStateStore } from "@www/core";
import { genId } from "@www/platform";
import { type TeslaState, teslaDataSchema } from "./contract";

// A stable singleton within this integration, independent of HA sensor renames.
const entityId = "tesla.vehicle";
export function createTeslaSnapshotStore(store: DeviceStateStore) {
  return {
    async read(): Promise<Extract<TeslaState, { status: "ready" }> | null> {
      const [row] = await store.list({ kind: DeviceKind.Vehicle, entityIds: [entityId] });
      const data = teslaDataSchema.safeParse(row?.reportedState);
      if (!data.success || !row?.reportedAtUtc) return null;
      return {
        status: "ready",
        data: data.data,
        stale: true,
        lastUpdatedAt: row.reportedAtUtc.toISOString(),
      };
    },
    async write(data: Extract<TeslaState, { status: "ready" }>["data"], now: Date) {
      await store.seed({
        id: genId("dev"),
        kind: DeviceKind.Vehicle,
        entityId,
        domain: "tesla",
        label: "Tesla",
        reported: data,
        available: true,
        now,
      });
      const [row] = await store.list({ kind: DeviceKind.Vehicle, entityIds: [entityId] });
      if (!row) throw new Error("Tesla snapshot row unavailable");
      await store.writeReported({ id: row.id, reported: data, available: true, now });
    },
  };
}
export type TeslaSnapshotStore = ReturnType<typeof createTeslaSnapshotStore>;
