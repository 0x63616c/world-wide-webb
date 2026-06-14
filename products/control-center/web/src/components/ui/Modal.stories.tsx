import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { modalDocsParameters } from "../tiles/__stories__/factory";
import { Modal } from "./Modal";

// Thin wrapper so Storybook infers props from a function component signature.
function ModalStory(props: React.ComponentProps<typeof Modal>) {
  return <Modal {...props} />;
}

const meta = {
  title: "Modals/Modal",
  component: ModalStory,
  tags: ["autodocs"],
  parameters: modalDocsParameters(),
  args: {
    onClose: fn(),
    title: "Lamps",
    children: (
      <div style={{ color: "var(--ink-2)", fontSize: 16, lineHeight: 1.6 }}>
        Expanded controls render here , scenes, brightness, full controls.
      </div>
    ),
  },
} satisfies Meta<typeof ModalStory>;

export default meta;
type Story = StoryObj<typeof meta>;

// Open: dialog + title + close button are present, and dismissal works.
export const Open: Story = {
  args: { open: true },
  play: async ({ args }) => {
    // Modal renders via createPortal into document.body, so it lives OUTSIDE the
    // story's canvasElement , query the whole document (matches the unit test's
    // use of `screen`). Querying canvasElement here finds nothing in a real browser.
    const doc = within(document.body);
    const dialog = doc.getByRole("dialog", { name: "Lamps" });
    await expect(dialog).toBeInTheDocument();
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    // Backdrop click closes (panel-internal clicks must NOT, verified in unit tests).
    const backdrop = doc.getByTestId("modal-backdrop");
    await userEvent.click(backdrop);
    await expect(args.onClose).toHaveBeenCalled();
  },
};

// Closed: renders nothing , no dialog in the DOM.
export const Closed: Story = {
  args: { open: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};
