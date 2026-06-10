import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";

const meta: Meta<typeof Button> = {
  title: "Captive Portal/Button",
  component: Button,
  tags: ["autodocs"],
  args: { children: "Connect to Wi-Fi", type: "button" },
  parameters: {
    docs: {
      description: {
        component:
          "Full-width 42px button. One primary (white on black) carries the main action on every screen; a ghost variant handles secondary actions. `loading` shows a spinner, disables the button, and keeps the label meaningful, it is the double-submit guard.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = {};
export const PrimaryHover: Story = {
  name: "Primary · hover",
  args: { style: { background: "#e2e2e2" } },
};
export const Loading: Story = { args: { loading: true, children: "Connecting…" } };
export const Disabled: Story = { args: { disabled: true } };
export const Ghost: Story = { args: { variant: "ghost", children: "Go back" } };
export const GhostHover: Story = {
  name: "Ghost · hover",
  args: {
    variant: "ghost",
    children: "Go back",
    style: { background: "#111", borderColor: "#3a3a3a" },
  },
};
