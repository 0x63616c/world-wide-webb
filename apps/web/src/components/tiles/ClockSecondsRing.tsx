// Smooth seconds ring for the clock tile. It reads the wall clock at
// animation-frame resolution and feeds a fractional minute progress (0..1) to the
// generic BorderProgressRing. Driving it continuously means the sweep never
// stutters and the top-of-minute wrap (… → :00) snaps instantly on its own — the
// value simply jumps from ~1 to 0 between frames, with no CSS transition to rewind.

import { useEffect, useState } from "react";
import { BorderProgressRing } from "../ui";

/** Fraction of the current minute elapsed, 0..1. */
function minuteProgress(): number {
  return (Date.now() % 60_000) / 60_000;
}

export function ClockSecondsRing() {
  const [progress, setProgress] = useState(minuteProgress);

  useEffect(() => {
    if (typeof requestAnimationFrame === "undefined") return;
    let frame = requestAnimationFrame(function tick() {
      setProgress(minuteProgress());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return <BorderProgressRing data-testid="seconds-ring" progress={progress} />;
}
