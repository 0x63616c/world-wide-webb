import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { defineTileMeta } from "./__stories__/factory";
import { EventsTileView } from "./EventsTileView";

const meta = {
  // Short display name kept for Storybook nav consistency with the existing "Tiles/Events" path.
  ...defineTileMeta("Events", EventsTileView, ["a11y"]),
  args: {
    status: "populated",
    events: [],
  },
} satisfies Meta<typeof EventsTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: {
    status: "loading",
    events: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Header always present regardless of state
    await expect(canvas.getByText("Upcoming")).toBeInTheDocument();
    // No event content while loading , skeleton only
    expect(canvas.queryByText("Gorgon City")).toBeNull();
  },
};

export const Empty: Story = {
  args: {
    status: "populated",
    events: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Upcoming")).toBeInTheDocument();
  },
};

export const ErrorEmpty: Story = {
  args: {
    status: "error",
    events: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Header still renders; skeleton shown instead of event rows
    await expect(canvas.getByText("Upcoming")).toBeInTheDocument();
    expect(canvas.queryByText("Gorgon City")).toBeNull();
  },
};

export const Default: Story = {
  args: {
    status: "populated",
    events: [
      { name: "Gorgon City", place: "Sound Nightclub", days: 3 },
      { name: "Chris Lake", place: "Shrine Expo Hall", days: 10 },
      { name: "John Summit", place: "Hollywood Palladium", days: 54 },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Gorgon City")).toBeInTheDocument();
    await expect(canvas.getByText("Sound Nightclub")).toBeInTheDocument();
    await expect(canvas.getByText("Chris Lake")).toBeInTheDocument();
    await expect(canvas.getByText("John Summit")).toBeInTheDocument();
    await expect(canvas.getByText("Upcoming")).toBeInTheDocument();
    await expect(canvas.getByText("All")).toBeInTheDocument();
  },
};

export const TodayEvent: Story = {
  name: "Populated , day-0 renders 'Today'",
  args: {
    status: "populated",
    events: [
      { name: "Gorgon City", place: "Sound Nightclub", days: 0 },
      { name: "Chris Lake", place: "Shrine Expo Hall", days: 10 },
      { name: "John Summit", place: "Hollywood Palladium", days: 54 },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // day-0 event shows "Today", not "0 days"
    await expect(canvas.getByText("Today")).toBeInTheDocument();
    expect(canvas.queryByText("0")).toBeNull();
  },
};

export const MultipleEvents: Story = {
  name: "Populated , 4+ events (truncated to 3)",
  args: {
    status: "populated",
    events: [
      { name: "Gorgon City", place: "Sound Nightclub", days: 3 },
      { name: "Chris Lake", place: "Shrine Expo Hall", days: 10 },
      { name: "John Summit", place: "Hollywood Palladium", days: 54 },
      { name: "Four Tet", place: "Greek Theatre", days: 80 },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Gorgon City")).toBeInTheDocument();
    await expect(canvas.getByText("Chris Lake")).toBeInTheDocument();
    await expect(canvas.getByText("John Summit")).toBeInTheDocument();
    // 4th event must not appear , tile only shows first 3
    expect(canvas.queryByText("Four Tet")).toBeNull();
  },
};

export const UrgentEvents: Story = {
  name: "Populated , urgent (days ≤ 3 accented)",
  args: {
    status: "populated",
    events: [
      { name: "Disclosure", place: "Hollywood Bowl", days: 1 },
      { name: "Bicep", place: "Kia Forum", days: 2 },
      { name: "Bonobo", place: "Ace Hotel", days: 15 },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Disclosure")).toBeInTheDocument();
    await expect(canvas.getByText("Bicep")).toBeInTheDocument();
    await expect(canvas.getByText("Bonobo")).toBeInTheDocument();
  },
};
