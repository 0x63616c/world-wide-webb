import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventsTile } from "../EventsTile";

// ---- Mock the tRPC hook ----
const mockUseQuery = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    events: {
      list: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
    },
  },
}));

describe("EventsTile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders event data when query succeeds", () => {
    mockUseQuery.mockReturnValue({
      data: [
        { name: "Gorgon City", place: "Sound Nightclub", days: 3 },
        { name: "Chris Lake", place: "Shrine Expo Hall", days: 10 },
        { name: "John Summit", place: "Hollywood Palladium", days: 54 },
      ],
      isLoading: false,
      isError: false,
    });

    render(<EventsTile />);

    expect(screen.getByText("Gorgon City")).toBeTruthy();
    expect(screen.getByText("Sound Nightclub")).toBeTruthy();
    expect(screen.getByText("Chris Lake")).toBeTruthy();
    expect(screen.getByText("Shrine Expo Hall")).toBeTruthy();
    expect(screen.getByText("John Summit")).toBeTruthy();

    // Section header
    expect(screen.getByText("Upcoming")).toBeTruthy();
    // "All ›" link text
    expect(screen.getByText("All")).toBeTruthy();
  });

  it("renders only first 3 events when more are returned", () => {
    mockUseQuery.mockReturnValue({
      data: [
        { name: "Event A", place: "Venue A", days: 1 },
        { name: "Event B", place: "Venue B", days: 5 },
        { name: "Event C", place: "Venue C", days: 10 },
        { name: "Event D", place: "Venue D", days: 20 },
      ],
      isLoading: false,
      isError: false,
    });

    render(<EventsTile />);

    expect(screen.getByText("Event A")).toBeTruthy();
    expect(screen.getByText("Event B")).toBeTruthy();
    expect(screen.getByText("Event C")).toBeTruthy();
    expect(screen.queryByText("Event D")).toBeNull();
  });

  it("renders skeleton (no Gorgon City) while loading", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<EventsTile />);

    expect(screen.queryByText("Gorgon City")).toBeNull();
    expect(screen.getByText("Upcoming")).toBeTruthy();
  });

  it("renders skeleton on error (no Gorgon City placeholder)", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<EventsTile />);

    expect(screen.queryByText("Gorgon City")).toBeNull();
    expect(screen.getByText("Upcoming")).toBeTruthy();
  });

  it("applies accent color to days <= 3", () => {
    mockUseQuery.mockReturnValue({
      data: [
        { name: "Urgent Event", place: "Venue X", days: 2 },
        { name: "Far Event", place: "Venue Y", days: 30 },
        { name: "Medium Event", place: "Venue Z", days: 10 },
      ],
      isLoading: false,
      isError: false,
    });

    const { container } = render(<EventsTile />);

    // The first event (days=2) should have accent color applied
    const dayNumbers = container.querySelectorAll(".mono");
    const urgentDay = Array.from(dayNumbers).find((el) => el.textContent === "2") as
      | HTMLElement
      | undefined;
    expect(urgentDay).toBeTruthy();
    expect(urgentDay?.style.color).toBe("var(--acc)");

    // A non-urgent day should NOT have accent color
    const farDay = Array.from(dayNumbers).find((el) => el.textContent === "30") as
      | HTMLElement
      | undefined;
    expect(farDay).toBeTruthy();
    expect(farDay?.style.color).toBe("var(--ink)");
  });

  it("calls useQuery with <=5-min refetch interval", () => {
    mockUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    render(<EventsTile />);

    const [, opts] = mockUseQuery.mock.calls[0];
    expect(opts.refetchInterval).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it("renders skeleton when data is available but empty (no invented events)", () => {
    mockUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    render(<EventsTile />);

    // No real event rows should be rendered for an empty list
    expect(screen.queryByText("Gorgon City")).toBeNull();
    expect(screen.queryByText("Chris Lake")).toBeNull();
    expect(screen.getByText("Upcoming")).toBeTruthy();
  });
});
