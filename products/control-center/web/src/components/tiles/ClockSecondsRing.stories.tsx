/**
 * ClockSecondsRing is a self-driving wrapper over BorderProgressRing with no
 * props. It reads the wall clock via requestAnimationFrame and feeds fractional
 * minute progress (0..1) to the ring , the sweep updates every animation frame
 * and wraps instantly at the top of each minute.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { BorderProgressRing } from "@/components/ui";
import { ClockSecondsRing } from "./ClockSecondsRing";

const meta = {
  title: "Tiles/ClockSecondsRing",
  component: ClockSecondsRing,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A self-driving wrapper over `BorderProgressRing` with no props. Reads the wall clock via `requestAnimationFrame` and feeds fractional minute progress (0..1) to the ring , the sweep updates every animation frame and wraps instantly at the top of each minute.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: "relative",
          width: 200,
          height: 200,
          borderRadius: 16,
          background: "var(--surface-1, #111)",
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ClockSecondsRing>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The live self-animating ring , reads the real clock. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const ring = canvas.getByTestId("seconds-ring");
    await expect(ring).toBeInTheDocument();
  },
};

/**
 * Static visual at 50% fill , renders `BorderProgressRing` directly so the
 * docs snapshot is time-independent. Useful for documenting the appearance
 * without depending on the wall clock.
 */
export const FrozenHalf: Story = {
  render: () => (
    <div
      style={{
        position: "relative",
        width: 200,
        height: 200,
        borderRadius: 16,
        background: "var(--surface-1, #111)",
      }}
    >
      <BorderProgressRing progress={0.5} width={200} height={200} radius={16} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const svg = canvasElement.querySelector("svg");
    await expect(svg).not.toBeNull();
  },
};
