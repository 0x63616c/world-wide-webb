/**
 * Controls tile — lamps, ceiling lights, fan + "More" placeholder.
 * Ported from the ETap / ctrl cell in evee-tiles.jsx / Evee Dashboard.html.
 *
 * Data: trpc.controls.list. The backend is now DESIRED-AUTHORITATIVE
 *   (www-7d5b.2.4) — getControlsState returns the DB's desired state, which the
 *   worker enforcer continuously reconciles onto HA. So a tap writes desired and
 *   the next read returns that same desired: there is no HA lag and no snap-back.
 *   The old cooldown/flicker hack (COOLDOWN_MS pause + desired-window overlay) is
 *   gone (www-7d5b.2.5). Polling is a simple steady refetch, faster while a
 *   control is briefly pending (desired set, HA not yet converged).
 * Mutations: backend owns correctness; we optimistically write the tapped value
 *   for instant feedback and invalidate on settle so the authoritative desired
 *   lands — it matches the optimistic value, so nothing snaps back.
 */

import { useState } from "react";
import type { RouterOutputs } from "@/lib/trpc";
import { trpc } from "@/lib/trpc";
import type { ControlKey } from "./ControlsTileView";
import { ControlsTileView } from "./ControlsTileView";
import { ExpandedControlsModalView } from "./ExpandedControlsModalView";

// ─── types ────────────────────────────────────────────────────────────────────

// Exported so existing tests can import it without going through the view module.
export type { ControlKey };

// ─── steady refetch interval ──────────────────────────────────────────────────

// React Query passes the full Query object; we only care about its state data.
// Steady poll, bumped to 2s while any control is pending (desired set but HA not
// yet converged) so the pending flag clears promptly. No cooldown pause — the
// backend is desired-authoritative, so there is no stale-HA window to hide.
// Exported for unit testing.
export function makeRefetchInterval(): (query: {
  state: { data?: RouterOutputs["controls"]["list"] };
}) => number {
  return (query) => {
    const data = query.state?.data;
    if (!data) return 5_000;
    const anyPending = data.lamps.pending || data.lights.pending || data.fan.pending;
    return anyPending ? 2_000 : 5_000;
  };
}

// ─── ControlsTile — thin container ────────────────────────────────────────────

export function ControlsTile() {
  const utils = trpc.useUtils();
  const [modalOpen, setModalOpen] = useState(false);

  const { data } = trpc.controls.list.useQuery({}, { refetchInterval: makeRefetchInterval() });

  const toggleMutation = trpc.controls.toggle.useMutation({
    // Optimistic flip so the tap responds instantly; pending:true bumps the
    // refetch to 2s. On settle we invalidate to pull the authoritative desired —
    // it equals the optimistic value, so the UI never snaps back.
    onMutate: async ({ key, on }) => {
      await utils.controls.list.cancel({});
      const prev = utils.controls.list.getData({});
      utils.controls.list.setData({}, (old) => {
        if (!old) return old;
        if (key === "lamps") return { ...old, lamps: { ...old.lamps, on, pending: true } };
        if (key === "lights") return { ...old, lights: { ...old.lights, on, pending: true } };
        return { ...old, fan: { ...old.fan, on, pending: true } };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) utils.controls.list.setData({}, ctx.prev);
    },
    onSettled: () => utils.controls.list.invalidate({}),
  });

  // Lamp scene — backend writes desired + actuates; invalidate on settle to pull
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

  function handleToggle(key: ControlKey, currentOn: boolean) {
    // Block mutation until the first query resolves — prevents corrupting an empty cache.
    if (!data) return;
    toggleMutation.mutate({ key, on: !currentOn });
  }

  if (!data) return <ControlsTileView status="loading" />;

  const viewData = {
    lamps: {
      on: data.lamps.on,
      sub: data.lamps.sub,
      pending: data.lamps.pending,
      brightness: data.lamps.brightness,
    },
    lights: { on: data.lights.on, pending: data.lights.pending },
    fan: { on: data.fan.on, sub: data.fan.sub, pending: data.fan.pending },
  };

  return (
    <>
      <ControlsTileView
        status="populated"
        data={viewData}
        onToggle={handleToggle}
        onMore={() => setModalOpen(true)}
      />
      <ExpandedControlsModalView
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        data={viewData}
        onToggle={handleToggle}
        onScene={(scene) => sceneMutation.mutate({ scene })}
        onBrightness={(pct) => brightnessMutation.mutate({ pct })}
      />
    </>
  );
}
