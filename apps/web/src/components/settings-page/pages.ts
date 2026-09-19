/**
 * Settings-page registry , the ordered list of pages the full-page Settings
 * sidebar renders, each with its tinted icon chip and one-line blurb.
 *
 * Four pages, and each one holds a single decision: what the panel is called,
 * what colour it is, what time it thinks it is, and what its PIN is. The Board,
 * Network, Notifications, Sound and Logs pages went with the subsystems behind
 * them; brightness, dim timings, the snap mode, the minimap, the keypad layout
 * and the typeface are constants now rather than knobs.
 */

import type { IconName } from "../Icon";

export type PageKey = "device" | "display" | "security" | "time";

export interface PageDef {
  key: PageKey;
  label: string;
  icon: IconName;
  /** Tinted chip color for the iOS-style sidebar. */
  tint: string;
  blurb: string;
}

export const PAGES: PageDef[] = [
  {
    key: "device",
    label: "Device",
    icon: "settings",
    tint: "#8e8e93",
    blurb: "Name, battery, camera",
  },
  {
    key: "display",
    label: "Display",
    icon: "sun",
    tint: "#e0a83c",
    blurb: "Accent colour",
  },
  {
    key: "security",
    label: "Security",
    icon: "lock",
    tint: "#5c6bc0",
    blurb: "PIN for locked tiles and settings",
  },
  {
    key: "time",
    label: "Time",
    icon: "globe",
    tint: "#7e89c2",
    blurb: "Time zone",
  },
];

export const PAGE_BY_KEY = Object.fromEntries(PAGES.map((p) => [p.key, p])) as Record<
  PageKey,
  PageDef
>;
