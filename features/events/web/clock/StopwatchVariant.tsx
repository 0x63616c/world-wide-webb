/**
 * StopwatchVariant , zero-prop wrapper wiring `ClockStopwatchView` to the
 * stopwatch store (clock-suite plan §7/§9 Package B).
 *
 * The rAF loop lives HERE, not in the store: the stopwatch has no cue, so
 * nothing ticks while the view is unmounted , elapsed time derives from
 * wall-clock spans and survives unmount/reload for free. While running, every
 * animation frame re-renders the readout with a fresh `Date.now()` so the
 * centisecond digits blur like Apple's (pinned , a 100 ms interval makes them
 * visibly step).
 */

import { useEffect, useState } from "react";
import {
  lapStopwatch,
  resetStopwatch,
  startStopwatch,
  stopStopwatch,
  useStopwatch,
} from "@/lib/time-suite/stopwatch-store";
import { ClockStopwatchView } from "./ClockStopwatchView";

/** Mounted by the clock detail wiring as the `stopwatch` variant. */
export function StopwatchVariant() {
  const state = useStopwatch();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!state.running) return;
    let raf = requestAnimationFrame(function loop() {
      setNowMs(Date.now());
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [state.running]);

  // While stopped, elapsed derives purely from accumulatedMs , the view
  // ignores nowMs , so the last frame's value is fine to pass through.
  return (
    <ClockStopwatchView
      state={state}
      nowMs={nowMs}
      onStart={startStopwatch}
      onStop={stopStopwatch}
      onLap={lapStopwatch}
      onReset={resetStopwatch}
    />
  );
}
