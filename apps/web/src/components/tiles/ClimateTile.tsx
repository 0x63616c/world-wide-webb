/**
 * ClimateTile — thin container for the climate tile.
 *
 * Owns:
 *  - trpc.climate.get query with adaptive refetch (paused during cooldown)
 *  - optimistic mode + setpoint state (single target OR low/high range) so the
 *    UI responds instantly
 *  - 5 s cooldown poll-pause after any mutation (same pattern as ControlsTile)
 *    so HA's desired-window has time to settle before we reconcile
 *  - debounced setTarget / setRange mutations (400 ms) to reduce chatter while dragging
 *
 * Mode is the user's explicit choice (real HA hvac modes off/cool/heat/heat_cool),
 * NOT derived from the setpoint. Switching modes seeds sensible setpoints so the
 * UI has something to show before HA reports the new values.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { POLL } from "../../lib/hooks";
import { type RouterOutputs, trpc } from "../../lib/trpc";
import { type ClimateMode, ClimateTileView, GAP, MAX, MIN } from "./ClimateTileView";

const COOLDOWN_MS = 5_000;

// Default single setpoint when turning on from `off` (band midpoint).
const DEFAULT_TARGET = 72;

// Seed a low/high range around a single target (used when switching to heat_cool).
// Exported for unit testing.
export function rangeFromTarget(target: number): { low: number; high: number } {
  let low = Math.max(MIN, target - 3);
  let high = Math.min(MAX, target + 3);
  if (high - low < GAP) {
    high = Math.min(MAX, low + GAP);
    low = Math.max(MIN, high - GAP);
  }
  return { low, high };
}

// Collapse a range to a single setpoint (used when switching heat_cool → cool/heat).
// Exported for unit testing.
export function targetFromRange(low: number, high: number): number {
  return Math.round((low + high) / 2);
}

// Exported so unit tests can verify adaptive poll behaviour.
export function makeRefetchInterval(getCooldownUntil: () => number): () => number | false {
  return () => {
    if (Date.now() < getCooldownUntil()) return false;
    return POLL.climate;
  };
}

function actionLabel(mode: ClimateMode): string {
  if (mode === "cool") return "Cooling";
  if (mode === "heat") return "Heating";
  if (mode === "off") return "Off";
  return "Idle";
}

type ServerState = RouterOutputs["climate"]["get"];

// Current effective single/range setpoints from server state (with safe defaults).
function setpointsOf(data: ServerState): { target: number; low: number; high: number } {
  if (data.mode === "cool" || data.mode === "heat") {
    const { low, high } = rangeFromTarget(data.target);
    return { target: data.target, low, high };
  }
  if (data.mode === "heat_cool") {
    return {
      target: targetFromRange(data.targetLow, data.targetHigh),
      low: data.targetLow,
      high: data.targetHigh,
    };
  }
  const { low, high } = rangeFromTarget(DEFAULT_TARGET);
  return { target: DEFAULT_TARGET, low, high };
}

export function ClimateTile() {
  const utils = trpc.useUtils();

  const [cooldownUntil, setCooldownUntil] = useState(0);
  const cooldownRef = useRef(cooldownUntil);
  cooldownRef.current = cooldownUntil;

  const refetchInterval = makeRefetchInterval(() => cooldownRef.current);
  const query = trpc.climate.get.useQuery(undefined, { refetchInterval });

  const setTargetMutation = trpc.climate.setTarget.useMutation();
  const setRangeMutation = trpc.climate.setRange.useMutation();
  const setModeMutation = trpc.climate.setMode.useMutation();

  // Optimistic overlay, cleared after a mutation settles or cooldown expires.
  const [localMode, setLocalMode] = useState<ClimateMode | null>(null);
  const [localTarget, setLocalTarget] = useState<number | null>(null);
  const [localLow, setLocalLow] = useState<number | null>(null);
  const [localHigh, setLocalHigh] = useState<number | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLocal = useCallback(() => {
    setLocalMode(null);
    setLocalTarget(null);
    setLocalLow(null);
    setLocalHigh(null);
  }, []);

  // When cooldown expires, invalidate to reconcile with live HA state, then clear
  // the optimistic overlay ONLY AFTER the refetch lands. This is the single owner
  // of clearing the overlay (www-59u): clearing on mutation-settle instead snapped
  // the UI back to the stale, refetch-paused query.data for the rest of the cooldown.
  useEffect(() => {
    if (cooldownUntil === 0) return;
    const remaining = cooldownUntil - Date.now();
    if (remaining <= 0) {
      void utils.climate.get.invalidate().then(clearLocal);
      return;
    }
    const timer = setTimeout(() => {
      void utils.climate.get.invalidate().then(clearLocal);
    }, remaining);
    return () => clearTimeout(timer);
  }, [cooldownUntil, utils, clearLocal]);

  const startCooldown = useCallback(() => setCooldownUntil(Date.now() + COOLDOWN_MS), []);

  const handleSetTarget = useCallback(
    (val: number) => {
      setLocalTarget(val);
      startCooldown();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setTargetMutation.mutate(val);
      }, 400);
    },
    [setTargetMutation, startCooldown],
  );

  const handleSetRange = useCallback(
    (low: number, high: number) => {
      setLocalLow(low);
      setLocalHigh(high);
      startCooldown();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setRangeMutation.mutate({ low, high });
      }, 400);
    },
    [setRangeMutation, startCooldown],
  );

  // Hold the latest effective setpoints so a mode switch can seed from them.
  const effectiveRef = useRef({ target: DEFAULT_TARGET, low: 0, high: 0 });

  const handleSetMode = useCallback(
    (nextMode: ClimateMode) => {
      const { target, low, high } = effectiveRef.current;
      setLocalMode(nextMode);
      // Seed the setpoints the new mode needs from the current ones.
      if (nextMode === "cool" || nextMode === "heat") {
        setLocalTarget(low && high ? targetFromRange(low, high) : target);
        setLocalLow(null);
        setLocalHigh(null);
      } else if (nextMode === "heat_cool") {
        const seeded = rangeFromTarget(target);
        setLocalLow(seeded.low);
        setLocalHigh(seeded.high);
        setLocalTarget(null);
      } else {
        setLocalTarget(null);
        setLocalLow(null);
        setLocalHigh(null);
      }
      startCooldown();
      setModeMutation.mutate(nextMode);
    },
    [setModeMutation, startCooldown],
  );

  if (!query.data) return <ClimateTileView status="loading" />;

  const data = query.data;
  const server = setpointsOf(data);
  const mode = localMode ?? data.mode;
  const target = localTarget ?? server.target;
  const low = localLow ?? server.low;
  const high = localHigh ?? server.high;
  const action = localMode !== null ? actionLabel(mode) : (data.action ?? "");

  // Keep the seed source current for the next mode switch.
  effectiveRef.current = { target, low, high };

  const common = {
    status: "populated" as const,
    ambient: data.ambient,
    action,
    onSetMode: handleSetMode,
    onSetTarget: handleSetTarget,
    onSetRange: handleSetRange,
  };

  if (mode === "heat_cool") {
    return <ClimateTileView {...common} mode="heat_cool" targetLow={low} targetHigh={high} />;
  }
  if (mode === "cool" || mode === "heat") {
    return <ClimateTileView {...common} mode={mode} target={target} />;
  }
  return <ClimateTileView {...common} mode="off" />;
}
