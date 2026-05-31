import { Icon } from "../Icon";
import { Tile } from "../ui";
import { ClockSecondsRing } from "./ClockSecondsRing";

export interface ClockGreetingViewProps {
  greeting: string;
  hour12: number;
  minutes: string;
  ampm: "AM" | "PM";
  fullDate: string;
  location: string;
  /** When provided (clock is live), renders the smooth seconds progress ring. */
  seconds?: number;
}

export function ClockGreetingView({
  greeting,
  hour12,
  minutes,
  ampm,
  fullDate,
  location,
  seconds,
}: ClockGreetingViewProps) {
  return (
    // padding 28 is design-specified per CC-882 (wider than the standard 22)
    <Tile
      padding={28}
      style={{
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        textAlign: "center",
        position: "relative",
      }}
    >
      {seconds !== undefined && <ClockSecondsRing />}
      {/* Greeting cap in accent */}
      <div className="cap acc" style={{ fontSize: 14, letterSpacing: ".2em" }}>
        {greeting}
      </div>

      {/* 96px mono time with AM/PM */}
      <div
        className="mono"
        style={{
          fontSize: 96,
          fontWeight: 700,
          letterSpacing: "-.05em",
          lineHeight: 0.82,
        }}
      >
        {hour12}:{minutes}
        <span
          data-testid="clock-ampm"
          style={{ fontSize: 26, color: "var(--ink-2)", marginLeft: 8, letterSpacing: "0.02em" }}
        >
          {ampm}
        </span>
      </div>

      {/* Full date */}
      <div data-testid="clock-date" style={{ fontSize: 18, color: "var(--ink-2)" }}>
        {fullDate}
      </div>

      {/* Location */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "var(--ink-2)",
          fontSize: 14.5,
        }}
      >
        <Icon name="pin" s={15} c="var(--ink-3)" />
        {location}
      </div>
    </Tile>
  );
}
