/**
 * Tests for TvAppsTileView (CC-51hf.21).
 *
 * A26: Hero cell for the currently-open Apple TV app (or idle state),
 *      2x2 grid of other top apps, accent ring on open app, launch via mutation.
 * A17: uses shared ui primitives.
 * A32: co-located test + stories.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TvAppsTileViewProps } from "../TvAppsTileView";
import { TvAppsTileView } from "../TvAppsTileView";

afterEach(cleanup);

const baseProps: TvAppsTileViewProps = {
  status: "populated",
  apps: ["Netflix", "Disney+", "Hulu", "Apple TV+", "YouTube"],
  currentApp: "Netflix",
  onLaunchApp: vi.fn(),
  onOpenAllApps: vi.fn(),
};

describe("TvAppsTileView — loading/error", () => {
  it("renders Skeleton when status=loading", () => {
    const { container } = render(
      <TvAppsTileView
        status="loading"
        apps={[]}
        currentApp={null}
        onLaunchApp={vi.fn()}
        onOpenAllApps={vi.fn()}
      />,
    );
    expect(
      container.querySelector("[data-skeleton]") ?? container.querySelector("[aria-busy]"),
    ).toBeInTheDocument();
  });
});

describe("TvAppsTileView — populated (A26)", () => {
  it("renders a header", () => {
    render(<TvAppsTileView {...baseProps} />);
    expect(screen.getByText(/tv apps/i)).toBeInTheDocument();
  });

  it("renders the current app as the hero", () => {
    render(<TvAppsTileView {...baseProps} />);
    expect(screen.getAllByText("Netflix").length).toBeGreaterThan(0);
  });

  it("renders other apps in the grid", () => {
    render(<TvAppsTileView {...baseProps} />);
    // Other apps (not current) should appear
    expect(screen.getByText("Disney+")).toBeInTheDocument();
  });

  it("calls onLaunchApp when an app is clicked", () => {
    const onLaunchApp = vi.fn();
    render(<TvAppsTileView {...baseProps} onLaunchApp={onLaunchApp} />);
    fireEvent.click(screen.getByText("Disney+"));
    expect(onLaunchApp).toHaveBeenCalledWith("Disney+");
  });

  it("renders an all-apps button", () => {
    render(<TvAppsTileView {...baseProps} />);
    expect(screen.getByLabelText(/all apps/i)).toBeInTheDocument();
  });

  it("calls onOpenAllApps when all-apps button clicked", () => {
    const onOpenAllApps = vi.fn();
    render(<TvAppsTileView {...baseProps} onOpenAllApps={onOpenAllApps} />);
    fireEvent.click(screen.getByLabelText(/all apps/i));
    expect(onOpenAllApps).toHaveBeenCalledTimes(1);
  });

  it("renders idle state when no currentApp", () => {
    render(<TvAppsTileView {...baseProps} currentApp={null} />);
    expect(screen.getByText(/idle|no app/i)).toBeInTheDocument();
  });
});
