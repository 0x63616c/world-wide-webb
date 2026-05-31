import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Skeleton, Tile } from "../ui";
import { ClockGreetingView } from "./ClockGreetingView";

const meta = {
  title: "Tiles/ClockGreetingView",
  component: ClockGreetingView,
  tags: ["autodocs"],
  args: {
    greeting: "Good morning",
    hour12: 9,
    minutes: "30",
    ampm: "AM",
    fullDate: "Saturday, May 31, 2026",
    location: "Home",
  },
  argTypes: {
    greeting: {
      control: "select",
      options: ["Good morning", "Good afternoon", "Good evening", "Good night"],
    },
    ampm: { control: "radio", options: ["AM", "PM"] },
    hour12: { control: { type: "number", min: 1, max: 12 } },
    minutes: { control: "text" },
    fullDate: { control: "text" },
    location: { control: "text" },
  },
} satisfies Meta<typeof ClockGreetingView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/good morning/i)).toBeTruthy();
    await expect(canvas.getByTestId("clock-ampm")).toBeTruthy();
    await expect(canvas.getByTestId("clock-date")).toBeTruthy();
    await expect(canvas.getByText(/home/i)).toBeTruthy();
  },
};

export const Evening: Story = {
  name: "Evening (PM)",
  args: {
    greeting: "Good evening",
    hour12: 7,
    minutes: "45",
    ampm: "PM",
    fullDate: "Saturday, May 31, 2026",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/good evening/i)).toBeTruthy();
    const ampm = canvas.getByTestId("clock-ampm");
    await expect(ampm.textContent).toBe("PM");
  },
};

export const Night: Story = {
  name: "Night",
  args: {
    greeting: "Good night",
    hour12: 11,
    minutes: "58",
    ampm: "PM",
    fullDate: "Saturday, May 31, 2026",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/good night/i)).toBeTruthy();
  },
};

// Loading renders skeleton placeholders — the container ClockGreeting never
// shows a partial time, so we represent the loading state with a dedicated
// skeleton layout inside the same Tile wrapper.
function ClockGreetingLoading() {
  return (
    <Tile
      padding={28}
      style={{
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        textAlign: "center",
      }}
    >
      <Skeleton w={120} h={14} />
      <Skeleton w={220} h={88} />
      <Skeleton w={180} h={18} />
      <Skeleton w={140} h={14} />
    </Tile>
  );
}

export const Loading: StoryObj = {
  render: () => <ClockGreetingLoading />,
  parameters: {
    // Exclude from autodocs since it is a skeleton variant, not a ClockGreetingView args story
    docs: { disable: true },
  },
  play: async ({ canvasElement }) => {
    // Assert via data-skeleton attribute — resilient to CSS refactors
    const skeletons = canvasElement.querySelectorAll("[data-skeleton]");
    await expect(skeletons.length).toBeGreaterThan(0);
  },
};

// ErrorState shows skeleton fallback when time data cannot be fetched.
// The tile never renders partial/stale data — it falls back to shimmer skeletons.
export const ErrorState: StoryObj = {
  render: () => <ClockGreetingLoading />,
  name: "Error (failed to fetch)",
  parameters: {
    docs: { disable: true },
  },
  play: async ({ canvasElement }) => {
    const skeletons = canvasElement.querySelectorAll("[data-skeleton]");
    await expect(skeletons.length).toBeGreaterThan(0);
  },
};

// WithSecondsRing shows the optional seconds progress ring traced along the tile border.
export const WithSecondsRing: Story = {
  name: "With Seconds Ring",
  args: {
    seconds: 30,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("seconds-ring")).toBeTruthy();
    await expect(canvas.getByText(/good morning/i)).toBeTruthy();
  },
};
