/**
 * Stories for ExpandedSchedulesModalView , the schedules manager overlay. View-
 * driven (all data + callbacks via props). Grouped under "Modals/".
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { modalDocsParameters } from "../__stories__/factory";
import type { LightOption, ScheduleItem } from "./ExpandedSchedulesModalView";
import { ExpandedSchedulesModalView } from "./ExpandedSchedulesModalView";

const lights: LightOption[] = [
  { id: "living-globe", label: "Globe", room: "Living Room", kind: "lamp" },
  { id: "living-corner", label: "Corner Lamp", room: "Living Room", kind: "lamp" },
  { id: "kitchen-lamp", label: "Lamp", room: "Kitchen", kind: "lamp" },
  { id: "desk", label: "Desk", room: "Office", kind: "lamp" },
  { id: "bed-left", label: "Bed Left", room: "Bedroom", kind: "lamp" },
  { id: "bed-right", label: "Bed Right", room: "Bedroom", kind: "lamp" },
];

const schedules: ScheduleItem[] = [
  {
    id: "sched_sunrise",
    name: "Sunrise on",
    enabled: true,
    days: [0, 1, 2, 3, 4, 5, 6],
    trigger: { type: "sun", event: "sunrise", offsetMin: -30 },
    action: { on: true, scene: "white", brightness: 100, fadeMinutes: 0 },
    targetIds: ["living-globe", "living-corner", "kitchen-lamp", "desk"],
  },
  {
    id: "sched_red",
    name: "Red night",
    enabled: false,
    days: [0, 1, 2, 3, 4, 5, 6],
    trigger: { type: "fixed", time: "21:30" },
    action: { on: true, scene: "red", brightness: 60, fadeMinutes: 60 },
    targetIds: ["living-globe", "kitchen-lamp"],
  },
];

const meta = {
  title: "Modals/Schedules/Manage",
  component: ExpandedSchedulesModalView,
  tags: ["autodocs"],
  parameters: modalDocsParameters(),
  args: {
    open: true,
    onClose: fn(),
    schedules,
    nextLabelById: { sched_sunrise: "5:20", sched_red: "21:30" },
    lights,
    onCreate: fn(),
    onUpdate: fn(),
    onDelete: fn(),
    onToggle: fn(),
  },
} satisfies Meta<typeof ExpandedSchedulesModalView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByText("Sunrise on")).toBeInTheDocument();
    await expect(canvas.getByText("Red night")).toBeInTheDocument();
  },
};

export const Editor: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByText("Red night"));
    await expect(canvas.getByText("Days")).toBeInTheDocument();
    await expect(canvas.getByText("Non-bedroom")).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { schedules: [], nextLabelById: {} },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByText("No schedules yet.")).toBeInTheDocument();
  },
};
