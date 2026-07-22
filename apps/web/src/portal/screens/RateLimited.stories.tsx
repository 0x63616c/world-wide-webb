import type { Meta, StoryObj } from "@storybook/react-vite";
import { RateLimited } from "./RateLimited";

const meta: Meta<typeof RateLimited> = {
  title: "Portal/Screens/RateLimited",
  component: RateLimited,
  tags: ["autodocs"],
  args: { onRetry: () => {}, onReset: () => {} },
  parameters: {
    docs: {
      description: {
        component:
          "Too many wrong passwords: neutral ring, mm:ss countdown, Try again disabled until 0, Start over.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof RateLimited>;
export const CountingDown: Story = { args: { initialLeft: 297 } };
export const Ready: Story = { name: "Cooldown elapsed", args: { initialLeft: 0 } };
