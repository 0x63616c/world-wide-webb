/**
 * TimeSuiteBanner wiring: which store states surface a banner, what Stop and a
 * body tap each do, and when an open clock detail page suppresses the banner.
 * Stores are mocked (store behavior has its own suites); this exercises only
 * the banner's composition.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTileDetail } from "../../lib/tile-detail-store";
import { dismissAlarmFiring, useAlarmFiring, useAlarms } from "../../lib/time-suite/alarm-store";
import { stopTimerRinging, useTimers } from "../../lib/time-suite/timer-store";
import type { AlarmRecord, TimerRecord } from "../../lib/time-suite/types";
import { useNotifications } from "../../lib/useNotifications";
import { TimeSuiteBanner } from "../TimeSuiteBanner";

vi.mock("../../lib/time-suite/timer-store", () => ({
  useTimers: vi.fn(() => []),
  stopTimerRinging: vi.fn(),
}));
// formatAlarmTime comes from the side-effect-free time-suite/pure module, so
// the banner uses the real implementation; only the stateful store is mocked.
vi.mock("../../lib/time-suite/alarm-store", () => ({
  useAlarms: vi.fn(() => []),
  useAlarmFiring: vi.fn(() => null),
  dismissAlarmFiring: vi.fn(),
}));
vi.mock("../../lib/tile-detail-store", () => ({
  useTileDetail: vi.fn(() => null),
  openTileDetail: vi.fn(),
}));
vi.mock("../../lib/useNotifications");

import { openTileDetail } from "../../lib/tile-detail-store";

const mockUseTimers = vi.mocked(useTimers);
const mockUseAlarms = vi.mocked(useAlarms);
const mockUseAlarmFiring = vi.mocked(useAlarmFiring);
const mockUseTileDetail = vi.mocked(useTileDetail);
const mockUseNotifications = vi.mocked(useNotifications);

const DONE_TIMER: TimerRecord = {
  id: "timer_done",
  label: null,
  durationMs: 10 * 60_000,
  endsAtMs: null,
  remainingMs: 0,
  state: "done",
  doneAtMs: 1_000,
  dismissedCue: false,
  createdAtMs: 0,
};

const FIRING_ALARM: AlarmRecord = {
  id: "alarm_1",
  label: null,
  hour: 7,
  minute: 30,
  repeatDays: [],
  enabled: false,
  nextFireAtMs: null,
};

let raiseNotification: ReturnType<typeof vi.fn>;
let clearNotification: ReturnType<typeof vi.fn>;

beforeEach(() => {
  raiseNotification = vi.fn();
  clearNotification = vi.fn();
  mockUseNotifications.mockReturnValue({
    notifications: [],
    raiseNotification,
    clearNotification,
  });
  mockUseTimers.mockReturnValue([]);
  mockUseAlarms.mockReturnValue([]);
  mockUseAlarmFiring.mockReturnValue(null);
  mockUseTileDetail.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TimeSuiteBanner", () => {
  it("renders nothing (and clears both notifications) when nothing is live", () => {
    const { container } = render(<TimeSuiteBanner />);
    expect(container.firstChild).toBeNull();
    expect(clearNotification).toHaveBeenCalledWith("time-suite-timer");
    expect(clearNotification).toHaveBeenCalledWith("time-suite-alarm");
  });

  it("done timer: shows the banner, Stop silences without navigating", () => {
    mockUseTimers.mockReturnValue([DONE_TIMER]);
    render(<TimeSuiteBanner />);

    expect(screen.getByText(/Timer done — 10 min/)).not.toBeNull();
    expect(raiseNotification).toHaveBeenCalledWith({
      id: "time-suite-timer",
      message: "Timer done — 10 min",
    });

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stopTimerRinging).toHaveBeenCalledWith("timer_done");
    expect(openTileDetail).not.toHaveBeenCalled();
  });

  it("done timer: a body tap deep-links to the clock detail's Timer variant", () => {
    mockUseTimers.mockReturnValue([DONE_TIMER]);
    render(<TimeSuiteBanner />);
    fireEvent.click(screen.getByText(/Timer done — 10 min/));
    expect(openTileDetail).toHaveBeenCalledWith("tile_clock", "timer");
    expect(stopTimerRinging).not.toHaveBeenCalled();
  });

  it("uses the timer's label over its duration when present", () => {
    mockUseTimers.mockReturnValue([{ ...DONE_TIMER, label: "Tea" }]);
    render(<TimeSuiteBanner />);
    expect(screen.getByText(/Timer done — Tea/)).not.toBeNull();
  });

  it("firing alarm: assertive banner with the alarm's time; Stop dismisses", () => {
    mockUseAlarms.mockReturnValue([FIRING_ALARM]);
    mockUseAlarmFiring.mockReturnValue({ alarmId: "alarm_1", sinceMs: 0 });
    render(<TimeSuiteBanner />);

    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("Alarm — 7:30 AM");
    expect(raiseNotification).toHaveBeenCalledWith({
      id: "time-suite-alarm",
      message: "Alarm — 7:30 AM",
    });

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(dismissAlarmFiring).toHaveBeenCalledTimes(1);
    expect(openTileDetail).not.toHaveBeenCalled();
  });

  it("firing alarm: a body tap deep-links to the Alarm variant", () => {
    mockUseAlarms.mockReturnValue([FIRING_ALARM]);
    mockUseAlarmFiring.mockReturnValue({ alarmId: "alarm_1", sinceMs: 0 });
    render(<TimeSuiteBanner />);
    fireEvent.click(screen.getByRole("alert"));
    expect(openTileDetail).toHaveBeenCalledWith("tile_clock", "alarm");
  });

  it("is hidden while the clock detail is open on the matching variant", () => {
    mockUseTimers.mockReturnValue([DONE_TIMER]);
    mockUseAlarmFiring.mockReturnValue({ alarmId: "alarm_1", sinceMs: 0 });
    mockUseAlarms.mockReturnValue([FIRING_ALARM]);
    // Open on Timer (the unset slug defaults to the entry's "timer"): the
    // timer banner hides, the alarm banner must STILL show.
    mockUseTileDetail.mockReturnValue({ tileId: "tile_clock" });
    render(<TimeSuiteBanner />);
    expect(screen.queryByText(/Timer done/)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Alarm");
  });

  it("stays visible when a NON-clock detail page is open", () => {
    mockUseTimers.mockReturnValue([DONE_TIMER]);
    mockUseTileDetail.mockReturnValue({ tileId: "tile_tesla" });
    render(<TimeSuiteBanner />);
    expect(screen.getByText(/Timer done — 10 min/)).not.toBeNull();
  });
});
