import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventsTileView } from "../EventsTileView";

describe("EventsTileView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders skeleton while loading", () => {
    render(<EventsTileView status="loading" events={[]} />);

    expect(screen.getByText("Upcoming")).toBeTruthy();
    expect(screen.queryByText("Gorgon City")).toBeNull();
  });

  it("renders skeleton on error", () => {
    render(<EventsTileView status="error" events={[]} />);

    expect(screen.getByText("Upcoming")).toBeTruthy();
    expect(screen.queryByText("Gorgon City")).toBeNull();
  });

  it("renders skeleton when event list is empty", () => {
    render(<EventsTileView status="populated" events={[]} />);

    expect(screen.getByText("Upcoming")).toBeTruthy();
    expect(screen.queryByText("any event")).toBeNull();
  });

  it("renders event data in populated state", () => {
    render(
      <EventsTileView
        status="populated"
        events={[
          { name: "Gorgon City", place: "Sound Nightclub", days: 3 },
          { name: "Chris Lake", place: "Shrine Expo Hall", days: 10 },
          { name: "John Summit", place: "Hollywood Palladium", days: 54 },
        ]}
      />,
    );

    expect(screen.getByText("Gorgon City")).toBeTruthy();
    expect(screen.getByText("Sound Nightclub")).toBeTruthy();
    expect(screen.getByText("Chris Lake")).toBeTruthy();
    expect(screen.getByText("Shrine Expo Hall")).toBeTruthy();
    expect(screen.getByText("John Summit")).toBeTruthy();
    expect(screen.getByText("Upcoming")).toBeTruthy();
    expect(screen.getByText("All")).toBeTruthy();
  });

  it("renders only the first 3 events", () => {
    render(
      <EventsTileView
        status="populated"
        events={[
          { name: "Event A", place: "Venue A", days: 1 },
          { name: "Event B", place: "Venue B", days: 5 },
          { name: "Event C", place: "Venue C", days: 10 },
          { name: "Event D", place: "Venue D", days: 20 },
        ]}
      />,
    );

    expect(screen.getByText("Event A")).toBeTruthy();
    expect(screen.getByText("Event B")).toBeTruthy();
    expect(screen.getByText("Event C")).toBeTruthy();
    expect(screen.queryByText("Event D")).toBeNull();
  });

  it("renders the nearest (first/index-0) event's day-count in accent green regardless of day value", () => {
    const { container } = render(
      <EventsTileView
        status="populated"
        events={[
          { name: "Far Event", place: "Venue A", days: 16 },
          { name: "Near Event", place: "Venue B", days: 30 },
        ]}
      />,
    );

    const dayNumbers = container.querySelectorAll(".mono");
    const firstDay = Array.from(dayNumbers).find((el) => el.textContent === "16") as
      | HTMLElement
      | undefined;
    expect(firstDay).toBeTruthy();
    // Nearest event always renders in accent green
    expect(firstDay?.style.color).toBe("var(--acc)");

    const secondDay = Array.from(dayNumbers).find((el) => el.textContent === "30") as
      | HTMLElement
      | undefined;
    expect(secondDay).toBeTruthy();
    // Non-nearest event renders in default ink
    expect(secondDay?.style.color).toBe("var(--ink)");
  });

  it("applies accent color to days <= 3 even when not first event", () => {
    const { container } = render(
      <EventsTileView
        status="populated"
        events={[
          { name: "First", place: "Venue A", days: 16 },
          { name: "Urgent", place: "Venue B", days: 2 },
          { name: "Far", place: "Venue C", days: 60 },
        ]}
      />,
    );

    const dayNumbers = container.querySelectorAll(".mono");

    // First event (index 0) is always accent
    const firstDayEl = Array.from(dayNumbers).find((el) => el.textContent === "16") as
      | HTMLElement
      | undefined;
    expect(firstDayEl?.style.color).toBe("var(--acc)");

    // Second event with days <= 3 also gets accent
    const urgentDayEl = Array.from(dayNumbers).find((el) => el.textContent === "2") as
      | HTMLElement
      | undefined;
    expect(urgentDayEl?.style.color).toBe("var(--acc)");

    // Third event is plain ink
    const farDayEl = Array.from(dayNumbers).find((el) => el.textContent === "60") as
      | HTMLElement
      | undefined;
    expect(farDayEl?.style.color).toBe("var(--ink)");
  });
});
