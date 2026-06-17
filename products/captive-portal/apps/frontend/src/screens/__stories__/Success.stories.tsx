import type { Meta, StoryObj } from "@storybook/react-vite";
import { Success } from "../Success";

const meta: Meta<typeof Success> = {
  title: "Captive Portal/Screens/Success",
  component: Success,
  tags: ["autodocs"],
  args: { onPrimary: () => {} },
  parameters: {
    docs: {
      description: {
        component:
          "Terminal success: white check ring, 'You’re online.', 'browser should redirect' line, Start browsing.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof Success>;
export const Default: Story = {};
