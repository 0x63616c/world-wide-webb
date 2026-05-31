import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import { EventsTileView } from "../EventsTileView";
import {
  Default,
  Empty,
  ErrorEmpty as ErrorStory,
  Loading,
  MultipleEvents,
  UrgentEvents,
} from "../EventsTileView.stories";

// Verify each story exports the correct args shape and renders without throwing.
// These unit tests cover the jsdom rendering path for all story states.

describe("EventsTileView stories", () => {
  it("Loading story exports status=loading", () => {
    expect(Loading.args?.status).toBe("loading");
    render(<EventsTileView status="loading" events={[]} />);
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    // No event text while loading
    expect(screen.queryByText("Gorgon City")).not.toBeInTheDocument();
  });

  it("Empty story exports status=populated with no events", () => {
    expect(Empty.args?.status).toBe("populated");
    expect(Empty.args?.events).toHaveLength(0);
    render(<EventsTileView status="populated" events={[]} />);
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
  });

  it("Error story exports status=error", () => {
    expect(ErrorStory.args?.status).toBe("error");
    render(<EventsTileView status="error" events={[]} />);
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    // Shows skeleton on error
    expect(screen.queryByText("Gorgon City")).not.toBeInTheDocument();
  });

  it("Default story exports populated state with at least one event", () => {
    expect(Default.args?.status).toBe("populated");
    expect(Default.args?.events?.length).toBeGreaterThan(0);
    const events = Default.args?.events ?? [];
    render(<EventsTileView status="populated" events={events} />);
    // First event name is visible
    expect(screen.getByText(events[0].name)).toBeInTheDocument();
  });

  it("MultipleEvents story renders only the first 3 events", () => {
    expect(MultipleEvents.args?.status).toBe("populated");
    const events = MultipleEvents.args?.events ?? [];
    expect(events.length).toBeGreaterThan(3);
    render(<EventsTileView status="populated" events={events} />);
    // First 3 visible, 4th should not appear
    expect(screen.getByText(events[0].name)).toBeInTheDocument();
    expect(screen.getByText(events[1].name)).toBeInTheDocument();
    expect(screen.getByText(events[2].name)).toBeInTheDocument();
    expect(screen.queryByText(events[3].name)).not.toBeInTheDocument();
  });

  it("UrgentEvents story — all events with days <= 3 render in accent color", () => {
    expect(UrgentEvents.args?.status).toBe("populated");
    const events = UrgentEvents.args?.events ?? [];
    const urgentEvents = events.filter((e) => e.days <= 3);
    // Story must have at least two urgent events (Disclosure + Bicep)
    expect(urgentEvents.length).toBeGreaterThanOrEqual(2);
    const { container } = render(<EventsTileView status="populated" events={events} />);
    const dayNumbers = container.querySelectorAll(".mono");
    for (const urgentEvent of urgentEvents) {
      const urgentEl = Array.from(dayNumbers).find(
        (el) => el.textContent === String(urgentEvent.days),
      ) as HTMLElement | undefined;
      expect(urgentEl?.style.color).toBe("var(--acc)");
    }
  });
});
