import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdleDim } from "../useBoard";

// Stub the native brightness bridge so the timer logic is exercised without a
// Capacitor shell. isNativeDisplay stays false (jsdom), matching production
// browser behavior; the spies just prove dimTo/wakeTo fire at the right time.
const dimTo = vi.fn();
const wakeTo = vi.fn();
vi.mock("../../../lib/brightness", () => ({
  isNativeDisplay: () => false,
  dimTo: (level: number) => dimTo(level),
  wakeTo: (level: number) => wakeTo(level),
}));

type Props = { enabled: boolean; timeoutMs: number; level: number; activeBrightness: number };

function setup(opts: Partial<Props> & { pointerDown?: React.RefObject<boolean> }) {
  const stage = document.createElement("div");
  document.body.appendChild(stage);
  const held = opts.pointerDown ?? { current: false };

  const view = renderHook(
    (props: Props) => {
      return useIdleDim({ stage, pointerDown: held, ...props });
    },
    {
      initialProps: {
        enabled: opts.enabled ?? true,
        timeoutMs: opts.timeoutMs ?? 10_000,
        level: opts.level ?? 0.25,
        activeBrightness: opts.activeBrightness ?? 1,
      },
    },
  );

  return { stage, held, ...view };
}

describe("useIdleDim", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dimTo.mockClear();
    wakeTo.mockClear();
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

  // Regression (wake tap clicked through to the tile): the window-capture
  // activity listener sees the wake tap BEFORE the dim overlay's own handler,
  // and un-dimming from it unmounted the overlay mid-dispatch (React flushes
  // state at the microtask checkpoint between listeners), so the tap's click
  // retargeted to the tile underneath. While dimmed, raw events are therefore
  // IGNORED , the overlay's explicit wake() is the only way back up.
  it("ignores raw interaction events while dimmed; only wake() un-dims", () => {
    const { stage, result } = setup({ timeoutMs: 10_000, activeBrightness: 0.8 });
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.dimmed).toBe(true);

    wakeTo.mockClear();
    act(() => stage.dispatchEvent(new Event("pointerdown")));
    expect(result.current.dimmed).toBe(true);
    expect(wakeTo).not.toHaveBeenCalled();

    act(() => result.current.wake());
    expect(result.current.dimmed).toBe(false);
    expect(wakeTo).toHaveBeenLastCalledWith(0.8);
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
    act(() => rerender({ enabled: true, timeoutMs: 30_000, level: 0.25, activeBrightness: 1 }));

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

  it("wakes immediately when disabled mid-dim", () => {
    const { result, rerender } = setup({ enabled: true, timeoutMs: 10_000, activeBrightness: 0.7 });
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.dimmed).toBe(true);

    wakeTo.mockClear();
    act(() => rerender({ enabled: false, timeoutMs: 10_000, level: 0.25, activeBrightness: 0.7 }));

    expect(result.current.dimmed).toBe(false);
    expect(wakeTo).toHaveBeenLastCalledWith(0.7);
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

  it("wake() un-dims and rearms the timer (the overlay-swallowed tap path)", () => {
    const { result } = setup({ timeoutMs: 10_000 });
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.dimmed).toBe(true);

    wakeTo.mockClear();
    // The dim overlay swallows the tap (never reaches the stage listeners), so it
    // calls wake() directly to un-dim + drive the backlight back to active.
    act(() => result.current.wake());
    expect(result.current.dimmed).toBe(false);
    expect(wakeTo).toHaveBeenCalledTimes(1);

    // ...and the window is rearmed: it dims again a full timeout later.
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.dimmed).toBe(true);
  });

  it("re-applies brightness when the level changes mid-dim", () => {
    const { rerender } = setup({ timeoutMs: 10_000, level: 0.25 });
    act(() => vi.advanceTimersByTime(10_000));
    expect(dimTo).toHaveBeenLastCalledWith(0.25);

    act(() => rerender({ enabled: true, timeoutMs: 10_000, level: 0.5, activeBrightness: 1 }));
    expect(dimTo).toHaveBeenLastCalledWith(0.5);
  });

  // Regression: the board gates the stage behind a layout-loading screen, so the
  // stage mounts on a LATER commit than the hook. A ref-based dep never changed
  // when it arrived, so the timer silently never armed and the panel never
  // dimmed (which also meant the wake overlay, and its photo burst, never ran).
  it("arms once the stage mounts on a later commit", () => {
    const held = { current: false };
    const stage = document.createElement("div");
    document.body.appendChild(stage);

    const props = { enabled: true, timeoutMs: 10_000, level: 0.25, activeBrightness: 1 };
    const { result, rerender } = renderHook(
      ({ stage }: { stage: HTMLDivElement | null }) =>
        useIdleDim({ stage, pointerDown: held, ...props }),
      { initialProps: { stage: null as HTMLDivElement | null } },
    );

    // No stage yet: nothing to attach to, so no dim.
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.dimmed).toBe(false);

    // Stage arrives (layout finished loading) - the window must now run.
    rerender({ stage });
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.dimmed).toBe(true);
  });

  it("un-dims if the stage unmounts mid-dim", () => {
    const held = { current: false };
    const stage = document.createElement("div");
    document.body.appendChild(stage);

    const props = { enabled: true, timeoutMs: 10_000, level: 0.25, activeBrightness: 1 };
    const { result, rerender } = renderHook(
      ({ stage }: { stage: HTMLDivElement | null }) =>
        useIdleDim({ stage, pointerDown: held, ...props }),
      { initialProps: { stage: stage as HTMLDivElement | null } },
    );

    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.dimmed).toBe(true);

    // The stage goes away with the feature still enabled: without this the dim
    // overlay would stay stranded on screen with no timer left to clear it.
    act(() => rerender({ stage: null }));
    expect(result.current.dimmed).toBe(false);
  });

  it("ignores scroll frames from an app-driven glide", () => {
    const held = { current: false };
    const isProgrammatic = { current: true };
    const stage = document.createElement("div");
    document.body.appendChild(stage);

    const { result } = renderHook(() =>
      useIdleDim({
        stage,
        isProgrammatic: isProgrammatic as React.RefObject<boolean>,
        pointerDown: held,
        enabled: true,
        timeoutMs: 10_000,
        level: 0.25,
        activeBrightness: 1,
      }),
    );

    // goHome's smooth glide emits a scroll stream; it must not read as presence.
    act(() => vi.advanceTimersByTime(9_000));
    act(() => {
      stage.dispatchEvent(new Event("scroll"));
    });
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.dimmed).toBe(true);

    // Awake again, a real finger on the same event still counts as activity.
    isProgrammatic.current = false;
    act(() => result.current.wake());
    act(() => vi.advanceTimersByTime(9_000));
    act(() => {
      stage.dispatchEvent(new Event("scroll"));
    });
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.dimmed).toBe(false);
  });
});

