import type { Meta, StoryObj } from "@storybook/react-vite";
import { Sending } from "../Sending";

const meta: Meta<typeof Sending> = {
  title: "Captive Portal/Screens/Sending",
  component: Sending,
  tags: ["autodocs"],
  args: { email: "john@example.com" },
  parameters: {
    docs: {
      description: {
        component:
          "Transient loading after the landing submit while the code is dispatched. Large spinner + the destination email.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof Sending>;
export const Default: Story = {};
