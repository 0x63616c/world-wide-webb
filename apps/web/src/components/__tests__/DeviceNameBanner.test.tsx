import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDeviceName } from "../../lib/device-name";
import { useIsMobile } from "../../lib/mobile";
import { DeviceNameBanner } from "../DeviceNameBanner";

// Isolate the store so the test drives the "is set" state directly.
vi.mock("../../lib/device-name");
// Same for the phone check , the banner must never nag on a phone.
vi.mock("../../lib/mobile");

const mockUseDeviceName = vi.mocked(useDeviceName);
const mockUseIsMobile = vi.mocked(useIsMobile);

beforeEach(() => {
  // The wall panel unless a test says otherwise.
  mockUseIsMobile.mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DeviceNameBanner", () => {
  it("renders the red banner when the name is unset", () => {
    mockUseDeviceName.mockReturnValue({ name: "iPad", isSet: false });
    render(<DeviceNameBanner />);
    expect(screen.getByRole("alert")).not.toBeNull();
    expect(screen.getByText(/set your device name in settings/i)).not.toBeNull();
  });

  it("renders nothing once the name is set", () => {
    mockUseDeviceName.mockReturnValue({ name: "Calum's Laptop", isSet: true });
    const { container } = render(<DeviceNameBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("has no dismiss control (cannot be dismissed, only cleared by setting a name)", () => {
    mockUseDeviceName.mockReturnValue({ name: "iPad", isSet: false });
    render(<DeviceNameBanner />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  // The name only labels a PANEL's log lines, and a phone's auto-derived
  // default ("iPhone") is already right , so an un-dismissable nag on a phone
  // was demanding a setup step there is no reason to perform.
  it("never nags on a phone, even with the name unset", () => {
    mockUseIsMobile.mockReturnValue(true);
    mockUseDeviceName.mockReturnValue({ name: "iPhone", isSet: false });
    const { container } = render(<DeviceNameBanner />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears the banner when isSet transitions to true", () => {
    mockUseDeviceName.mockReturnValue({ name: "iPad", isSet: false });
    const { rerender } = render(<DeviceNameBanner />);
    expect(screen.getByRole("alert")).not.toBeNull();

    mockUseDeviceName.mockReturnValue({ name: "iPad", isSet: true });
    rerender(<DeviceNameBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
