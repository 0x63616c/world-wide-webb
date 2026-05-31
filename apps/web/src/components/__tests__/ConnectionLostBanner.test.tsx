import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStatus } from "../../lib/useConnectionStatus";
import { useNotifications } from "../../lib/useNotifications";
import { ConnectionLostBanner } from "../ConnectionLostBanner";

// Isolate connection status so tests control it directly.
vi.mock("../../lib/useConnectionStatus");
vi.mock("../../lib/useNotifications");

const mockUseConnectionStatus = vi.mocked(useConnectionStatus);
const mockUseNotifications = vi.mocked(useNotifications);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ConnectionLostBanner", () => {
  beforeEach(() => {
    // Default: no notifications raised.
    mockUseNotifications.mockReturnValue({
      notifications: [],
      raiseNotification: vi.fn(),
      clearNotification: vi.fn(),
    });
  });

  it("renders nothing when there is no connection error", () => {
    mockUseConnectionStatus.mockReturnValue({ isLost: false, since: null });
    const { container } = render(<ConnectionLostBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the banner when connection is lost past the threshold", () => {
    mockUseConnectionStatus.mockReturnValue({ isLost: true, since: Date.now() - 10_000 });
    render(<ConnectionLostBanner />);
    expect(screen.getByRole("status")).not.toBeNull();
    expect(screen.getByText(/reconnecting/i)).not.toBeNull();
  });

  it("shows stale data message when connection is lost", () => {
    mockUseConnectionStatus.mockReturnValue({ isLost: true, since: Date.now() - 10_000 });
    render(<ConnectionLostBanner />);
    expect(screen.getByText(/data is stale/i)).not.toBeNull();
  });

  it("clears the banner when connection is restored (isLost transitions to false)", () => {
    // Start lost.
    mockUseConnectionStatus.mockReturnValue({ isLost: true, since: Date.now() - 10_000 });
    const { rerender } = render(<ConnectionLostBanner />);
    expect(screen.getByRole("status")).not.toBeNull();

    // Restore connection.
    mockUseConnectionStatus.mockReturnValue({ isLost: false, since: null });
    rerender(<ConnectionLostBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
