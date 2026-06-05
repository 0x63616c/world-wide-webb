/**
 * Controls tile — lamps, ceiling lights, fan + "More" placeholder.
 * Ported from the ETap / ctrl cell in evee-tiles.jsx / Evee Dashboard.html.
 *
 * Data: trpc.controls.list (refetch 30s idle, 2s while any control is pending).
 *   After a toggle the poll is paused for COOLDOWN_MS so the backend's desired-
 *   window overlay has time to establish before HA confirms — matching evee's
 *   FanTile cooldown pattern and preventing the snap-back flicker bug.
 * Mutations: trpc.controls.toggle — backend owns correctness, no client-side cache manipulation.
 */

import { useEffect, useRef, useState } from "react";
import type { RouterOutputs } from "../../lib/trpc";
import { trpc } from "../../lib/trpc";
import type { ControlKey } from "./ControlsTileView";
import { ControlsTileView } from "./ControlsTileView";
import { ExpandedControlsModalView } from "./ExpandedControlsModalView";

const COOLDOWN_AFTER_TOGGLE_MS = 5_000;

// ─── types ────────────────────────────────────────────────────────────────────

// Exported so existing tests can import it without going through the view module.
export type { ControlKey };

// ─── adaptive refetch interval ────────────────────────────────────────────────

// React Query passes the full Query object; we only care about its state data.
// The cooldownUntil ref is injected by the component so it can be checked inside.
// Exported for unit testing.
export function makeRefetchInterval(
  getCooldownUntil: () => number,
): (query: { state: { data?: RouterOutputs["controls"]["list"] } }) => number | false {
  return (query) => {
    // Pause polling entirely during the cooldown window so the backend's desired-
    // window overlay is visible before we reconcile with live HA state.
    if (Date.now() < getCooldownUntil()) return false;
    const data = query.state?.data;
    if (!data) return 5_000;
    const anyPending = data.lamps.pending || data.lights.pending || data.fan.pending;
    return anyPending ? 2_000 : 5_000;
  };
}

// ─── ControlsTile — thin container ────────────────────────────────────────────

export function ControlsTile() {
  const utils = trpc.useUtils();
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  // Stable ref so the refetch interval callback always reads the latest value
  // without needing to be recreated (avoids unnecessary query re-subscriptions).
  const cooldownRef = useRef(cooldownUntil);
  cooldownRef.current = cooldownUntil;

  const refetchInterval = makeRefetchInterval(() => cooldownRef.current);

  const { data } = trpc.controls.list.useQuery({}, { refetchInterval });

  // When cooldown expires, invalidate once to pull fresh HA state.
  useEffect(() => {
    if (cooldownUntil === 0) return;
    const remaining = cooldownUntil - Date.now();
    if (remaining <= 0) {
      void utils.controls.list.invalidate({});
      return;
    }
    const timer = setTimeout(() => {
      void utils.controls.list.invalidate({});
    }, remaining);
    return () => clearTimeout(timer);
  }, [cooldownUntil, utils]);

  const toggleMutation = trpc.controls.toggle.useMutation({
    // Optimistic flip so the tap responds instantly. pending:true bumps
    // adaptive refetch to 2s once the cooldown expires.
    onMutate: async ({ key, on }) => {
      await utils.controls.list.cancel({});
      const prev = utils.controls.list.getData({});
      utils.controls.list.setData({}, (old) => {
        if (!old) return old;
        if (key === "lamps") return { ...old, lamps: { ...old.lamps, on, pending: true } };
        if (key === "lights") return { ...old, lights: { ...old.lights, on, pending: true } };
        return { ...old, fan: { ...old.fan, on, pending: true } };
      });
      setCooldownUntil(Date.now() + COOLDOWN_AFTER_TOGGLE_MS);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) utils.controls.list.setData({}, ctx.prev);
    },
    // No invalidate on settled — the cooldown useEffect drives the reconcile
    // after the window expires, preventing snap-back to stale HA state.
  });

  // Lamp scene + brightness — backend owns correctness; on success the cooldown
  // useEffect will reconcile fresh HA state, so no client-side cache munging here.
  const sceneMutation = trpc.controls.setLampScene.useMutation({
    onSuccess: () => setCooldownUntil(Date.now() + COOLDOWN_AFTER_TOGGLE_MS),
  });
  const brightnessMutation = trpc.controls.setLampBrightness.useMutation({
    // Optimistically write the dragged value into the cache and pause polling for
    // the cooldown window so the slider doesn't snap back to the pre-drag value
    // before HA reports the new brightness (mirrors the toggle no-revert pattern).
    onMutate: async ({ pct }) => {
      await utils.controls.list.cancel({});
      const prev = utils.controls.list.getData({});
      utils.controls.list.setData({}, (old) =>
        old ? { ...old, lamps: { ...old.lamps, brightness: pct } } : old,
      );
      setCooldownUntil(Date.now() + COOLDOWN_AFTER_TOGGLE_MS);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) utils.controls.list.setData({}, ctx.prev);
    },
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
