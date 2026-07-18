import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { SchedulesModalConcept, SchedulesTileConcept } from "./SchedulesConcepts";

/**
 * Schedules re-styled in the approved Settings visual language (grouped inset
 * cards, mono uppercase section labels, tinted icon chips). Two throwaway
 * concepts wired to local placeholder state , flip the switches to feel them.
 * Pick a direction; this file then dies and the real tile/modal get built.
 */
const meta = {
  title: "Concepts/Schedules",
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** The compact tile: count pill, two dense schedule rows, a next-run footer. */
export const Tile: Story = {
  name: "Tile , compact",
  render: () => <SchedulesTileConcept />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Schedules")).toBeInTheDocument();
    await expect(canvas.getByText("3 on")).toBeInTheDocument();
    await expect(canvas.getByText(/Next ·/)).toBeInTheDocument();
  },
};

/** The full-page modal: dimmed backdrop + centered card of grouped sections. */
export const Modal: Story = {
  name: "Modal , settings style",
  render: () => <SchedulesModalConcept />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Schedules" })).toBeInTheDocument();
    await expect(canvas.getByRole("switch", { name: "Enable Red night" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Close" })).toBeInTheDocument();
  },
};
