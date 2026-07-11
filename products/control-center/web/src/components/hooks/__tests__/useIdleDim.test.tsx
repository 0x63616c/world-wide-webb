import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdleDim } from "../useBoard";

// Stub the native brightness bridge so the timer logic is exercised without a
// Capacitor shell. isNativeDisplay stays false (jsdom), matching production
// browser behaviour; the spies just prove dimTo/restore fire at the right time.
const dimTo = vi.fn();
const restore = vi.fn();
vi.mock("../../../lib/brightness", () => ({
  isNativeDisplay: () => false,
  dimTo: (level: number) => dimTo(level),
  restore: () => restore(),
}));

type Props = { enabled: boolean; timeoutMs: number; level: number };

function setup(opts: Partial<Props> & { pointerDown?: React.RefObject<boolean> }) {
  const stage = document.createElement("div");
  document.body.appendChild(stage);
  const held = opts.pointerDown ?? { current: false };

  const view = renderHook(
    (props: Props) => {
      const stageRef = useRef<HTMLDivElement | null>(stage);
      return useIdleDim({ stageRef, pointerDown: held, ...props });
    },
    {
      initialProps: {
        enabled: opts.enabled ?? true,
        timeoutMs: opts.timeoutMs ?? 10_000,
        level: opts.level ?? 0.25,
      },
    },
  );

  return { stage, held, ...view };
}

describe("useIdleDim", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dimTo.mockClear();
    restore.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("dims to the configured level after the idle window", () => {
    const { result } = setup({ timeoutMs: 10_000, level: 0.25 });

    expect(result.current.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(10_000));

    expect(result.current.dimmed).toBe(true);
    expect(dimTo).toHaveBeenCalledWith(0.25);
  });

  it("restores on the next interaction after dimming", () => {
    const { stage, result } = setup({ timeoutMs: 10_000 });
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.dimmed).toBe(true);

    restore.mockClear();
    act(() => stage.dispatchEvent(new Event("pointerdown")));

    expect(result.current.dimmed).toBe(false);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("an interaction before the window resets the timer (no dim)", () => {
    const { stage, result } = setup({ timeoutMs: 10_000 });

    act(() => vi.advanceTimersByTime(9_000));
    act(() => stage.dispatchEvent(new Event("pointerdown")));
    act(() => vi.advanceTimersByTime(9_000));
    expect(result.current.dimmed).toBe(false);

    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.dimmed).toBe(true);
  });

  it("re-arms when the timeout changes", () => {
    const { result, rerender } = setup({ timeoutMs: 10_000 });

    act(() => vi.advanceTimersByTime(5_000));
    // New timeout re-mounts the timer effect (ms is a dep) and re-arms.
    act(() => rerender({ enabled: true, timeoutMs: 30_000, level: 0.25 }));

    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.dimmed).toBe(false);

    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current.dimmed).toBe(true);
  });

  it("never dims while disabled", () => {
    const { result } = setup({ enabled: false, timeoutMs: 10_000 });

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.dimmed).toBe(false);
    expect(dimTo).not.toHaveBeenCalled();
  });

  it("restores immediately when disabled mid-dim", () => {
    const { result, rerender } = setup({ enabled: true, timeoutMs: 10_000 });
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.dimmed).toBe(true);

    restore.mockClear();
    act(() => rerender({ enabled: false, timeoutMs: 10_000, level: 0.25 }));

    expect(result.current.dimmed).toBe(false);
    expect(restore).toHaveBeenCalled();
  });

  it("does not dim while a pointer is held, then dims after release", () => {
    const held = { current: true };
    const { result } = setup({ timeoutMs: 10_000, pointerDown: held });

    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.dimmed).toBe(false);

    held.current = false;
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.dimmed).toBe(true);
  });

  it("re-applies brightness when the level changes mid-dim", () => {
    const { rerender } = setup({ timeoutMs: 10_000, level: 0.25 });
    act(() => vi.advanceTimersByTime(10_000));
    expect(dimTo).toHaveBeenLastCalledWith(0.25);

    act(() => rerender({ enabled: true, timeoutMs: 10_000, level: 0.5 }));
    expect(dimTo).toHaveBeenLastCalledWith(0.5);
  });
});
