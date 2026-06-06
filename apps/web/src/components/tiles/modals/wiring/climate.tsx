/**
 * Climate tile (tile_ac) — live wiring for its detail-modal variants.
 *
 * Data source (all live): trpc.climate.zones → every house climate entity from
 * HA's `ha.getEntities('climate')` (Tesla excluded), each with full capability:
 * ambient, action, mode, hvacModes, single target | heat_cool range, min/max
 * temp, and (when the entity advertises them) preset/fan modes. If HA exposes a
 * single thermostat, `zones` is a one-element array — the multi-zone modals just
 * render one zone. No fixtures: the repo's zero-fake-data rule applies.
 *
 * Writes go through the entity-parameterized mutations (setModeFor/setTargetFor/
 * setRangeFor/setPreset/setFan), each of which returns the refreshed zones list,
 * which we push back into the query cache so the open modal updates immediately.
 *
 * ScheduleTimeline note: HA has NO schedule source. The modal itself declares its
 * `segments` to be a front-end POC structure, so we seed a single flat segment
 * from each zone's live committed setpoint (starting at hour 0), drive `nowHour`
 * off the wall clock, wire `onApplyNow` to the real setTarget mutation, and keep
 * `onSetSegment` as local-only state inside the view. We do NOT fabricate a
 * day-plan of invented setpoints.
 */

import { ClimateModalComfortPresetsFan } from "@/components/tiles/modals/ClimateModalComfortPresetsFan";
import {
  ClimateModalHouseThermalMap,
  type HvacMode as ThermalHvacMode,
} from "@/components/tiles/modals/ClimateModalHouseThermalMap";
import {
  ClimateModalMultiZoneGrid,
  type HvacMode as GridHvacMode,
  type ZoneData,
} from "@/components/tiles/modals/ClimateModalMultiZoneGrid";
import {
  ClimateModalScheduleTimeline,
  type ScheduleZone,
} from "@/components/tiles/modals/ClimateModalScheduleTimeline";
import type { LiveVariant, TileModalEntry } from "@/components/tiles/modals/types";
import { POLL, useNow } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";

// The server zone shape (mirrors ClimateZone in climate-service / climate router).
type ServerZone = {
  entityId: string;
  name: string;
  ambient: number;
  action: "Cooling" | "Heating" | "Idle";
  mode: string;
  hvacModes: string[];
  target: number | null;
  targetLow: number | null;
  targetHigh: number | null;
  minTemp: number;
  maxTemp: number;
  presetMode: string | null;
  presetModes: string[];
  fanMode: string | null;
  fanModes: string[];
};

type ModalAction = "cooling" | "heating" | "idle" | "off";

// Server reports a capitalised HvacAction; the modals consume lowercase. A zone
// whose mode is off is shown as action "off" regardless of the idle reading.
function toModalAction(action: ServerZone["action"], mode: string): ModalAction {
  if (mode === "off") return "off";
  if (action === "Cooling") return "cooling";
  if (action === "Heating") return "heating";
  return "idle";
}

