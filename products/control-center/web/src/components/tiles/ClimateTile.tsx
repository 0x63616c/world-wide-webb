/**
 * ClimateTile , thin container for the climate tile.
 *
 * Owns:
 *  - trpc.climate.get query with a steady refetch interval
 *  - optimistic mode + setpoint state (single target OR low/high range) so the
 *    UI responds instantly; cleared once a mutation settles and the authoritative
 *    desired state lands
 *
 * The backend is now DESIRED-AUTHORITATIVE (www-unxz): a mutation writes desired
 * to the DB and returns the same desired immediately; a climate-enforcer worker
 * actuates HA within ~1s. So the returned data matches the tapped value with no
 * round-trip lag , there is no stale-HA window to hide. The old cooldown
 * poll-pause and the 400ms setTarget/setRange debounce-for-latency are gone; we
 * mutate immediately and invalidate on settle.
 *
 * Mode is the user's explicit choice (real HA hvac modes off/cool/heat/heat_cool),
 * NOT derived from the setpoint. Switching modes seeds sensible setpoints so the
 * UI has something to show before the new values come back.
 */

import { useCallback, useRef, useState } from "react";
import { TileStatus } from "@/components/ui";
import { POLL } from "@/lib/hooks";
import { type RouterOutputs, trpc } from "@/lib/trpc";
import { type ClimateMode, ClimateTileView, GAP, HvacMode, MAX, MIN } from "./ClimateTileView";

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

function actionLabel(mode: ClimateMode): string {
  if (mode === HvacMode.Cool) return "Cooling";
  if (mode === HvacMode.Heat) return "Heating";
  if (mode === HvacMode.Off) return "Off";
  return "Idle";
}

type ServerState = RouterOutputs["climate"]["get"];

// Current effective single/range setpoints from server state (with safe defaults).
function setpointsOf(data: ServerState): { target: number; low: number; high: number } {
  if (data.mode === HvacMode.Cool || data.mode === HvacMode.Heat) {
    const { low, high } = rangeFromTarget(data.target);
    return { target: data.target, low, high };
  }
  if (data.mode === HvacMode.HeatCool) {
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

  // Optimistic overlay for instant feedback, cleared once a mutation settles and
  // the authoritative desired state (which matches the optimistic value) lands.
  const [localMode, setLocalMode] = useState<ClimateMode | null>(null);
  const [localTarget, setLocalTarget] = useState<number | null>(null);
  const [localLow, setLocalLow] = useState<number | null>(null);
  const [localHigh, setLocalHigh] = useState<number | null>(null);

  const clearLocal = useCallback(() => {
    setLocalMode(null);
    setLocalTarget(null);
    setLocalLow(null);
    setLocalHigh(null);
  }, []);

  // Invalidate to pull the authoritative desired, then clear the overlay only
  // AFTER the refetch lands so the UI never momentarily snaps to the previous
  // query.data between settle and refetch.
  const settle = useCallback(
    () => utils.climate.get.invalidate().then(clearLocal),
    [utils.climate.get, clearLocal],
  );

  const query = trpc.climate.get.useQuery(undefined, { refetchInterval: POLL.climate });

  const setTargetMutation = trpc.climate.setTarget.useMutation({ onSettled: settle });
  const setRangeMutation = trpc.climate.setRange.useMutation({ onSettled: settle });
  const setModeMutation = trpc.climate.setMode.useMutation({ onSettled: settle });

  const handleSetTarget = useCallback(
    (val: number) => {
      setLocalTarget(val);
      setTargetMutation.mutate(val);
    },
    [setTargetMutation],
  );

  const handleSetRange = useCallback(
    (low: number, high: number) => {
      setLocalLow(low);
      setLocalHigh(high);
      setRangeMutation.mutate({ low, high });
    },
    [setRangeMutation],
  );

  // Hold the latest effective setpoints so a mode switch can seed from them.
  const effectiveRef = useRef({ target: DEFAULT_TARGET, low: 0, high: 0 });

  const handleSetMode = useCallback(
    (nextMode: ClimateMode) => {
      const { target, low, high } = effectiveRef.current;
      setLocalMode(nextMode);
      // Seed the setpoints the new mode needs from the current ones.
      if (nextMode === HvacMode.Cool || nextMode === HvacMode.Heat) {
        setLocalTarget(low && high ? targetFromRange(low, high) : target);
        setLocalLow(null);
        setLocalHigh(null);
      } else if (nextMode === HvacMode.HeatCool) {
        const seeded = rangeFromTarget(target);
        setLocalLow(seeded.low);
        setLocalHigh(seeded.high);
        setLocalTarget(null);
      } else {
        setLocalTarget(null);
        setLocalLow(null);
        setLocalHigh(null);
      }
      setModeMutation.mutate(nextMode);
    },
    [setModeMutation],
  );

  if (!query.data) return <ClimateTileView status={TileStatus.Loading} />;

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
    status: TileStatus.Populated,
    ambient: data.ambient,
    action,
    onSetMode: handleSetMode,
    onSetTarget: handleSetTarget,
    onSetRange: handleSetRange,
  };

  if (mode === HvacMode.HeatCool) {
    return (
      <ClimateTileView {...common} mode={HvacMode.HeatCool} targetLow={low} targetHigh={high} />
    );
  }
  if (mode === HvacMode.Cool || mode === HvacMode.Heat) {
    return <ClimateTileView {...common} mode={mode} target={target} />;
  }
  return <ClimateTileView {...common} mode={HvacMode.Off} />;
}
