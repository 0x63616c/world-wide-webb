import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, snooze, stop, cue, wake, sync } = vi.hoisted(() => ({
  state: {
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
vi.mock("@/lib/native-bridge", () => ({ isNativeShell: () => true, nativeRequest: sync }));

import { AlarmRuntime } from "../AlarmRuntime";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T16:00:00Z"));
  vi.clearAllMocks();
  state.active = [];
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
});
