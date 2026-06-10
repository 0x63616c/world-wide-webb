import type { Meta, StoryObj } from "@storybook/react-vite";
import { SessionExpired } from "../SessionExpired";

const meta: Meta<typeof SessionExpired> = {
  title: "Captive Portal/Screens/SessionExpired",
  component: SessionExpired,
  tags: ["autodocs"],
  args: { onReconnect: () => {} },
  parameters: {
    docs: {
      description: {
        component: "30-day access lapsed: wifi ring, 'Your access has expired', Sign in again.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof SessionExpired>;
export const Default: Story = {};
