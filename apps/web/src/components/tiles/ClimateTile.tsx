/**
 * ClimateTile — thin container for the climate tile.
 *
 * Owns:
 *  - trpc.climate.get query with adaptive refetch (paused during cooldown)
 *  - optimistic setpoint and mode state so the UI responds instantly
 *  - 5 s cooldown poll-pause after any mutation (same pattern as ControlsTile)
 *    so HA's desired-window overlay has time to settle before we reconcile
 *  - debounced setTarget mutation (400 ms) to reduce chatter while dragging
 *
 * Mode thresholds (CC-6k8):
 *  - target <= 70  → cool
 *  - 71–75         → auto
 *  - target >= 76  → heat
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { POLL } from "../../lib/hooks";
import { trpc } from "../../lib/trpc";
import type { ClimateMode } from "./ClimateTileView";
import { ClimateTileView } from "./ClimateTileView";

const COOLDOWN_MS = 5_000;

// Derive display mode from setpoint (CC-6k8 thresholds).
// Exported for unit testing.
export function modeFromTarget(target: number): ClimateMode {
  if (target <= 70) return "cool";
  if (target >= 76) return "heat";
  return "auto";
}

// Exported so unit tests can verify adaptive poll behaviour.
export function makeRefetchInterval(getCooldownUntil: () => number): () => number | false {
  return () => {
    if (Date.now() < getCooldownUntil()) return false;
    return POLL.climate;
  };
}

export function ClimateTile() {
  const utils = trpc.useUtils();

  const [cooldownUntil, setCooldownUntil] = useState(0);
  const cooldownRef = useRef(cooldownUntil);
  cooldownRef.current = cooldownUntil;

  const refetchInterval = makeRefetchInterval(() => cooldownRef.current);

  const query = trpc.climate.get.useQuery(undefined, { refetchInterval });

  const setTargetMutation = trpc.climate.setTarget.useMutation();
  const setModeMutation = trpc.climate.setMode.useMutation();

  // Optimistic local state cleared after mutation settles or cooldown expires.
  const [localTarget, setLocalTarget] = useState<number | null>(null);
  const [localMode, setLocalMode] = useState<ClimateMode | null>(null);

  // Debounce ref for slider drags.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When cooldown expires, invalidate once to reconcile with live HA state.
  useEffect(() => {
    if (cooldownUntil === 0) return;
    const remaining = cooldownUntil - Date.now();
    if (remaining <= 0) {
      void utils.climate.get.invalidate();
      return;
    }
    const timer = setTimeout(() => {
      void utils.climate.get.invalidate();
      setLocalTarget(null);
      setLocalMode(null);
    }, remaining);
    return () => clearTimeout(timer);
  }, [cooldownUntil, utils]);

  const handleSetTarget = useCallback(
    (val: number) => {
      setLocalTarget(val);
      setLocalMode(modeFromTarget(val));
      setCooldownUntil(Date.now() + COOLDOWN_MS);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setTargetMutation.mutate(val, {
          onSuccess: () => {
            setLocalTarget(null);
            setLocalMode(null);
          },
          onError: () => {
            setLocalTarget(null);
            setLocalMode(null);
          },
        });
      }, 400);
    },
    [setTargetMutation],
  );

  const handleSetMode = useCallback(
    (mode: ClimateMode, presetTarget: number) => {
      setLocalTarget(presetTarget);
      setLocalMode(mode);
      setCooldownUntil(Date.now() + COOLDOWN_MS);
      setModeMutation.mutate(mode, {
        onSuccess: () => {
          setLocalTarget(null);
          setLocalMode(null);
        },
        onError: () => {
          setLocalTarget(null);
          setLocalMode(null);
        },
      });
    },
    [setModeMutation],
  );

  if (!query.data) return <ClimateTileView status="loading" />;

  const data = query.data;
  const target = localTarget ?? data.target;
  const mode = localMode ?? (data.mode as ClimateMode);
  // action pill: when overriding locally, derive a label; otherwise use server value
  const action =
    localMode !== null
      ? localMode === "cool"
        ? "Cooling"
        : localMode === "heat"
          ? "Heating"
          : "Auto"
      : (data.action ?? "");

  return (
    <ClimateTileView
      status="populated"
      target={target}
      ambient={data.ambient}
      mode={mode}
      action={action}
      onSetTarget={handleSetTarget}
      onSetMode={handleSetMode}
    />
  );
}
