import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "../../lib/mobile";
import { useBatteryInfo } from "../../lib/useBatteryInfo";
import { NotChargingBanner } from "../NotChargingBanner";

// The battery poll is native-only, so it is stubbed rather than simulated: these
// tests are about what the banner DOES with a reading, and whether it asks for
// one at all.
vi.mock("../../lib/useBatteryInfo", () => ({
  useBatteryInfo: vi.fn(() => null),
  formatBattery: vi.fn(() => ""),
}));
vi.mock("../../lib/mobile");

const mockUseBatteryInfo = vi.mocked(useBatteryInfo);
const mockUseIsMobile = vi.mocked(useIsMobile);

beforeEach(() => {
  // The wall panel, unplugged, unless a test says otherwise.
  mockUseIsMobile.mockReturnValue(false);
  mockUseBatteryInfo.mockReturnValue({ level: 0.62, isCharging: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NotChargingBanner", () => {
  it("warns on the panel when the dock is not charging", () => {
    render(<NotChargingBanner />);
    expect(screen.getByText(/is not charging/i)).not.toBeNull();
  });

  it("says nothing while the panel is charging", () => {
    mockUseBatteryInfo.mockReturnValue({ level: 0.62, isCharging: true });
    const { container } = render(<NotChargingBanner />);
    expect(container.firstChild).toBeNull();
  });

  // A phone runs on battery by design, so "not charging" is not a fault there ,
  // this banner (and the push notification-bridge mirrors from it) fired for the
  // entirely normal state of an unplugged iPhone.
  it("never warns on a phone", () => {
    mockUseIsMobile.mockReturnValue(true);
    const { container } = render(<NotChargingBanner />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/is not charging/i)).toBeNull();
  });

  // Not just silenced , a phone should not be polling the battery for a panel
  // fault it can never report.
  it("does not even enable the battery poll on a phone", () => {
    mockUseIsMobile.mockReturnValue(true);
    render(<NotChargingBanner />);
    expect(mockUseBatteryInfo).toHaveBeenCalledWith(false);

    cleanup();
    mockUseIsMobile.mockReturnValue(false);
    render(<NotChargingBanner />);
    expect(mockUseBatteryInfo).toHaveBeenCalledWith(true);
  });
});
