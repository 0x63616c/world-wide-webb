import type { Meta, StoryObj } from "@storybook/react-vite";
import { NetworkPill } from "../NetworkPill";

const meta: Meta<typeof NetworkPill> = {
  title: "Captive Portal/NetworkPill",
  component: NetworkPill,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Status pill with a green connected dot. NOTE: the design canvas labels this 'Guest Wi-Fi', but the PRD forbids the word 'guest' in any user-facing copy, so the label defaults to 'Wi-Fi' (and is a prop). This is a deliberate, approved deviation from the design verbatim. Appears only on the unshipped LandingSplit variant.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof NetworkPill>;

export const Default: Story = {};
export const CustomLabel: Story = { args: { label: "Home Wi-Fi" } };
