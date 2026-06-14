import type { Meta, StoryObj } from "@storybook/react-vite";
import { AlreadyConnected } from "../AlreadyConnected";

const meta: Meta<typeof AlreadyConnected> = {
  title: "Captive Portal/Screens/AlreadyConnected",
  component: AlreadyConnected,
  tags: ["autodocs"],
  args: { email: "john@example.com", onPrimary: () => {}, onReset: () => {} },
  parameters: {
    docs: {
      description: {
        component:
          "Returning device with a live authorization: white ring, 'already online', Continue browsing, Sign in again.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof AlreadyConnected>;
export const Default: Story = {};
