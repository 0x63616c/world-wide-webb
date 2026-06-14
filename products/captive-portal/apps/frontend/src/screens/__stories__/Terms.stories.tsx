import type { Meta, StoryObj } from "@storybook/react-vite";
import { Terms } from "../Terms";

const meta: Meta<typeof Terms> = {
  title: "Captive Portal/Screens/Terms",
  component: Terms,
  tags: ["autodocs"],
  args: { onBack: () => {} },
  parameters: {
    docs: {
      description: {
        component:
          "Terms of use: 5 sections, Back returns to the opener with form state intact. No SSID name, no 'guest'.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof Terms>;
export const Default: Story = {};
