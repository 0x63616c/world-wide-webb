/**
 * Stories for SchedulesTileView , covers loading + populated (with and without an
 * upcoming event). Play functions double as component-test assertions.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { defineTileMeta } from "./__stories__/factory";
import type { SchedulesTileViewProps } from "./SchedulesTileView";
import { SchedulesTileView } from "./SchedulesTileView";

const rows = [
  { id: "sched_wake", name: "Wake white", days: "Weekdays", time: "6:45", scene: "white" as const },
  { id: "sched_red", name: "Red night", days: "Every day", time: "21:30", scene: "red" as const },
];

const meta = {
  ...defineTileMeta("SchedulesTileView", SchedulesTileView),
  args: {
    status: "populated",
    data: { enabledCount: 3, rows, next: { name: "Wake white", time: "6:45" } },
    onOpen: fn(),
  } as SchedulesTileViewProps,
} satisfies Meta<typeof SchedulesTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: { status: "loading" } as SchedulesTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Schedules")).toBeInTheDocument();
  },
};

export const Populated: Story = {
  args: {
    status: "populated",
    data: { enabledCount: 3, rows, next: { name: "Wake white", time: "6:45" } },
    onOpen: fn(),
  } as SchedulesTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("3 on")).toBeInTheDocument();
    await expect(canvas.getByText("Wake white")).toBeInTheDocument();
    await expect(canvas.getByText("Red night")).toBeInTheDocument();
    await expect(canvas.getByText("Next · Wake white")).toBeInTheDocument();
  },
};

export const NoUpcoming: Story = {
  args: {
    status: "populated",
    data: { enabledCount: 0, rows: [], next: null },
    onOpen: fn(),
  } as SchedulesTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("0 on")).toBeInTheDocument();
    await expect(canvas.getByText("No active schedules")).toBeInTheDocument();
    await expect(canvas.getByText("No upcoming")).toBeInTheDocument();
  },
};
