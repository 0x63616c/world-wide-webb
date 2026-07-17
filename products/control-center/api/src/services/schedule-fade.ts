import { assignMoodColors, BLUE_RGB, RED_RGB, WHITE_SCENE_KELVIN } from "../config/lamp-scenes";
import type { DeviceLightState, LightColor, ScheduleAction } from "../db/schema";

export interface FadeEndpoint {
  on: boolean;
  brightnessRaw?: number; // HA raw 0..255
  rgb?: [number, number, number];
  kelvin?: number;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/**
 * Interpolate a light between two endpoints at fraction `t` (clamped 0..1).
 * Brightness (raw 0..255) and rgb are lerp'd componentwise; kelvin is lerp'd when
 * both endpoints carry it. `on` always follows the END endpoint — an off target
 * ramps brightness toward 0 while reporting on:false so the enforcer turns it off
 * once the ramp completes. Color prefers rgb when the end has rgb, else kelvin.
 */
export function interpolateLight(
  start: FadeEndpoint,
  end: FadeEndpoint,
  t: number,
): DeviceLightState {
  const f = clamp01(t);
  const state: DeviceLightState = { on: end.on };
  const sb = start.brightnessRaw ?? 0;
  const eb = end.brightnessRaw ?? 0;
  state.brightness = lerp(sb, eb, f);

  let color: LightColor | undefined;
  if (end.rgb) {
    const sr = start.rgb ?? end.rgb;
    color = {
      rgb: [lerp(sr[0], end.rgb[0], f), lerp(sr[1], end.rgb[1], f), lerp(sr[2], end.rgb[2], f)],
    };
  } else if (end.kelvin != null) {
    const sk = start.kelvin ?? end.kelvin;
    color = { kelvin: lerp(sk, end.kelvin, f) };
  }
  if (color) state.color = color;
  return state;
}

/**
 * Resolve a ScheduleAction to a concrete FadeEndpoint per target entity. Off →
 * { on:false }. On: brightness (0..100→raw) applies to every target; scene sets the
 * color endpoint — white=kelvin, red/blue=rgb (uniform), mood=a DISTINCT random
 * palette color per target (endpoints fixed up front so a fade has stable ends). No
 * scene → color left unset so a fade keeps each light's existing color.
 */
export function actionEndpoints(
  action: ScheduleAction,
  targetEntityIds: string[],
): Map<string, FadeEndpoint> {
  const out = new Map<string, FadeEndpoint>();
  if (!action.on) {
    for (const id of targetEntityIds) out.set(id, { on: false });
    return out;
  }
  const brightnessRaw =
    action.brightness != null
      ? Math.round((Math.min(100, Math.max(0, action.brightness)) / 100) * 255)
      : undefined;
  const mood = action.scene === "mood" ? assignMoodColors(targetEntityIds.length) : null;
  targetEntityIds.forEach((id, i) => {
    const ep: FadeEndpoint = { on: true };
    if (brightnessRaw != null) ep.brightnessRaw = brightnessRaw;
    if (action.scene === "white") ep.kelvin = WHITE_SCENE_KELVIN;
    else if (action.scene === "red") ep.rgb = [...RED_RGB];
    else if (action.scene === "blue") ep.rgb = [...BLUE_RGB];
    else if (action.scene === "mood" && mood) ep.rgb = [...mood[i]];
    out.set(id, ep);
  });
  return out;
}
