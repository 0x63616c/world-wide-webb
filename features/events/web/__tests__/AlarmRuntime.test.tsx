import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, snooze, stop, cue, wake, sync } = vi.hoisted(() => ({
  state: {
    nativeShell: true,
    active: [] as {
      id: string;
      version: number;
      label: string;
      status: string;
      expiresAt: string;
      snoozeMinutes: number;
    }[],
  },
  snooze: vi.fn(),
  stop: vi.fn(),
  cue: vi.fn(),
  wake: vi.fn(),
  sync: vi.fn().mockResolvedValue(null),
}));
vi.mock("../useAlarms", () => ({
  useAlarms: () => ({ data: { active: state.active, next: null }, isError: false }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ alarms: { list: { invalidate: vi.fn() } } }),
    alarms: {
      snooze: { useMutation: () => ({ mutate: snooze }) },
      stop: { useMutation: () => ({ mutate: stop }) },
    },
  },
}));
vi.mock("@/lib/sound", () => ({ playCue: cue, warmAudio: vi.fn() }));
vi.mock("@/lib/panel-session", () => ({ panelSession: { touch: wake } }));
vi.mock("@/lib/native-bridge", () => ({
  isNativeShell: () => state.nativeShell,
  nativeRequest: sync,
}));

import { AlarmRuntime } from "../AlarmRuntime";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T16:00:00Z"));
  vi.clearAllMocks();
  state.active = [];
  state.nativeShell = true;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("panel alarm runtime", () => {
  it("rings through the shared sound bus, wakes the panel, and stops looping after dismissal", () => {
    state.active = [
      {
        id: "alr_example",
        version: 2,
        label: "Morning",
        status: "ringing",
        expiresAt: "2026-10-05T16:30:00Z",
        snoozeMinutes: 9,
      },
    ];
    const view = render(<AlarmRuntime />);
    expect(screen.getByRole("alertdialog")).toBeDefined();
    expect(cue).toHaveBeenCalledWith("alarmFire");
    expect(wake).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(5000));
    expect(cue).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Snooze 9 min" }));
    expect(snooze).toHaveBeenCalledWith({ id: "alr_example", version: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stop).toHaveBeenCalledWith({ id: "alr_example", version: 2 });
    state.active = [];
    view.rerender(<AlarmRuntime />);
    act(() => vi.advanceTimersByTime(10000));
    expect(cue).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
  it("expires a cached ring even while disconnected", () => {
    state.active = [
      {
        id: "alr_example",
        version: 0,
        label: "Morning",
        status: "ringing",
        expiresAt: "2026-10-05T16:00:03Z",
        snoozeMinutes: 9,
      },
    ];
    render(<AlarmRuntime />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
  it("ends a native countdown when the server has no next alarm", () => {
    render(<AlarmRuntime />);
    expect(sync).toHaveBeenCalledWith("syncNextAlarm", { next: null });
  });
  it("acknowledges native ownership only after stopping the web cue and timer", async () => {
    const cancel = vi.fn();
    cue.mockReturnValue(cancel);
    state.active = [
      {
        id: "alr_example",
        version: 0,
        label: "Morning",
        status: "ringing",
        expiresAt: "2026-10-05T16:30:00Z",
        snoozeMinutes: 9,
      },
    ];
    render(<AlarmRuntime />);
    const handoff = window.__CONTROL_CENTER_SET_ALARM_OWNER__;
    expect(handoff).toBeTypeOf("function");
    let acknowledgement: Promise<boolean> | undefined;
    act(() => {
      acknowledgement = handoff?.(true).then((accepted) => {
        expect(cancel).toHaveBeenCalledOnce();
        return accepted;
      });
    });
    expect(await acknowledgement).toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    act(() => vi.advanceTimersByTime(10_000));
    expect(cue).toHaveBeenCalledOnce();
    const previousSyncs = sync.mock.calls.length;
    act(() => {
      acknowledgement = handoff?.(true);
    });
    expect(await acknowledgement).toBe(true);
    expect(sync).toHaveBeenCalledTimes(previousSyncs);
    act(() => {
      acknowledgement = handoff?.(false);
    });
    expect(await acknowledgement).toBe(true);
    expect(screen.getByRole("alertdialog")).toBeDefined();
    expect(cue).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenCalledTimes(previousSyncs + 1);
  });
  it("does not expose ownership handoff to an ordinary browser", () => {
    state.nativeShell = false;
    render(<AlarmRuntime />);
    expect(window.__CONTROL_CENTER_SET_ALARM_OWNER__).toBeUndefined();
  });
  it("rejects superseded ownership requests and clears the bridge on unmount", async () => {
    const view = render(<AlarmRuntime />);
    const handoff = window.__CONTROL_CENTER_SET_ALARM_OWNER__;
    if (!handoff) throw new Error("Missing native alarm handoff");
    let first: Promise<boolean> | undefined;
    let second: Promise<boolean> | undefined;
    act(() => {
      first = handoff(true);
      second = handoff(false);
    });
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    view.unmount();
    expect(window.__CONTROL_CENTER_SET_ALARM_OWNER__).toBeUndefined();
  });
});
