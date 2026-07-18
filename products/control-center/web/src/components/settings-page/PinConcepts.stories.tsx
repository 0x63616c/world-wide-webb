import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { PinChangeFlowConcept, PinUnlockModalConcept } from "./PinConcepts";

/**
 * PIN gate mockups: the small tap-pad unlock modal (shown before a locked tile
 * opens) and the change-PIN setup flow for the Settings Security page. Live
 * local state , demo PIN is 000000. Tap it in to see the unlock state; wrong
 * PINs flash the dots red.
 */
const meta = {
  title: "Concepts/PinCode",
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** Small centered pad over a dimmed board , what a locked tile tap opens. */
export const UnlockModal: Story = {
  render: () => <PinUnlockModalConcept />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Enter PIN")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "5" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "backspace" })).toBeInTheDocument();
  },
};

/** Security page's change-PIN flow: current -> new -> confirm, plus lock toggles. */
export const ChangePinFlow: Story = {
  render: () => <PinChangeFlowConcept />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Enter current PIN")).toBeInTheDocument();
    await expect(
      canvas.getByRole("switch", { name: "Require PIN for Settings" }),
    ).toBeInTheDocument();
  },
};
