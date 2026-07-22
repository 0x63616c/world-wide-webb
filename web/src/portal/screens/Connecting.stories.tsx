import type { Meta, StoryObj } from "@storybook/react-vite";
import { Connecting } from "./Connecting";

const meta: Meta<typeof Connecting> = {
  title: "Portal/Screens/Connecting",
  component: Connecting,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Stepped status while the authorize request runs. Step 1 is 'Checking the password' (copy source of truth).",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof Connecting>;
export const Default: Story = {};
