import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { TileBoundary } from "../TileBoundary";

// Suppress console.error noise from intentional throws in tests.
const suppressError = vi.spyOn(console, "error").mockImplementation(() => {});

afterEach(() => {
  cleanup();
});

afterEach(() => {
  suppressError.mockClear();
});

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("tile render error");
  return <div data-testid="tile-ok">tile content</div>;
}

describe("TileBoundary", () => {
  it("renders children when no error is thrown", () => {
    render(
      <TileBoundary>
        <Bomb shouldThrow={false} />
      </TileBoundary>,
    );
    expect(screen.getByTestId("tile-ok")).toBeInTheDocument();
  });

  it("catches a thrown render error and shows fallback instead of crashing", () => {
    render(
      <TileBoundary>
        <Bomb shouldThrow={true} />
      </TileBoundary>,
    );
    // Fallback is shown , the bombing tile is NOT rendered.
    expect(screen.queryByTestId("tile-ok")).toBeNull();
    // Fallback must be present (the error boundary renders something, not nothing).
    const fallback = document.querySelector("[data-tile-boundary-fallback]");
    expect(fallback).not.toBeNull();
  });

  it("isolates crash: a throwing tile does not affect a sibling boundary", () => {
    render(
      <div>
        <TileBoundary>
          <Bomb shouldThrow={true} />
        </TileBoundary>
        <TileBoundary>
          <Bomb shouldThrow={false} />
        </TileBoundary>
      </div>,
    );
    // The healthy sibling tile must still render.
    expect(screen.getByTestId("tile-ok")).toBeInTheDocument();
  });

  it("fallback fills height:100% to preserve grid layout", () => {
    render(
      <TileBoundary>
        <Bomb shouldThrow={true} />
      </TileBoundary>,
    );
    const fallback = document.querySelector("[data-tile-boundary-fallback]") as HTMLElement;
    expect(fallback).not.toBeNull();
    expect(fallback.style.height).toBe("100%");
  });

  it("recovery: incrementing resetKey clears error state and re-renders children", () => {
    // First render with a crashing child , boundary enters error state.
    const { rerender } = render(
      <TileBoundary resetKey={0}>
        <Bomb shouldThrow={true} />
      </TileBoundary>,
    );
    expect(document.querySelector("[data-tile-boundary-fallback]")).not.toBeNull();
    expect(screen.queryByTestId("tile-ok")).toBeNull();

    // Advance resetKey with healthy children , getDerivedStateFromProps must clear hasError.
    rerender(
      <TileBoundary resetKey={1}>
        <Bomb shouldThrow={false} />
      </TileBoundary>,
    );
    // Tile should be visible again without a full unmount/remount.
    expect(screen.getByTestId("tile-ok")).toBeInTheDocument();
    expect(document.querySelector("[data-tile-boundary-fallback]")).toBeNull();
  });

  it("fallback uses Skeleton primitives (data-skeleton attribute present)", () => {
    render(
      <TileBoundary>
        <Bomb shouldThrow={true} />
      </TileBoundary>,
    );
    const fallback = document.querySelector("[data-tile-boundary-fallback]") as HTMLElement;
    expect(fallback).not.toBeNull();
    // Skeleton components render with data-skeleton so fallback doesn't inline shimmer divs.
    const skeletons = fallback.querySelectorAll("[data-skeleton]");
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
