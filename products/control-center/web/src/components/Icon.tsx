import type { LucideIcon } from "lucide-react";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Calendar,
  Car,
  ChevronRight,
  Cloud,
  CloudSun,
  Dog,
  Fan,
  Globe,
  Lamp,
  LayoutGrid,
  Lightbulb,
  LightbulbOff,
  Lock,
  LockOpen,
  MapPin,
  Moon,
  Plus,
  Settings,
  Sparkles,
  Sun,
  Thermometer,
  Users,
  Video,
  Volume2,
  Wifi,
  Zap,
} from "lucide-react";

export type IconName =
  | "sun"
  | "moon"
  | "cloud"
  | "cloud-sun"
  | "lamp"
  | "bulb"
  | "bulb-off"
  | "fan"
  | "thermo"
  | "car"
  | "bolt"
  | "lock"
  | "unlock"
  | "wifi"
  | "pin"
  | "cam"
  | "dog"
  | "calendar"
  | "plus"
  | "bell"
  | "chevron"
  | "up"
  | "down"
  | "sparkles"
  | "globe"
  | "speaker"
  | "apps"
  | "settings"
  | "groups";

export interface IconProps {
  name: IconName;
  /** Square size in px. */
  s?: number;
  /** Stroke color (defaults to currentColor). */
  c?: string;
  /** Stroke width. */
  sw?: number;
}

// The icon vocabulary is a deliberately small, curated set (a fixed wall panel,
// not a free-for-all). Each IconName maps to one lucide-react glyph; the wrapper
// below enforces the house conventions (size scale, stroke width, currentColor,
// a11y) in ONE place, so the library stays swappable and call sites never inline
// per-icon styling. Adding an icon = add a union member + a lucide glyph here.
export const GLYPHS: Record<IconName, LucideIcon> = {
  sun: Sun,
  moon: Moon,
  cloud: Cloud,
  "cloud-sun": CloudSun,
  lamp: Lamp,
  bulb: Lightbulb,
  "bulb-off": LightbulbOff,
  fan: Fan,
  thermo: Thermometer,
  car: Car,
  bolt: Zap,
  lock: Lock,
  unlock: LockOpen,
  wifi: Wifi,
  pin: MapPin,
  cam: Video,
  dog: Dog,
  calendar: Calendar,
  plus: Plus,
  bell: Bell,
  chevron: ChevronRight,
  up: ArrowUp,
  down: ArrowDown,
  sparkles: Sparkles,
  globe: Globe,
  speaker: Volume2,
  apps: LayoutGrid,
  settings: Settings,
  groups: Users,
};

export function Icon({ name, s = 22, c = "currentColor", sw = 1.7 }: IconProps) {
  const Glyph = GLYPHS[name];
  // lucide maps size→width/height, color→stroke, strokeWidth→stroke-width, and
  // stamps a `lucide-<name>` class. We keep the same block/flex layout + aria the
  // hand-drawn svg used so nothing downstream shifts.
  return (
    <Glyph
      size={s}
      color={c}
      strokeWidth={sw}
      style={{ display: "block", flex: "0 0 auto" }}
      aria-hidden="true"
    />
  );
}
