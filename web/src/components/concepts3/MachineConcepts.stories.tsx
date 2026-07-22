import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MachineOrbit, MachineSplitFlap, MachineTerminal } from "./MachineConcepts";

const meta = {
  title: "Experiments/Round 3/Machine",
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj;

export const AOrbit: Story = {
  name: "A , Radial orbit",
  render: () => <MachineOrbit />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("14:32", {}, { timeout: 10000 })).toBeInTheDocument();
  },
};

export const BSplitFlap: Story = {
  name: "B , Split-flap board",
  render: () => <MachineSplitFlap />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // the clock is one flap cell per character, so assert on the masthead instead
    await expect(
      await canvas.findByText("HOUSE DEPARTURES", {}, { timeout: 10000 }),
    ).toBeInTheDocument();
  },
};

export const CTerminal: Story = {
  name: "C , System monitor CRT",
  render: () => <MachineTerminal />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("14:32", {}, { timeout: 10000 })).toBeInTheDocument();
  },
};
