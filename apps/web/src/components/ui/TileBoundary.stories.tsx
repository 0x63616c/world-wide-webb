import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";
import { expect, within } from "storybook/test";
import { TileBoundary } from "./TileBoundary";

// Component that throws on render to exercise the boundary.
function ThrowingChild(): React.ReactNode {
  throw new Error("simulated tile render failure");
}

// Healthy neighbour to prove sibling isolation.
function HealthyChild() {
  return (
    <div
      data-testid="healthy-tile"
      style={{ padding: 16, color: "var(--fg)", fontFamily: "var(--font-ui)" }}
    >
      Healthy tile — unaffected by sibling crash
    </div>
  );
}

// Thin wrapper so Storybook can infer props from a function component signature.
function TileBoundaryStory(props: React.ComponentProps<typeof TileBoundary>) {
  return <TileBoundary {...props} />;
}

const meta = {
  title: "UI/TileBoundary",
  component: TileBoundaryStory,
  tags: ["autodocs"],
} satisfies Meta<typeof TileBoundaryStory>;

export default meta;
type Story = StoryObj<typeof meta>;

// Success state: boundary is transparent when children render normally.
export const ChildrenRenderNormally: Story = {
  args: {
    children: <HealthyChild />,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("healthy-tile")).toBeInTheDocument();
    await expect(canvasElement.querySelector("[data-tile-boundary-fallback]")).toBeNull();
  },
};

// Error state: boundary catches a thrown render error and shows shimmer fallback.
export const CatchesRenderError: Story = {
  args: {
    children: <ThrowingChild />,
  },
  play: async ({ canvasElement }) => {
    const fallback = canvasElement.querySelector("[data-tile-boundary-fallback]");
    await expect(fallback).not.toBeNull();
    // Skeleton primitives must be present — no white-screen.
    const skeletons = canvasElement.querySelectorAll("[data-skeleton]");
    await expect(skeletons.length).toBeGreaterThan(0);
  },
};

// Isolation: one crashing tile's boundary does not affect its sibling.
export const SiblingIsolation: Story = {
  args: { children: null },
  render: () => (
    <div style={{ display: "flex", gap: 16 }}>
      <div style={{ width: 200, height: 120 }}>
        <TileBoundary>
          <ThrowingChild />
        </TileBoundary>
      </div>
      <div style={{ width: 200, height: 120 }}>
        <TileBoundary>
          <HealthyChild />
        </TileBoundary>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Healthy sibling still renders.
    await expect(canvas.getByTestId("healthy-tile")).toBeInTheDocument();
    // One fallback present for the crashing tile.
    const fallbacks = canvasElement.querySelectorAll("[data-tile-boundary-fallback]");
    await expect(fallbacks.length).toBe(1);
  },
};
