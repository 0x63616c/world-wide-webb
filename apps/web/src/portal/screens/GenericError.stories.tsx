import type { Meta, StoryObj } from "@storybook/react-vite";
import { GenericError } from "./GenericError";

const meta: Meta<typeof GenericError> = {
  title: "Portal/Screens/GenericError",
  component: GenericError,
  tags: ["autodocs"],
  args: { onRetry: () => {}, onReset: () => {} },
  parameters: {
    docs: {
      description: {
        component:
          "Unexpected server/network error: neutral ring, generic apology, Try again + Start over. No dead end.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof GenericError>;
export const Default: Story = {};
