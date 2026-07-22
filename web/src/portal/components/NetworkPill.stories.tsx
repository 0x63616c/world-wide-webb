import type { Meta, StoryObj } from "@storybook/react-vite";
import { NetworkPill } from "./NetworkPill";

const meta: Meta<typeof NetworkPill> = {
  title: "Portal/Components/NetworkPill",
  component: NetworkPill,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Network-status pill for the unshipped LandingSplit variant. Defaults to 'Wi-Fi', never 'Guest Wi-Fi' , the PRD forbids 'guest' in user-facing copy.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof NetworkPill>;
export const Default: Story = {};
export const CustomLabel: Story = { args: { label: "Home Network" } };
