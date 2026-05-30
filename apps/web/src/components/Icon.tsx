import type { JSX } from "react";

export type IconName =
  | "sun"
  | "moon"
  | "cloud"
  | "cloud-sun"
  | "lamp"
  | "bulb"
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
  | "down";

export interface IconProps {
  name: IconName;
  /** Square size in px. */
  s?: number;
  /** Stroke color (defaults to currentColor). */
  c?: string;
  /** Stroke width. */
  sw?: number;
}

const GLYPHS: Record<IconName, JSX.Element> = {
  sun: (
    <g>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19" />
    </g>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4 6.4 6.4 0 0 0 20 14.5Z" />,
  cloud: <path d="M7 18h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.3A3.5 3.5 0 0 0 7 18Z" />,
  "cloud-sun": (
    <g>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 2.5v1.5M2.5 8H4M3.8 3.8l1 1M12.2 3.8l-1 1" />
      <path d="M9 19h8a3.3 3.3 0 0 0 .3-6.6A4.6 4.6 0 0 0 9 13.5 3 3 0 0 0 9 19Z" />
    </g>
  ),
  lamp: (
    <g>
      <path d="M9 3h6l2.5 7h-11Z" />
      <path d="M12 10v8M8.5 21h7" />
    </g>
  ),
  bulb: (
    <g>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2h5c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" />
    </g>
  ),
  fan: (
    <g>
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 10.4c0-3 .6-6.4-2-6.4-2.2 0-2 3.4 2 6.4ZM13.6 12c3 0 6.4.6 6.4-2 0-2.2-3.4-2-6.4 2ZM12 13.6c0 3-.6 6.4 2 6.4 2.2 0 2-3.4-2-6.4ZM10.4 12c-3 0-6.4-.6-6.4 2 0 2.2 3.4 2 6.4-2Z" />
    </g>
  ),
  thermo: (
    <g>
      <path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0Z" />
      <path d="M12 9v6" />
    </g>
  ),
  car: (
    <g>
      <path d="M5 16h14M4.5 16l1.2-4.2A2 2 0 0 1 7.6 10h8.8a2 2 0 0 1 1.9 1.4L19.5 16M4.5 16v2.5M19.5 16v2.5" />
      <circle cx="8" cy="16.5" r="1.3" />
      <circle cx="16" cy="16.5" r="1.3" />
    </g>
  ),
  bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6Z" />,
  lock: (
    <g>
      <rect x="5.5" y="11" width="13" height="9" rx="2" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </g>
  ),
  unlock: (
    <g>
      <rect x="5.5" y="11" width="13" height="9" rx="2" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2" />
    </g>
  ),
  wifi: (
    <g>
      <path d="M2.5 8.5a15 15 0 0 1 19 0M5.5 11.8a10 10 0 0 1 13 0M8.5 15a5 5 0 0 1 7 0" />
      <circle cx="12" cy="18.5" r="1" />
    </g>
  ),
  pin: (
    <g>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.4" />
    </g>
  ),
  cam: (
    <g>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3" />
    </g>
  ),
  dog: (
    <g>
      <path d="M5 9l-1-4 3 1.5M19 9l1-4-3 1.5" />
      <path d="M5 9c0 5 3 9 7 9s7-4 7-9" />
      <circle cx="9.5" cy="11" r=".6" fill="currentColor" />
      <circle cx="14.5" cy="11" r=".6" fill="currentColor" />
      <path d="M12 14l-1 1h2Z" />
    </g>
  ),
  calendar: (
    <g>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 9h16M9 3v4M15 3v4" />
    </g>
  ),
  plus: <path d="M12 6v12M6 12h12" />,
  bell: (
    <g>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </g>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
};

export function Icon({ name, s = 22, c = "currentColor", sw = 1.7 }: IconProps) {
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke={c}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flex: "0 0 auto" }}
      aria-hidden="true"
    >
      {GLYPHS[name]}
    </svg>
  );
}
