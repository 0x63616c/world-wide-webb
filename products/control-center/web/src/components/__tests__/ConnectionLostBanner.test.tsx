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

  it("renders nothing when there is no connection error", () => {
    mockUseConnectionStatus.mockReturnValue({ isLost: false, since: null });
    const { container } = render(<ConnectionLostBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the banner when connection is lost past the threshold", () => {
    mockUseConnectionStatus.mockReturnValue({ isLost: true, since: Date.now() - 10_000 });
    render(<ConnectionLostBanner />);
    expect(screen.getByRole("status")).not.toBeNull();
    expect(screen.getByText(/unable to connect/i)).not.toBeNull();
  });

  it("shows the unable-to-connect message when connection is lost", () => {
    mockUseConnectionStatus.mockReturnValue({ isLost: true, since: Date.now() - 10_000 });
    render(<ConnectionLostBanner />);
    expect(screen.getByText(/unable to connect/i)).not.toBeNull();
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

  it("calls raiseNotification with the correct payload when isLost becomes true", () => {
    mockUseConnectionStatus.mockReturnValue({ isLost: true, since: Date.now() - 10_000 });
    render(<ConnectionLostBanner />);
    expect(raiseNotification).toHaveBeenCalledWith({
      id: "connection-lost",
      message: "Unable to connect…",
    });
  });

  it("calls clearNotification when isLost transitions to false", () => {
    // Start connected , no call.
    mockUseConnectionStatus.mockReturnValue({ isLost: false, since: null });
    const { rerender } = render(<ConnectionLostBanner />);
    expect(clearNotification).toHaveBeenCalledWith("connection-lost");

    // Now lost, then recovered.
    mockUseConnectionStatus.mockReturnValue({ isLost: true, since: Date.now() - 10_000 });
    rerender(<ConnectionLostBanner />);
    clearNotification.mockClear();

    mockUseConnectionStatus.mockReturnValue({ isLost: false, since: null });
    rerender(<ConnectionLostBanner />);
    expect(clearNotification).toHaveBeenCalledWith("connection-lost");
  });

  it("DOM text matches the notifications store message exactly", () => {
    mockUseConnectionStatus.mockReturnValue({ isLost: true, since: Date.now() - 10_000 });
    render(<ConnectionLostBanner />);
    // Both the DOM and the store must use the same MESSAGE constant.
    const domText = screen.getByRole("status").textContent ?? "";
    const storeMessage = raiseNotification.mock.calls[0]?.[0]?.message ?? "";
    expect(domText).toContain(storeMessage);
  });
});
