/**
 * ClockAlarmView , pure-view RTL tests from fixtures (plan §10): row rendering
 * + subtitles, Switch → onToggle, the firing Stop bar → onDismissFiring, and
 * the inline editor's full loop , tap-to-open, wheel/meridiem/day-chip edits
 * mapping to 24-hour onUpdate patches, new-alarm composition via onAdd, and
 * ConfirmDialog-gated delete. No stores anywhere near this file.
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlarmRecord } from "@/lib/time-suite/types";
import { ClockAlarmView, type ClockAlarmViewProps } from "../ClockAlarmView";

afterEach(cleanup);

// Fixed midday instant so one-shot Today/Tomorrow phrasing is stable.
const NOW_MS = new Date("2026-06-10T12:00:00.000Z").getTime();

const WEEKDAY_ALARM: AlarmRecord = {
  id: "alarm_weekday",
  label: "Wake up",
  hour: 7,
  minute: 30,
  repeatDays: [1, 2, 3, 4, 5],
  enabled: true,
  nextFireAtMs: NOW_MS + 19 * 60 * 60_000,
};

const DISABLED_ALARM: AlarmRecord = {
  id: "alarm_disabled",
  label: null,
  hour: 21,
  minute: 15,
  repeatDays: [6, 7],
  enabled: false,
  nextFireAtMs: null,
};

function renderView(overrides: Partial<ClockAlarmViewProps> = {}) {
  const props: ClockAlarmViewProps = {
    alarms: [WEEKDAY_ALARM, DISABLED_ALARM],
    firing: null,
    nowMs: NOW_MS,
    onAdd: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onToggle: vi.fn(),
    onDismissFiring: vi.fn(),
    ...overrides,
  };
  render(<ClockAlarmView {...props} />);
  return props;
}

function openEditorFor(timeLabel: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: timeLabel }));
}

describe("ClockAlarmView rows", () => {
  it("renders each alarm's time, label, and next-fire subtitle", () => {
    renderView();
    expect(screen.getByText("7:30 AM")).toBeInTheDocument();
    expect(screen.getByText("Wake up")).toBeInTheDocument();
    expect(screen.getByText("Weekdays, 7:30 AM")).toBeInTheDocument();
    expect(screen.getByText("9:15 PM")).toBeInTheDocument();
    // Disabled alarm reads "Off", never a phantom fire time.
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("shows the quiet empty state with no alarms", () => {
    renderView({ alarms: [] });
    expect(screen.getByText("No alarms")).toBeInTheDocument();
  });

  it("routes the row Switch to onToggle with the flipped state", () => {
    const props = renderView();
    fireEvent.click(screen.getByRole("switch", { name: "Alarm 7:30 AM" }));
    expect(props.onToggle).toHaveBeenCalledWith("alarm_weekday", false);
    fireEvent.click(screen.getByRole("switch", { name: "Alarm 9:15 PM" }));
    expect(props.onToggle).toHaveBeenCalledWith("alarm_disabled", true);
  });
});

describe("ClockAlarmView firing bar", () => {
  it("renders the accent Stop bar and routes Stop to onDismissFiring", () => {
    const props = renderView({
      firing: { alarmId: "alarm_weekday", sinceMs: NOW_MS - 5_000 },
    });
    const bar = screen.getByRole("alert");
    expect(bar).toHaveTextContent("Alarm — 7:30 AM · Wake up");
    fireEvent.click(within(bar).getByRole("button", { name: "Stop" }));
    expect(props.onDismissFiring).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generic ringing bar when the alarm is gone", () => {
    renderView({ firing: { alarmId: "alarm_missing", sinceMs: NOW_MS } });
    expect(screen.getByRole("alert")).toHaveTextContent("Alarm — ringing");
  });

  it("renders no bar while nothing is firing", () => {
    renderView();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ClockAlarmView editor", () => {
  it("expands inline on row tap and collapses on a second tap", () => {
    renderView();
    expect(screen.queryByRole("listbox", { name: "Hour" })).not.toBeInTheDocument();
    openEditorFor(/7:30 AM/);
    expect(screen.getByRole("listbox", { name: "Hour" })).toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Minute" })).toBeInTheDocument();
    openEditorFor(/7:30 AM/);
    expect(screen.queryByRole("listbox", { name: "Hour" })).not.toBeInTheDocument();
  });

  it("saves a meridiem flip as a 24-hour onUpdate patch", () => {
    const props = renderView();
    openEditorFor(/7:30 AM/);
    fireEvent.click(screen.getByRole("radio", { name: "PM" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onUpdate).toHaveBeenCalledWith("alarm_weekday", {
      hour: 19,
      minute: 30,
      repeatDays: [1, 2, 3, 4, 5],
      label: "Wake up",
    });
  });

  it("toggles day chips and saves the changed repeatDays", () => {
    const props = renderView();
    openEditorFor(/7:30 AM/);
    fireEvent.click(screen.getByRole("button", { name: "Fri" })); // off
    fireEvent.click(screen.getByRole("button", { name: "Sat" })); // on
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onUpdate).toHaveBeenCalledWith("alarm_weekday", {
      hour: 7,
      minute: 30,
      repeatDays: [1, 2, 3, 4, 6],
      label: "Wake up",
    });
  });

  it("cancel closes the editor without any mutation", () => {
    const props = renderView();
    openEditorFor(/7:30 AM/);
    fireEvent.click(screen.getByRole("radio", { name: "PM" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("listbox", { name: "Hour" })).not.toBeInTheDocument();
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("clearing the label saves it as null", () => {
    const props = renderView();
    openEditorFor(/7:30 AM/);
    fireEvent.change(screen.getByRole("textbox", { name: "Label" }), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onUpdate).toHaveBeenCalledWith(
      "alarm_weekday",
      expect.objectContaining({ label: null }),
    );
  });

  it("gates delete behind ConfirmDialog and routes confirm to onDelete", () => {
    const props = renderView();
    openEditorFor(/7:30 AM/);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete alarm?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith("alarm_weekday");
    expect(screen.queryByRole("listbox", { name: "Hour" })).not.toBeInTheDocument();
  });
});

describe("ClockAlarmView new-alarm composer", () => {
  it("composes and adds a labeled repeat alarm via the wheels", () => {
    const props = renderView({ alarms: [] });
    fireEvent.click(screen.getByRole("button", { name: "+ New Alarm" }));
    const hourWheel = screen.getByRole("listbox", { name: "Hour" });
    const minuteWheel = screen.getByRole("listbox", { name: "Minute" });
    fireEvent.click(within(hourWheel).getByRole("option", { name: "8" }));
    fireEvent.click(within(minuteWheel).getByRole("option", { name: "45" }));
    fireEvent.click(screen.getByRole("radio", { name: "PM" }));
    fireEvent.click(screen.getByRole("button", { name: "Mon" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Label" }), {
      target: { value: "Gym" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onAdd).toHaveBeenCalledWith({
      hour: 20,
      minute: 45,
      repeatDays: [1],
      label: "Gym",
    });
    expect(screen.queryByRole("listbox", { name: "Hour" })).not.toBeInTheDocument();
  });

  it("omits the label for an unlabeled one-shot and offers no Delete", () => {
    const props = renderView({ alarms: [] });
    fireEvent.click(screen.getByRole("button", { name: "+ New Alarm" }));
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // Fresh draft defaults: 7:00 AM, one-shot, no label key at all.
    expect(props.onAdd).toHaveBeenCalledWith({ hour: 7, minute: 0, repeatDays: [] });
  });
});
