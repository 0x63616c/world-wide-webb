import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDeviceName } from "../../lib/device-name";
import { useNotifications } from "../../lib/useNotifications";
import { DeviceNameBanner } from "../DeviceNameBanner";

// Isolate both stores so the test drives the "is set" state directly.
vi.mock("../../lib/device-name");
vi.mock("../../lib/useNotifications");

const mockUseDeviceName = vi.mocked(useDeviceName);
const mockUseNotifications = vi.mocked(useNotifications);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DeviceNameBanner", () => {
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
  });

  it("renders the red banner + raises the notification when the name is unset", () => {
    mockUseDeviceName.mockReturnValue({ name: "iPad", isSet: false });
    render(<DeviceNameBanner />);
    expect(screen.getByRole("alert")).not.toBeNull();
    expect(screen.getByText(/set your device name in settings/i)).not.toBeNull();
    expect(raiseNotification).toHaveBeenCalledWith({
      id: "device-name",
      message: "Please set your device name in settings",
    });
  });

  it("renders nothing and clears the notification once the name is set", () => {
    mockUseDeviceName.mockReturnValue({ name: "Calum's Laptop", isSet: true });
    const { container } = render(<DeviceNameBanner />);
    expect(container.firstChild).toBeNull();
    expect(clearNotification).toHaveBeenCalledWith("device-name");
  });

  it("has no dismiss control (cannot be dismissed, only cleared by setting a name)", () => {
    mockUseDeviceName.mockReturnValue({ name: "iPad", isSet: false });
    render(<DeviceNameBanner />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("clears the banner when isSet transitions to true", () => {
    mockUseDeviceName.mockReturnValue({ name: "iPad", isSet: false });
    const { rerender } = render(<DeviceNameBanner />);
    expect(screen.getByRole("alert")).not.toBeNull();

    mockUseDeviceName.mockReturnValue({ name: "iPad", isSet: true });
    rerender(<DeviceNameBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(clearNotification).toHaveBeenCalledWith("device-name");
  });

  it("DOM text matches the notifications store message exactly", () => {
    mockUseDeviceName.mockReturnValue({ name: "iPad", isSet: false });
    render(<DeviceNameBanner />);
    const domText = screen.getByRole("alert").textContent ?? "";
    const storeMessage = raiseNotification.mock.calls[0]?.[0]?.message ?? "";
    expect(domText).toContain(storeMessage);
  });
});
