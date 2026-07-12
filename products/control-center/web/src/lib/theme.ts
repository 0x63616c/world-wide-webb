/**
 * Theme controller , resolves the synced theme preference (lib/settings) into
 * the concrete light/dark theme on <html data-theme>, and cross-fades between
 * them instead of snapping (tokens.css html.theme-fade).
 *
 *  - `light` / `dark`: applied directly.
 *  - `auto`: follows the sun at the home location. Light from sunrise+offset to
 *    sunset+offset, dark otherwise. Sun times come from the weather pipeline
 *    (`weather.now` → Open-Meteo daily sunrise/sunset for HOME_LAT/LON), which
 *    the board already polls , the panel physically sits at that location, so
 *    the ISO local datetimes parse correctly as browser-local time. The +30min
 *    default offset holds the light theme through civil twilight, the point
 *    where dashboards conventionally go dark.
 *
 * Dark is the boot default (html ships without data-theme), so a panel that
 * never opts in renders exactly as before this feature existed.
 */

import { useEffect, useState } from "react";
import { POLL } from "./hooks";
import { useSettings } from "./settings";
import { trpc } from "./trpc";

export type ResolvedTheme = "light" | "dark";

// ─── DOM application + cross-fade ─────────────────────────────────────────────

let fadeTimer = 0;

function currentApplied(): ResolvedTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/**
 * Stamp the resolved theme on <html>. When it differs from what's applied, the
 * swap runs under a transient .theme-fade class so every token-driven colour
 * transitions over `fadeMs` (0 = instant). Exported for tests.
 */
export function applyTheme(next: ResolvedTheme, fadeMs: number): void {
  const root = document.documentElement;
  if (currentApplied() === next) return;
  window.clearTimeout(fadeTimer);
  if (fadeMs > 0) {
    root.style.setProperty("--theme-fade-ms", `${Math.round(fadeMs)}ms`);
    root.classList.add("theme-fade");
    // Class removal is what ends the transition; +80ms grace so the last frame
    // completes before transitions vanish (removing exactly on time clips it).
    fadeTimer = window.setTimeout(() => root.classList.remove("theme-fade"), fadeMs + 80);
  }
  if (next === "light") root.dataset.theme = "light";
  else delete root.dataset.theme;
}

// ─── sun-clock resolution ─────────────────────────────────────────────────────

type SunTimes = {
  sunriseIso: string;
  sunsetIso: string;
  tomorrowSunriseIso: string;
};

/**
 * Resolve what the auto theme should be `now`, plus when it next flips (for the
 * re-evaluation timer). Offset shifts both boundaries, so "+30" = light starts
 * 30min after sunrise and holds until 30min after sunset. Returns null next
 * boundary when `now` is already past every known boundary (stale data , the
 * next weather poll supersedes it).
 */
export function resolveAutoTheme(
  now: Date,
  sun: SunTimes,
  offsetMin: number,
): { theme: ResolvedTheme; nextChangeAt: Date | null } {
  const off = offsetMin * 60_000;
  const t = now.getTime();
  const sunrise = Date.parse(sun.sunriseIso) + off;
  const sunset = Date.parse(sun.sunsetIso) + off;
  const tomorrowSunrise = Date.parse(sun.tomorrowSunriseIso) + off;
  if (!Number.isFinite(sunrise) || !Number.isFinite(sunset)) {
    return { theme: "dark", nextChangeAt: null };
  }
  if (t < sunrise) return { theme: "dark", nextChangeAt: new Date(sunrise) };
  if (t < sunset) return { theme: "light", nextChangeAt: new Date(sunset) };
  return {
    theme: "dark",
    nextChangeAt:
      Number.isFinite(tomorrowSunrise) && t < tomorrowSunrise ? new Date(tomorrowSunrise) : null,
  };
}

// ─── hook ─────────────────────────────────────────────────────────────────────

/**
 * Mount ONCE inside the tRPC providers (see app.tsx). Applies the theme on
 * load and keeps it tracking the synced setting + the sun clock. The weather
 * query is the same key the weather tile uses, so React Query dedupes it.
 */
export function useThemeController(): void {
  const { themeMode, themeSunOffsetMin, themeFadeMs } = useSettings();

  // Sun times only matter in auto mode; skip the query entirely otherwise.
  const weather = trpc.weather.now.useQuery(undefined, {
    refetchInterval: POLL.weather,
    enabled: themeMode === "auto",
  });
  const sun = weather.data;

  // Tick state forces a re-resolve when the sun clock crosses a boundary (it
  // is a dependency of the effect below; each boundary timer bumps it).
  const [tick, setTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is not read in the body on purpose , it exists solely so the boundary timer's setTick re-runs this effect at sunrise/sunset.
  useEffect(() => {
    if (themeMode !== "auto") {
      applyTheme(themeMode, themeFadeMs);
      return;
    }
    // Auto without data yet: hold whatever is currently applied (avoids a
    // dark→light→dark double-flash while the first weather fetch is in flight).
    if (!sun) return;
    const { theme, nextChangeAt } = resolveAutoTheme(new Date(), sun, themeSunOffsetMin);
    applyTheme(theme, themeFadeMs);
    if (!nextChangeAt) return;
    // Re-evaluate just past the boundary. Cap the wait so a very distant
    // boundary (or clock weirdness) still re-checks within an hour.
    const wait = Math.min(Math.max(nextChangeAt.getTime() - Date.now() + 1_000, 1_000), 3_600_000);
    const timer = window.setTimeout(() => setTick((n) => n + 1), wait);
    return () => window.clearTimeout(timer);
  }, [themeMode, themeSunOffsetMin, themeFadeMs, sun, tick]);
}