function useClimateVariants(): { variants: LiveVariant[]; loading: boolean } {
  const now = useNow(60 * 1000);
  const utils = trpc.useUtils();
  const zonesQuery = trpc.climate.zones.useQuery(undefined, {
    refetchInterval: POLL.climate,
  });

  // After any write, the mutation returns the fresh zones — drop them straight
  // into the cache so the open modal reflects the change without a refetch.
  const onZones = {
    onSuccess: (data: ServerZone[]) => utils.climate.zones.setData(undefined, data),
  };
  const setModeFor = trpc.climate.setModeFor.useMutation(onZones);
  const setTargetFor = trpc.climate.setTargetFor.useMutation(onZones);
  const setRangeFor = trpc.climate.setRangeFor.useMutation(onZones);
  const setPreset = trpc.climate.setPreset.useMutation(onZones);
  const setFan = trpc.climate.setFan.useMutation(onZones);

  const zones = zonesQuery.data as ServerZone[] | undefined;
  if (!zones) return { variants: [], loading: true };

  // ── shared mutation callbacks ────────────────────────────────────────────
  const onSetMode = (entityId: string, mode: string) =>
    setModeFor.mutate({ entityId, mode: mode as "off" | "cool" | "heat" | "heat_cool" });
  const onSetTarget = (entityId: string, target: number) =>
    setTargetFor.mutate({ entityId, target });
  const onSetRange = (entityId: string, low: number, high: number) =>
    setRangeFor.mutate({ entityId, low, high });
  const onSetPreset = (entityId: string, preset: string) => setPreset.mutate({ entityId, preset });
  const onSetFan = (entityId: string, fanMode: string) => setFan.mutate({ entityId, fanMode });

  // ── per-modal projections of the live zones ──────────────────────────────

  // ComfortPresetsFan: only zones that actually advertise a preset OR fan mode
  // are meaningful here; HA-honest empty arrays render as "no presets" rows.
  const presetFanZones = zones.map((z) => ({
    entityId: z.entityId,
    label: z.name,
    hvacAction: toModalAction(z.action, z.mode),
    presetMode: z.presetMode ?? "",
    presetModes: z.presetModes,
    fanMode: z.fanMode ?? "",
    fanModes: z.fanModes,
  }));

  const thermalZones = zones.map((z) => ({
    entityId: z.entityId,
    name: z.name,
    currentTemperature: z.ambient,
    hvacAction: toModalAction(z.action, z.mode),
    hvacMode: z.mode as ThermalHvacMode,
    hvacModes: z.hvacModes as ThermalHvacMode[],
    targetTemperature: z.target,
    targetTempLow: z.targetLow,
    targetTempHigh: z.targetHigh,
    minTemp: z.minTemp,
    maxTemp: z.maxTemp,
  }));

  const gridZones: ZoneData[] = zones.map((z) => {
    const base = {
      entityId: z.entityId,
      name: z.name,
      ambient: z.ambient,
      action: toModalAction(z.action, z.mode),
      supportedModes: z.hvacModes as GridHvacMode[],
      minTemp: z.minTemp,
      maxTemp: z.maxTemp,
    };
    if (z.mode === "heat_cool") {
      return {
        ...base,
        mode: "heat_cool",
        targetLow: z.targetLow ?? z.minTemp,
        targetHigh: z.targetHigh ?? z.maxTemp,
      };
    }
    if (z.mode === "off") return { ...base, mode: "off" };
    return {
      ...base,
      mode: z.mode as "cool" | "heat" | "fan_only" | "dry" | "auto",
      target: z.target ?? z.ambient,
    };
  });

  // ScheduleTimeline: HA has no schedule. Seed a single flat segment from the
  // zone's committed setpoint (heat_cool uses the low bound as the planned
  // value). onApplyNow writes the real thermostat; onSetSegment is local-only.
  const scheduleZones: ScheduleZone[] = zones.map((z) => {
    const currentTarget = z.target ?? z.targetLow ?? z.ambient;
    return {
      entityId: z.entityId,
      name: z.name,
      ambient: z.ambient,
      currentTarget,
      action: toModalAction(z.action, z.mode),
      minTemp: z.minTemp,
      maxTemp: z.maxTemp,
      segments: [{ startHour: 0, setpoint: currentTarget }],
    };
  });

  const variants: LiveVariant[] = [
    {
      slug: "multi-zone-grid",
      label: "Zones",
      render: (open, onClose) => (
        <ClimateModalMultiZoneGrid
          open={open}
          onClose={onClose}
          zones={gridZones}
          onSetMode={onSetMode}
          onSetTarget={onSetTarget}
          onSetRange={onSetRange}
        />
      ),
    },
    {
      slug: "house-thermal-map",
      label: "Thermal Map",
      render: (open, onClose) => (
        <ClimateModalHouseThermalMap
          open={open}
          onClose={onClose}
          zones={thermalZones}
          onSetMode={onSetMode}
          onSetTarget={onSetTarget}
          onSetRange={onSetRange}
        />
      ),
    },
    {
      slug: "comfort-presets-fan",
      label: "Presets & Air",
      render: (open, onClose) => (
        <ClimateModalComfortPresetsFan
          open={open}
          onClose={onClose}
          zones={presetFanZones}
          onSetPreset={onSetPreset}
          onSetFan={onSetFan}
        />
      ),
    },
    {
      slug: "schedule-timeline",
      label: "Schedule",
      render: (open, onClose) => (
        <ClimateModalScheduleTimeline
          open={open}
          onClose={onClose}
          zones={scheduleZones}
          nowHour={now.getHours()}
          onApplyNow={(entityId, setpoint) => onSetTarget(entityId, setpoint)}
          onSetSegment={() => {
            // No HA schedule store — the view keeps segment edits in local state.
          }}
        />
      ),
    },
  ];

  return { variants, loading: false };
}

export const climateModalEntry: TileModalEntry = {
  tileId: "tile_ac",
  defaultSlug: "multi-zone-grid",
  useVariants: useClimateVariants,
};
