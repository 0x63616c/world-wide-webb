import type { Meta, StoryObj } from "@storybook/react-vite";
import { Success } from "../Success";

const meta: Meta<typeof Success> = {
  title: "Captive Portal/Screens/Success",
  component: Success,
  tags: ["autodocs"],
  args: { name: "John Appleseed", email: "john@example.com", onPrimary: () => {} },
  parameters: {
    docs: {
      description: {
        component:
          "Terminal success: white check ring, greets by first name, 'browser should redirect' line, Start browsing.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof Success>;
export const Named: Story = {};
export const NoName: Story = { name: "Fallback (friend)", args: { name: "" } };
