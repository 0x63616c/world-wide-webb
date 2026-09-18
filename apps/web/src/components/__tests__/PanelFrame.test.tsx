import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "../../lib/mobile";
import { PanelFrame } from "../PanelFrame";

vi.mock("../../lib/mobile");

const mockUseIsMobile = vi.mocked(useIsMobile);

beforeEach(() => {
  mockUseIsMobile.mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.removeAttribute("style");
});

describe("PanelFrame", () => {
  it("caps the app to the panel resolution in a desktop browser", () => {
    render(
      <PanelFrame>
        <div data-testid="app" />
      </PanelFrame>,
    );
    expect(screen.getByTestId("panel-frame-canvas")).not.toBeNull();
    // The body cap (what contains every position:fixed portal, see PanelFrame).
    expect(document.body.style.width).toBe("1366px");
    expect(document.body.style.height).toBe("1024px");
  });

  // A 1366x1024 body box positioned at a negative offset would push the phone
  // view off a 390px-wide viewport entirely. The phone view is responsive and
  // owns its own layout, so this component must be a pure passthrough there ,
  // exactly as it already is on the native kiosk shell.
  it("renders children untouched on a phone", () => {
    mockUseIsMobile.mockReturnValue(true);
    render(
      <PanelFrame>
        <div data-testid="app" />
      </PanelFrame>,
    );
    expect(screen.getByTestId("app")).not.toBeNull();
    expect(screen.queryByTestId("panel-frame-canvas")).toBeNull();
    expect(document.body.getAttribute("style")).toBeNull();
    expect(document.querySelector("[data-panel-bezel-root]")).toBeNull();
  });
});
