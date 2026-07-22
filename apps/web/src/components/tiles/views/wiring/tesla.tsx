/**
 * Tesla tile , live wiring for its detail-page variants.
 *
 * Data source (all live, already exposed):
 *  - trpc.tesla.get → name/nick/locked/place/lat/lon/charging/chargingState/
 *    preconditioning/rate/pct/range/odo/climate. Polled at POLL.tesla (same
 *    query the TeslaTile container uses, so react-query dedupes the fetch).
 *
 * Mutations (real HA service calls behind the tRPC tesla router):
 *  - trpc.tesla.setLock           → lock.lock / lock.unlock
 *  - trpc.tesla.setCharging       → switch.turn_on / turn_off (charger)
 *  - trpc.tesla.setPreconditioning→ climate.turn_on / turn_off (cabin HVAC)
 *
 * Charge samples are accumulated CLIENT-SIDE here (useChargeSamples): a new
 * {ts,pct,rate} sample is pushed on every poll tick while the page is open.
 * History starts EMPTY and grows , never fabricated.
 */

import { useEffect, useRef, useState } from "react";
import type { DetailVariant, TileDetailPageEntry } from "@/components/tiles/detail/types";
import type { ChargeSample } from "@/components/tiles/views/TeslaModalChargeSession";
import { TeslaModalChargeSession } from "@/components/tiles/views/TeslaModalChargeSession";
import { TeslaModalLiveMapCommand } from "@/components/tiles/views/TeslaModalLiveMapCommand";
import { TeslaModalRangeReach } from "@/components/tiles/views/TeslaModalRangeReach";
import { TeslaModalVehicleVitals } from "@/components/tiles/views/TeslaModalVehicleVitals";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";

/** The six modal-side charging states. */
type ChargingState = "starting" | "charging" | "stopped" | "complete" | "disconnected" | "no_power";

const CHARGING_STATES: ReadonlySet<string> = new Set<ChargingState>([
  "starting",
  "charging",
  "stopped",
  "complete",
  "disconnected",
  "no_power",
]);

/**
 * Narrow the raw `sensor.evee_charging` enum to the modal union. An empty /
 * unrecognised state (entity asleep or absent) maps to "disconnected" , the
 * neutral "no active session" display, not fabricated charge data.
 */
function toChargingState(raw: string): ChargingState {
  return CHARGING_STATES.has(raw) ? (raw as ChargingState) : "disconnected";
}

/**
 * Accumulate charge telemetry while the page is open. Pushes one sample per
 * distinct poll (keyed on the data's reference identity) so re-renders don't
 * duplicate points. Starts empty; resets when the session ends/disconnects.
 */
function useChargeSamples(
  pct: number,
  rate: number,
  chargingState: ChargingState,
  data: unknown,
): ChargeSample[] {
  const [samples, setSamples] = useState<ChargeSample[]>([]);
  const lastData = useRef<unknown>(null);

  useEffect(() => {
    // Only sample on a genuinely fresh poll result, not every render.
    if (data === lastData.current) return;
    lastData.current = data;

    // Clear the trail once the car is no longer plugged in / charging , a new
    // session should start from an empty sparkline rather than stale points.
    if (chargingState === "disconnected") {
      setSamples((prev) => (prev.length ? [] : prev));
      return;
    }
    setSamples((prev) => [...prev, { ts: Date.now(), pct, rate }]);
  }, [data, pct, rate, chargingState]);

  return samples;
}

function useTeslaVariants(): { variants: DetailVariant[]; loading: boolean } {
  const query = trpc.tesla.get.useQuery(undefined, { refetchInterval: POLL.tesla });
  const utils = trpc.useUtils();

  const reconcile = () => {
    void utils.tesla.get.invalidate();
  };
  const lockMutation = trpc.tesla.setLock.useMutation({ onSettled: reconcile });
  const chargeMutation = trpc.tesla.setCharging.useMutation({ onSettled: reconcile });
  const preconditionMutation = trpc.tesla.setPreconditioning.useMutation({ onSettled: reconcile });

  const d = query.data;
  const chargingState = toChargingState(d?.chargingState ?? "");
  // Hooks must run unconditionally , the samples hook lives above the early
  // return and simply stays empty until data arrives.
  const samples = useChargeSamples(d?.pct ?? 0, d?.rate ?? 0, chargingState, d);

  if (!d) return { variants: [], loading: true };

  const toggleLock = () => lockMutation.mutate({ locked: !d.locked });
  const togglePrecondition = () => preconditionMutation.mutate({ on: !d.preconditioning });
  const isCharging = chargingState === "charging" || chargingState === "starting";
  const toggleCharge = () => chargeMutation.mutate({ on: !isCharging });

  const variants: DetailVariant[] = [
    {
      slug: "vehicle-vitals",
      label: "Vitals",
      render: () => (
        <TeslaModalVehicleVitals
          locked={d.locked}
          lockPending={lockMutation.isPending}
          cabinTempF={d.climate}
          preconditioning={d.preconditioning}
          preconditionPending={preconditionMutation.isPending}
          batteryPct={d.pct}
          rangeMiles={d.range}
          odometer={d.odo}
          chargingState={chargingState}
          placeName={d.place}
          onToggleLock={toggleLock}
          onTogglePrecondition={togglePrecondition}
        />
      ),
    },
    {
      slug: "live-map-command",
      label: "Map",
      render: () => (
        <TeslaModalLiveMapCommand
          lat={d.lat}
          lon={d.lon}
          place={d.place}
          locked={d.locked}
          chargingState={chargingState}
          batteryPct={d.pct}
          onToggleLock={toggleLock}
          onToggleCharge={toggleCharge}
        />
      ),
    },
    {
      slug: "charge-session",
      label: "Charge",
      render: () => (
        <TeslaModalChargeSession
          pct={d.pct}
          range={d.range}
          rate={d.rate}
          chargingState={chargingState}
          samples={samples}
          onStartCharge={() => chargeMutation.mutate({ on: true })}
          onStopCharge={() => chargeMutation.mutate({ on: false })}
          chargePending={chargeMutation.isPending}
        />
      ),
    },
    {
      slug: "range-reach",
      label: "Range",
      render: () => (
        <TeslaModalRangeReach pct={d.pct} rangeMiles={d.range} carLat={d.lat} carLon={d.lon} />
      ),
    },
  ];

  return { variants, loading: false };
}

export const teslaDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_tesla",
  title: "Tesla",
  defaultSlug: "vehicle-vitals",
  useVariants: useTeslaVariants,
};
