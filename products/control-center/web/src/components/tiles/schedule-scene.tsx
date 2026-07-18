/**
 * Shared schedule presentation helpers , the scene→icon/tint vocabulary, the
 * tinted icon chip, and the day/time label formatters used by BOTH the compact
 * Schedules tile and the schedules modal. Pure + presentational (no data, no
 * hooks) so it can live in one place instead of being copied into each view.
 */

import type { CSSProperties } from "react";
import { Icon, type IconName } from "../Icon";
import type {
  SceneName,
  ScheduleAction,
  ScheduleTrigger,
} from "./modals/ExpandedSchedulesModalView";

/**
 * A scene as DISPLAYED: the four real scenes plus an "off" state for schedules
 * whose action turns lights off. The chip colour/icon reads the intent at a
 * glance without opening the schedule.
 */
export type DisplayScene = SceneName | "off";

interface SceneStyle {
  icon: IconName;
  tint: string;
}

export const SCENE_STYLE: Record<DisplayScene, SceneStyle> = {
  white: { icon: "sun", tint: "#e0a83c" },
  mood: { icon: "sparkles", tint: "#9a6ad4" },
  red: { icon: "lamp", tint: "#c95c5c" },
  blue: { icon: "moon", tint: "#4a90d9" },
  off: { icon: "bulb-off", tint: "#6e6e6e" },
};

/** The scene an action visually reads as: its colour when turning on, else "off". */
export function displayScene(action: ScheduleAction): DisplayScene {
  return action.on ? (action.scene ?? "white") : "off";
}

/** Tinted rounded icon chip , the settings-page sidebar vocabulary. */
export function SceneChip({ scene, size = 34 }: { scene: DisplayScene; size?: number }) {
  const { icon, tint } = SCENE_STYLE[scene];
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.26,
        background: tint,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Icon name={icon} s={Math.round(size * 0.56)} sw={2} />
    </span>
  );
}

/** Mono uppercase section label , the settings-page grouped-card vocabulary. */
export const SECTION_LABEL: CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "var(--ink-3)",
  margin: "0 4px 8px",
};

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

const sameSet = (a: number[], b: number[]) =>
  a.length === b.length && b.every((d) => a.includes(d));

/** Human day summary: "Every day" / "Weekdays" / "Weekends" / "Mon, Wed, Fri". */
export function daysSummary(days: number[]): string {
  if (days.length === 7) return "Every day";
  if (days.length === 0) return "Never";
  const sorted = [...days].sort((a, b) => a - b);
  if (sameSet(sorted, WEEKDAYS)) return "Weekdays";
  if (sameSet(sorted, WEEKEND)) return "Weekends";
  return sorted.map((d) => DAY_ABBR[d]).join(", ");
}

/**
 * Resolved fire-time label: the next fire's "H:MM" when known, else the
 * trigger's own fixed time or a sun-event summary (e.g. "sunset +15m").
 */
export function triggerTimeLabel(trigger: ScheduleTrigger, next: string | null): string {
  if (trigger.type === "fixed") return next ?? trigger.time;
  const off =
    trigger.offsetMin === 0 ? "" : ` ${trigger.offsetMin > 0 ? "+" : ""}${trigger.offsetMin}m`;
  return `${trigger.event}${off}`;
}