// Regression (dim stuck while a modal is open): modals portal to <body>, i.e.
// outside the #stage subtree, so stage-local tap listeners never saw a tap
// inside one. The panel would dim mid-Settings and stay dim until the modal was
// closed and the board itself tapped. Taps ride window now.
describe("useIdleDim activity outside the stage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dimTo.mockClear();
    wakeTo.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("a tap outside the stage while dimmed is ignored too (the shield covers modals)", () => {
    const { result } = setup({ timeoutMs: 10_000, activeBrightness: 1 });
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.dimmed).toBe(true);

    // The dim overlay sits above every modal, so a real tap inside one lands on
    // the shield (which calls wake()) , the raw event reaching window here is
    // exactly the race that used to click through to the tile.
    const modal = document.createElement("div");
    document.body.appendChild(modal);
    wakeTo.mockClear();
    act(() => {
      modal.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(result.current.dimmed).toBe(true);
    expect(wakeTo).not.toHaveBeenCalled();
  });

  it("does not dim while a tap outside the stage keeps rearming the window", () => {
    const { result } = setup({ timeoutMs: 10_000 });
    const modal = document.createElement("div");
    document.body.appendChild(modal);

    for (let i = 0; i < 3; i++) {
      act(() => vi.advanceTimersByTime(6_000));
      act(() => {
        modal.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      });
    }

    expect(result.current.dimmed).toBe(false);
  });
});
