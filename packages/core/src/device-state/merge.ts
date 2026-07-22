import type { DeviceClimateState, DeviceLightState, DeviceStateValue, LightColor } from "./schema";
import type { MergedDeviceState } from "./store";

// ─── TODO(task-4): replace with core merge module ─────────────────────────────
// The following helpers are copied verbatim (behavior-for-behavior) from
// `api/src/services/device-state-mapping.ts` so `readEffective` matches the
// enforcer's merge semantics until the shared merge module lands in Task 4,
// which deletes this whole block and imports the real thing instead. Shared
// between the memory and pg adapters (Task 3) so both stay behavior-identical.

function isLightState(v: DeviceStateValue | null | undefined): v is DeviceLightState {
  return v != null && typeof (v as DeviceLightState).on === "boolean";
}

function isClimateState(v: DeviceStateValue | null | undefined): v is DeviceClimateState {
  return (
    v != null &&
    typeof (v as DeviceClimateState).mode === "string" &&
    typeof (v as DeviceLightState).on !== "boolean"
  );
}

const HvacModeValue = { Off: "off" } as const;

function sanitizeClimateDesired(state: DeviceClimateState): DeviceClimateState {
  const clean: DeviceClimateState = { mode: state.mode };
  if (state.target != null) clean.target = state.target;
  if (state.targetLow != null) clean.targetLow = state.targetLow;
  if (state.targetHigh != null) clean.targetHigh = state.targetHigh;
  if (state.fanMode != null) clean.fanMode = state.fanMode;
  return clean;
}

function climateSetpointsObservable(state: DeviceClimateState): boolean {
  return state.mode !== HvacModeValue.Off;
}

function climateStateConverged(
  desired: DeviceClimateState,
  reported: DeviceClimateState,
  opts: { ignoreFan?: boolean } = {},
): boolean {
  if (desired.mode !== reported.mode) return false;
  if (climateSetpointsObservable(reported)) {
    if (desired.target != null && desired.target !== reported.target) return false;
    if (desired.targetLow != null && desired.targetLow !== reported.targetLow) return false;
    if (desired.targetHigh != null && desired.targetHigh !== reported.targetHigh) return false;
  }
  if (!opts.ignoreFan && desired.fanMode != null && desired.fanMode !== reported.fanMode) {
    return false;
  }
  return true;
}

const RGB_CHANNEL_TOLERANCE = 12;
const KELVIN_TOLERANCE = 250;
const BRIGHTNESS_TOLERANCE = 3;

function colorConverged(a: LightColor | undefined, b: LightColor | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const aKelvin = a.kelvin != null;
  const bKelvin = b.kelvin != null;
  if (aKelvin !== bKelvin) return false;
  if (aKelvin && bKelvin) return Math.abs((a.kelvin ?? 0) - (b.kelvin ?? 0)) <= KELVIN_TOLERANCE;
  const ar = a.rgb;
  const br = b.rgb;
  if (!ar || !br) return !ar && !br;
  return ar.every((c, i) => Math.abs(c - (br[i] as number)) <= RGB_CHANNEL_TOLERANCE);
}

function converged(desired: DeviceStateValue, reported: DeviceStateValue): boolean {
  if (isClimateState(desired) || isClimateState(reported)) {
    if (!isClimateState(desired) || !isClimateState(reported)) return false;
    return climateStateConverged(desired, reported);
  }
  if (!isLightState(desired) || !isLightState(reported)) return false;
  if (desired.on !== reported.on) return false;
  if (!desired.on) return true;
  if (
    desired.brightness != null &&
    reported.brightness != null &&
    Math.abs(desired.brightness - reported.brightness) > BRIGHTNESS_TOLERANCE
  ) {
    return false;
  }
  if (desired.color != null && !colorConverged(desired.color, reported.color)) {
    return false;
  }
  return true;
}

/** The desired-overlaid view of a device_state row's state (readEffective's merge). */
export function mergeDeviceState(device: {
  reportedState?: DeviceStateValue | null;
  desiredState?: DeviceStateValue | null;
  available: boolean;
}): MergedDeviceState {
  const desired = device.desiredState ?? null;
  const reported = device.reportedState ?? null;
  if (desired != null) {
    const overlay = isClimateState(desired) ? sanitizeClimateDesired(desired) : desired;
    const state = reported != null ? { ...reported, ...overlay } : desired;
    const pending = reported == null ? true : !converged(desired, reported);
    return { state, pending, available: device.available };
  }
  return { state: reported, pending: false, available: device.available };
}

// ─── end TODO(task-4) block ────────────────────────────────────────────────
