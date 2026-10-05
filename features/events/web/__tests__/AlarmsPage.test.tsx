import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, create, update, enable, remove } = vi.hoisted(() => ({
  state: {
    data: {
      alarms: [] as unknown[],
      next: null,
      defaults: { snoozeMinutes: 9, lightTarget: "light.bed_lamp_left" },
    },
  },
  create: vi.fn(),
  update: vi.fn(),
  enable: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../useAlarms", () => ({ useAlarms: () => ({ data: state.data, isError: false }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ alarms: { list: { invalidate: vi.fn() } } }),
    alarms: {
      create: { useMutation: () => ({ mutate: create }) },
      update: { useMutation: () => ({ mutate: update }) },
      setEnabled: { useMutation: () => ({ mutate: enable }) },
      delete: { useMutation: () => ({ mutate: remove }) },
    },
  },
}));
vi.mock("@/lib/sound", () => ({ warmAudio: vi.fn() }));
vi.mock("@/lib/time-zone", () => ({ useTimeZone: () => "America/Los_Angeles" }));

import { AlarmsPage } from "../AlarmsPage";

beforeEach(() => {
  vi.clearAllMocks();
  state.data.alarms = [];
});
afterEach(cleanup);
describe("alarm management", () => {
  it("shows an honest empty state and creates a repeating alarm through the API", () => {
    render(<AlarmsPage />);
    expect(screen.getByText("No alarms yet")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Add alarm" }));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Morning" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Mon" }));
    fireEvent.click(screen.getByRole("button", { name: "Fri" }));
    fireEvent.click(screen.getByRole("button", { name: "Save alarm" }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        time: "09:00",
        label: "Morning",
        timeZone: "America/Los_Angeles",
        repeatDays: [1, 5],
      }),
    );
  });
  it("validates details before saving", () => {
    render(<AlarmsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add alarm" }));
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "Mars" } });
    fireEvent.click(screen.getByRole("button", { name: "Save alarm" }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("IANA");
  });
  it("edits, disables, and confirms deletion of an existing alarm", () => {
    state.data.alarms = [
      {
        id: "alm_example",
        label: "Morning",
        time: "09:00",
        timeZone: "UTC",
        repeatDays: [],
        at: null,
        enabled: true,
      },
    ];
    render(<AlarmsPage />);
    fireEvent.click(screen.getByRole("switch", { name: "Enable Morning" }));
    expect(enable).toHaveBeenCalledWith({ id: "alm_example", enabled: false });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(remove).toHaveBeenCalledWith({ id: "alm_example" }, expect.any(Object));
    fireEvent.click(screen.getByRole("button", { name: "Edit Morning" }));
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save alarm" }));
    expect(update).toHaveBeenCalledWith({
      id: "alm_example",
      alarm: expect.objectContaining({ time: "10:00" }),
    });
  });
});
