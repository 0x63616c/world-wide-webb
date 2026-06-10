import type { Meta, StoryObj } from "@storybook/react-vite";
import { Connecting } from "../Connecting";

const meta: Meta<typeof Connecting> = {
  title: "Captive Portal/Screens/Connecting",
  component: Connecting,
  tags: ["autodocs"],
  args: { email: "john@example.com" },
  parameters: {
    docs: {
      description: {
        component:
          "Stepped status while the authorize request runs. Step 1 is 'Checking the password' (screens.jsx copy).",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof Connecting>;
export const Default: Story = {};
