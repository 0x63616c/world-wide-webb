/**
 * Controls tile , lamps, ceiling lights, fan + "More" (opens the full-page
 * Controls detail). Ported from the ETap / ctrl cell in evee-tiles.jsx / Evee
 * Dashboard.html.
 *
 * Data: trpc.controls.list. The backend is now DESIRED-AUTHORITATIVE
 *   (www-7d5b.2.4) , getControlsState returns the DB's desired state, which the
 *   worker enforcer continuously reconciles onto HA. So a tap writes desired and
 *   the next read returns that same desired: there is no HA lag and no snap-back.
 *   The old cooldown/flicker hack (COOLDOWN_MS pause + desired-window overlay) is
 *   gone (www-7d5b.2.5). Polling is a simple steady refetch, faster while a
 *   control is briefly pending (desired set, HA not yet converged).
 * Mutations: backend owns correctness; we optimistically write the tapped value
 *   for instant feedback and invalidate on settle so the authoritative desired
 *   lands , it matches the optimistic value, so nothing snaps back.
 *
 * The query + mutation wiring lives in the exported useControls hook so the
 * full-page detail (detail/wiring/controls.tsx) reuses the exact same logic ,
 * both callers share one react-query key, so the fetch dedupes.
 */

import { useState } from "react";
import { TileStatus } from "@/components/ui";
import { openTileDetail } from "@/lib/tile-detail-store";
import type { RouterOutputs } from "@/lib/trpc";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import type { ControlKey, ControlsViewData } from "./ControlsTileView";
import { ControlsTileView } from "./ControlsTileView";
import type { LampScene } from "./ExpandedControlsView";
import type { PartySelection } from "./views/PartySpeedControls";
import { PartySpeed } from "./views/PartySpeedControls";

// ─── types ────────────────────────────────────────────────────────────────────

// Exported so existing tests can import it without going through the view module.
export type { ControlKey };

// ─── steady refetch interval ──────────────────────────────────────────────────

// React Query passes the full Query object; we only care about its state data.
// Steady poll, bumped to 2s while the FAN is pending (desired fan_mode set but HA
// not yet converged) so it clears promptly. Lamps/lights are desired-authoritative
// and never pending (www-uq58), so only the fan can bump the interval. No cooldown
// pause , the backend is desired-authoritative, so there is no stale-HA window.
// Exported for unit testing.
export function makeRefetchInterval(): (query: {
  state: { data?: RouterOutputs["controls"]["list"] };
}) => number {
  return (query) => {
    const data = query.state?.data;
    if (!data) return 5_000;
    return data.fan.pending ? 2_000 : 5_000;
  };
}

// ─── useControls , shared query + mutation wiring ─────────────────────────────

/** What useControls hands back: nothing but status until the query resolves,
 *  then the view data plus every control callback the tile face and the
 *  full-page detail need. Discriminated on status so callers narrow cleanly. */
export type UseControlsResult =
  | { status: typeof TileStatus.Loading | typeof TileStatus.Error }
  | {
      status: typeof TileStatus.Populated;
      viewData: ControlsViewData;
      onToggle: (key: ControlKey, currentOn: boolean) => void;
      onScene: (scene: LampScene) => void;
      onBrightness: (pct: number) => void;
      speed: PartySpeed;
      onPartySelect: (value: PartySelection) => void;
    };

