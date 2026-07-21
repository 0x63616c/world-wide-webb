import type { Meta, StoryObj } from "@storybook/react-vite";
import { AlreadyConnected } from "./AlreadyConnected";

const meta: Meta<typeof AlreadyConnected> = {
  title: "Portal/Screens/AlreadyConnected",
  component: AlreadyConnected,
  tags: ["autodocs"],
  args: { onPrimary: () => {}, onReset: () => {} },
  parameters: {
    docs: {
      description: {
        component:
          "Returning device with a live authorization: check ring, 'already online', Continue browsing, Sign in again.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof AlreadyConnected>;
export const Default: Story = {};
