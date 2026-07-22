import type { Meta, StoryObj } from "@storybook/react-vite";
import { FpsSparkline } from "./FpsSparkline";

// Dark board-like backdrop so the subtle --ink-3 hairline is visible.
function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 24, background: "#0c0e11", display: "inline-block", borderRadius: 8 }}>
      {children}
    </div>
  );
}

const meta = {
  title: "Components/FpsSparkline",
  component: FpsSparkline,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Backdrop>
        <Story />
      </Backdrop>
    ),
  ],
} satisfies Meta<typeof FpsSparkline>;

export default meta;
type Story = StoryObj<typeof meta>;

// A steady 60fps line , the healthy baseline.
export const Flat: Story = {
  args: { samples: Array.from({ length: 120 }, () => 60) },
};

// Noisy jitter around 55fps.
export const Noisy: Story = {
  args: {
    samples: Array.from({ length: 120 }, (_, i) => 55 + Math.round(6 * Math.sin(i / 3))),
  },
};

// A momentary dip to ~20fps in the middle of an otherwise smooth run.
export const Dip: Story = {
  args: {
    samples: Array.from({ length: 120 }, (_, i) => (i >= 58 && i <= 64 ? 20 : 60)),
  },
};

// Fewer than two samples renders nothing (the component returns null).
export const EmptyBelowTwoSamples: Story = {
  args: { samples: [60] },
};
