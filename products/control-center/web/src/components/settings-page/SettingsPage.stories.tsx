import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";
import { expect, fn, within } from "storybook/test";
import { SettingsPage } from "./SettingsPage";

// Thin wrapper so Storybook infers props from the function-component signature.
function SettingsPageStory(props: React.ComponentProps<typeof SettingsPage>) {
  return <SettingsPage {...props} />;
}

const meta = {
  title: "SettingsPage/SettingsPage",
  component: SettingsPageStory,
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
  args: {
    open: true,
    onClose: fn(),
    onOpenLevel: fn(),
    onOpenClean: fn(),
  },
} satisfies Meta<typeof SettingsPageStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The full-page settings shell open over the fullscreen frame. Page bodies land
 * in later tasks; here we assert the sidebar surfaces all eight pages.
 */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    // The page portals into document.body, so it lives OUTSIDE canvasElement.
    const doc = within(canvasElement.ownerDocument.body);
    for (const name of [
      "Device",
      "Display",
      "Board",
      "Network",
      "Notifications",
      "Security",
      "Debug",
      "About",
    ]) {
      await expect(doc.getByRole("button", { name })).toBeInTheDocument();
    }
  },
};
