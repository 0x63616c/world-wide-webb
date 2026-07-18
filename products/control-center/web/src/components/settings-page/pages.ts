/**
 * Settings-page registry , the ordered list of pages the full-page Settings
 * sidebar renders, each with its tinted icon chip and one-line blurb. Copied
 * from approved Concept A (`SettingsConceptGroupedCards`), with a Security page
 * inserted between Notifications and Debug.
 */

import type { IconName } from "../Icon";

export type PageKey =
  | "device"
  | "display"
  | "board"
  | "network"
  | "notifications"
  | "security"
  | "debug"
  | "about";

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
    blurb: "Name, battery, mount level",
  },
  {
    key: "display",
    label: "Display",
    icon: "sun",
    tint: "#e0a83c",
    blurb: "Brightness and idle dimming",
  },
  { key: "board", label: "Board", icon: "apps", tint: "#4a90d9", blurb: "Snap, recenter, layout" },
  {
    key: "network",
    label: "Network",
    icon: "wifi",
    tint: "#43a56c",
    blurb: "Wi-Fi and connectivity",
  },
  {
    key: "notifications",
    label: "Notifications",
    icon: "bell",
    tint: "#c95c5c",
    blurb: "Alerts and quiet hours",
  },
  {
    key: "security",
    label: "Security",
    icon: "lock",
    tint: "#c95c5c",
    blurb: "PIN for locked tiles and settings",
  },
  { key: "debug", label: "Debug", icon: "bolt", tint: "#9a6ad4", blurb: "FPS, build badge, logs" },
  {
    key: "about",
    label: "About",
    icon: "globe",
    tint: "#6e6e6e",
    blurb: "Build, version, licenses",
  },
];

export const PAGE_BY_KEY = Object.fromEntries(PAGES.map((p) => [p.key, p])) as Record<
  PageKey,
  PageDef
>;
