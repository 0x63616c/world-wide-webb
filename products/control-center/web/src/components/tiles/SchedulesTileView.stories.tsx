/**
 * Stories for SchedulesTileView , covers loading + populated (with and without an
 * upcoming event). Play functions double as component-test assertions.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { defineTileMeta } from "./__stories__/factory";
import type { SchedulesTileViewProps } from "./SchedulesTileView";
import { SchedulesTileView } from "./SchedulesTileView";

const meta = {
  ...defineTileMeta("SchedulesTileView", SchedulesTileView),
  args: {
    status: "populated",
    data: { enabledCount: 3, nextLabel: "Red night · 21:30" },
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
    data: { enabledCount: 3, nextLabel: "Red night · 21:30" },
    onOpen: fn(),
  } as SchedulesTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("3")).toBeInTheDocument();
    await expect(canvas.getByText("Next · Red night · 21:30")).toBeInTheDocument();
  },
};

export const NoUpcoming: Story = {
  args: {
    status: "populated",
    data: { enabledCount: 0, nextLabel: null },
    onOpen: fn(),
  } as SchedulesTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No upcoming")).toBeInTheDocument();
  },
};
