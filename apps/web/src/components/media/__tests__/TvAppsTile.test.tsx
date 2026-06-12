/**
 * Tests for TvAppsTileView (CC-0z4f, design match).
 *
 * Hero card shows the open app's brand logo + name + "OPEN · RESUME"; the 2×2
 * grid shows logo-only cells (no text labels) addressable by aria-label; a
 * colored status pill replaces the old grid-icon button, and the whole tile
 * owns the tap that opens AllAppsModal (app buttons stopPropagation to launch).
 * A17: uses shared ui primitives. A32: co-located test + stories.
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

describe("TvAppsTileView, loading/error", () => {
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

describe("TvAppsTileView, populated", () => {
  it("renders a header", () => {
    render(<TvAppsTileView {...baseProps} />);
    expect(screen.getByText(/tv apps/i)).toBeInTheDocument();
  });

  it("renders the current app name as the hero", () => {
    render(<TvAppsTileView {...baseProps} />);
    expect(screen.getAllByText("Netflix").length).toBeGreaterThan(0);
    expect(screen.getByText(/open · resume/i)).toBeInTheDocument();
  });

  it("shows a status pill with the active app name", () => {
    render(<TvAppsTileView {...baseProps} />);
    // Pill text + hero name both say "Netflix".
    expect(screen.getAllByText("Netflix").length).toBeGreaterThanOrEqual(2);
  });

  it("renders other apps as logo-only grid cells (no text label)", () => {
    render(<TvAppsTileView {...baseProps} />);
    // The grid cell is addressable by its aria-label, not by visible text.
    expect(screen.getByRole("button", { name: "Disney+" })).toBeInTheDocument();
  });

  it("launches the hero app when the hero is clicked", () => {
    const onLaunchApp = vi.fn();
    render(<TvAppsTileView {...baseProps} onLaunchApp={onLaunchApp} />);
    fireEvent.click(screen.getByRole("button", { name: "Netflix - open" }));
    expect(onLaunchApp).toHaveBeenCalledWith("Netflix");
  });

  it("launches a grid app when its cell is clicked", () => {
    const onLaunchApp = vi.fn();
    const onOpenAllApps = vi.fn();
    render(
      <TvAppsTileView {...baseProps} onLaunchApp={onLaunchApp} onOpenAllApps={onOpenAllApps} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Disney+" }));
    expect(onLaunchApp).toHaveBeenCalledWith("Disney+");
    // App taps must NOT bubble up to open the all-apps modal.
    expect(onOpenAllApps).not.toHaveBeenCalled();
  });

  it("opens all-apps when the tile surface (header) is tapped", () => {
    const onOpenAllApps = vi.fn();
    render(<TvAppsTileView {...baseProps} onOpenAllApps={onOpenAllApps} />);
    fireEvent.click(screen.getByText(/tv apps/i));
    expect(onOpenAllApps).toHaveBeenCalledTimes(1);
  });

  it("renders idle state when no currentApp", () => {
    render(<TvAppsTileView {...baseProps} currentApp={null} />);
    expect(screen.getByText(/nothing open/i)).toBeInTheDocument();
    expect(screen.getByText("Apple TV")).toBeInTheDocument();
  });

  it("orders the grid by curated favorites, not source_list order", () => {
    // Scrambled source order; YouTube is last but must lead the grid.
    render(
      <TvAppsTileView
        {...baseProps}
        currentApp={null}
        apps={["Hulu", "AMC+", "Disney+", "Netflix", "YouTube"]}
      />,
    );
    const labels = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"))
      .filter((l): l is string => l !== null && l !== "Nothing open");
    expect(labels.slice(0, 4)).toEqual(["YouTube", "Netflix", "Disney+", "Hulu"]);
  });

  it("renders grid-cell marks at 38px (CC-l2zg)", () => {
    // Unbranded app → glyph fallback whose fontSize is size * 0.6.
    render(<TvAppsTileView {...baseProps} currentApp={null} apps={["Zelda FM"]} />);
    const glyph = screen.getByLabelText("Zelda FM").querySelector("span");
    expect(glyph).toHaveStyle({ fontSize: `${38 * 0.6}px` });
  });

  it("renders the hero logo plate at 44px (CC-l2zg)", () => {
    render(<TvAppsTileView {...baseProps} />);
    const plate = screen.getByLabelText("Netflix - open").querySelector("div");
    expect(plate).toHaveStyle({ width: "44px", height: "44px" });
  });
});
