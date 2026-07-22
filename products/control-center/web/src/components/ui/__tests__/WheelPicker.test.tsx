/**
 * WheelPicker behavior in jsdom: tap-to-select, ARIA selection state, and the
 * scroll-settle commit (jsdom has no real scroll physics, so scrollTop is
 * driven by hand and the settle debounce by fake timers).
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WheelPicker, type WheelPickerValue } from "../WheelPicker";

const VALUES: WheelPickerValue<string>[] = Array.from({ length: 10 }, (_, i) => ({
  value: String(i),
  label: String(i).padStart(2, "0"),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("WheelPicker", () => {
  it("renders every row and marks the selected one", () => {
    render(<WheelPicker values={VALUES} value="3" onChange={() => {}} label="Minutes" />);
    expect(screen.getByRole("listbox", { name: "Minutes" })).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(10);
    const selected = screen.getByRole("option", { selected: true });
    expect(selected.textContent).toBe("03");
  });

  it("tapping a row commits its value", () => {
    const onChange = vi.fn();
    render(<WheelPicker values={VALUES} value="3" onChange={onChange} label="Minutes" />);
    fireEvent.click(screen.getByRole("option", { name: "07" }));
    expect(onChange).toHaveBeenCalledWith("7");
  });

  it("tapping the already-selected row does not echo onChange", () => {
    const onChange = vi.fn();
    render(<WheelPicker values={VALUES} value="3" onChange={onChange} label="Minutes" />);
    fireEvent.click(screen.getByRole("option", { name: "03" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits the row nearest center once scrolling settles", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<WheelPicker values={VALUES} value="0" onChange={onChange} label="Minutes" />);
    const listbox = screen.getByRole("listbox", { name: "Minutes" });

    // 44 px rows: a rest at scrollTop 5*44 centers row index 5.
    listbox.scrollTop = 5 * 44;
    fireEvent.scroll(listbox);
    expect(onChange).not.toHaveBeenCalled(); // not before the settle window
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onChange).toHaveBeenCalledWith("5");
  });

  it("a settle on the current value is a no-op (programmatic snap echo)", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<WheelPicker values={VALUES} value="5" onChange={onChange} label="Minutes" />);
    const listbox = screen.getByRole("listbox", { name: "Minutes" });
    // The mount effect parked the wheel here already; a scroll event that
    // settles on the same row must not call onChange.
    expect(listbox.scrollTop).toBe(5 * 44);
    fireEvent.scroll(listbox);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