export function useControls(): UseControlsResult {
  const utils = trpc.useUtils();
  // Party speed is a UI choice (getControlsState doesn't carry it back). Seeds the
  // segmented control + the speed sent with setLampMode. Defaults to Medium.
  const [partySpeed, setPartySpeed] = useState<PartySpeed>(PartySpeed.Medium);

  const tile = useTileQuery(
    trpc.controls.list.useQuery({}, { refetchInterval: makeRefetchInterval() }),
  );

  const toggleMutation = trpc.controls.toggle.useMutation({
    // Optimistic flip so the tap responds instantly; pending:true bumps the
    // refetch to 2s. On settle we invalidate to pull the authoritative desired ,
    // it equals the optimistic value, so the UI never snaps back.
    onMutate: async ({ key, on }) => {
      await utils.controls.list.cancel({});
      const prev = utils.controls.list.getData({});
      utils.controls.list.setData({}, (old) => {
        if (!old) return old;
        // Lamps/lights are desired-authoritative and never pending (www-uq58):
        // flip on instantly, no pending dim.
        if (key === "lamps") return { ...old, lamps: { ...old.lamps, on } };
        if (key === "lights") return { ...old, lights: { ...old.lights, on } };
        // Fan: also flip the sub label to the target so it never flashes the
        // stale "Auto" mid-toggle (www-qtdh) , the off position writes fanMode
        // Auto, so without this the old label paints until the settle refetch.
        return { ...old, fan: { ...old.fan, on, sub: on ? "On" : "Off", pending: true } };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) utils.controls.list.setData({}, ctx.prev);
    },
    onSettled: () => utils.controls.list.invalidate({}),
  });

  // Lamp scene , backend writes desired + actuates; invalidate on settle to pull
  // the authoritative desired (incl. the new activeScene). No snap-back.
  const sceneMutation = trpc.controls.setLampScene.useMutation({
    onSettled: () => utils.controls.list.invalidate({}),
  });
  const brightnessMutation = trpc.controls.setLampBrightness.useMutation({
    // Optimistically write the dragged value so the slider tracks the drag, then
    // invalidate on settle for the authoritative desired (which matches).
    onMutate: async ({ pct }) => {
      await utils.controls.list.cancel({});
      const prev = utils.controls.list.getData({});
      utils.controls.list.setData({}, (old) =>
        old ? { ...old, lamps: { ...old.lamps, brightness: pct } } : old,
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) utils.controls.list.setData({}, ctx.prev);
    },
    onSettled: () => utils.controls.list.invalidate({}),
  });

  // Lamp mode (party). The party worker owns the animation loop and the lamp_mode
  // row is authoritative, so activeScene='party' comes back from getControlsState.
  // Invalidate on settle to pull the new activeScene. No optimistic write , the
  // mode flip lands on the next read (sub-cycle).
  const modeMutation = trpc.controls.setLampMode.useMutation({
    onSettled: () => utils.controls.list.invalidate({}),
  });

  function handleToggle(key: ControlKey, currentOn: boolean) {
    // Block mutation until the first query resolves , prevents corrupting an empty cache.
    if (tile.status !== TileStatus.Populated) return;
    toggleMutation.mutate({ key, on: !currentOn });
  }

  if (tile.status !== TileStatus.Populated) return { status: tile.status };

  const data = tile.data;

  // The full-width party control emits its target: "off" stops party (mode none);
  // any speed starts party at that speed , or re-speeds a running party, since the
  // backend call is identical. We remember the chosen speed so the control re-seeds
  // its active segment (getControlsState doesn't carry speed back).
  function handlePartySelect(value: PartySelection) {
    if (value === "off") {
      modeMutation.mutate({ mode: "none" });
      return;
    }
    setPartySpeed(value);
    modeMutation.mutate({ mode: "party", speed: value });
  }

  const viewData: ControlsViewData = {
    lamps: {
      on: data.lamps.on,
      sub: data.lamps.sub,
      pending: data.lamps.pending,
      brightness: data.lamps.brightness,
      activeScene: data.lamps.activeScene,
    },
    lights: { on: data.lights.on, pending: data.lights.pending },
    fan: { on: data.fan.on, sub: data.fan.sub, pending: data.fan.pending },
  };

  return {
    status: TileStatus.Populated,
    viewData,
    onToggle: handleToggle,
    onScene: (scene) => sceneMutation.mutate({ scene }),
    onBrightness: (pct) => brightnessMutation.mutate({ pct }),
    speed: partySpeed,
    onPartySelect: handlePartySelect,
  };
}

// ─── ControlsTile , thin container ────────────────────────────────────────────

export function ControlsTile() {
  const controls = useControls();

  if (controls.status !== TileStatus.Populated) {
    return <ControlsTileView status={controls.status} />;
  }

  return (
    <ControlsTileView
      status={TileStatus.Populated}
      data={controls.viewData}
      onToggle={controls.onToggle}
      onMore={() => openTileDetail("tile_ctrl")}
    />
  );
}
