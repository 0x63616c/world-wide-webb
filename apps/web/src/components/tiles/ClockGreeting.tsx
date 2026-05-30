import { useEffect, useState } from "react";
import { Icon } from "../Icon";

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function greeting(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Good night";
}

export function ClockGreeting() {
  const d = useNow();
  const rawHour = d.getHours();
  const ap = rawHour >= 12 ? "PM" : "AM";
  const H = rawHour % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  const full = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const g = greeting(rawHour);

  return (
    <div
      className="tile"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        textAlign: "center",
        padding: 28,
      }}
    >
      {/* Greeting cap in accent */}
      <div className="cap acc" style={{ fontSize: 14, letterSpacing: ".2em" }}>
        {g}
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
        {H}:{m}
        <span
          data-testid="clock-ampm"
          style={{ fontSize: 26, color: "var(--ink-2)", marginLeft: 8, letterSpacing: "0.02em" }}
        >
          {ap}
        </span>
      </div>

      {/* Full date */}
      <div data-testid="clock-date" style={{ fontSize: 18, color: "var(--ink-2)" }}>
        {full}
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
        Home
      </div>
    </div>
  );
}
