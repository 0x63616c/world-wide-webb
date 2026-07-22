import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { ConfirmDialog } from "./ConfirmDialog";

const meta = {
  title: "UI/ConfirmDialog",
  component: ConfirmDialog,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    title: "Reset settings?",
    message: "Restore every setting on this panel to its default. This cannot be undone.",
    confirmLabel: "Reset",
    tone: "danger",
    onConfirm: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The destructive default: red Confirm, and Confirm fires the callback. */
export const Danger: Story = {
  play: async ({ args, canvasElement }) => {
    // Modal portals to document.body, so it lives OUTSIDE canvasElement.
    const doc = within(canvasElement.ownerDocument.body);
    await expect(doc.getByText("Reset settings?")).toBeInTheDocument();
    doc.getByRole("button", { name: "Reset" }).click();
    await expect(args.onConfirm).toHaveBeenCalled();
  },
};

/** A neutral confirmation; Cancel closes without confirming. */
export const Default: Story = {
  args: {
    title: "Apply changes?",
    message: "This will apply your pending changes.",
    confirmLabel: "Apply",
    tone: "default",
  },
  play: async ({ args, canvasElement }) => {
    const doc = within(canvasElement.ownerDocument.body);
    doc.getByRole("button", { name: "Cancel" }).click();
    await expect(args.onClose).toHaveBeenCalled();
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};
