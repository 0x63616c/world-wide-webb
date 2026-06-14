/**
 * Stories for MinimapView , covers the pure presentational minimap in all
 * visual states so addon-vitest runs them as component tests.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import type { MinimapLabelledRect, MinimapRect } from "./MinimapView";
import { MinimapView } from "./MinimapView";

// ─── Shared fixture data ──────────────────────────────────────────────────────

// These values mirror what Minimap.tsx computes at runtime (WORLD_W=WORLD_H=3950,
// MAX_EXTENT=180, SCALE≈0.0456).
const SCALE = 180 / 3950;
const WORLD_VIEW_W = 3950 * SCALE; // 180
const WORLD_VIEW_H = 3950 * SCALE; // 180

// A small cluster of tiles at world-pixel coords.
const TILE_FIXTURES: MinimapLabelledRect[] = [
  { x: 1800, y: 1600, w: 280, h: 188, label: "Clock" },
  { x: 2100, y: 1600, w: 188, h: 188, label: "Weather" },
  { x: 1800, y: 1806, w: 188, h: 188, label: "Climate" },
  { x: 2100, y: 1806, w: 188, h: 188, label: "Controls" },
];

// Viewport centred on the cluster (board ≈ 1366×1000 in world coords).
const CENTERED_VIEWPORT: MinimapRect = { x: 1600, y: 1450, w: 1366, h: 1000 };

// Viewport scrolled to the top-right corner of the world.
const EDGE_VIEWPORT: MinimapRect = { x: 3000, y: 0, w: 1366, h: 1000 };

// A few ghost (placeholder) rects scattered around the world edge.
const GHOST_FIXTURES: MinimapRect[] = [
  { x: 200, y: 200, w: 188, h: 188 },
  { x: 3400, y: 3400, w: 188, h: 188 },
];

// Decorator: fixed-size board stage so the absolute-positioned minimap is
// positioned correctly and the test can query its DOM.
function BoardStage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: 400,
        height: 300,
        background: "#0c0e11",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

const meta = {
  title: "Components/MinimapView",
  component: MinimapView,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <BoardStage>
        <Story />
      </BoardStage>
    ),
  ],
  args: {
    worldViewW: WORLD_VIEW_W,
    worldViewH: WORLD_VIEW_H,
    scale: SCALE,
    tiles: TILE_FIXTURES,
    ghosts: GHOST_FIXTURES,
    viewportRect: CENTERED_VIEWPORT,
    shown: true,
    hoveredLabel: null,
  },
} satisfies Meta<typeof MinimapView>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── CenteredView ──────────────────────────────────────────────────────────────
// Viewport centred over the tile cluster; no hover label.

export const CenteredView: Story = {
  args: {
    viewportRect: CENTERED_VIEWPORT,
    shown: true,
    hoveredLabel: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // World area renders.
    const world = canvas.getByTestId("minimap-world");
    expect(world).toBeInTheDocument();
    // Viewport indicator renders.
    const vp = canvas.getByTestId("minimap-viewport");
    expect(vp).toBeInTheDocument();
    // No hover label when hoveredLabel is null.
    expect(canvas.queryByTestId("minimap-label")).not.toBeInTheDocument();
  },
};

// ─── PannedToEdge ─────────────────────────────────────────────────────────────
// Viewport scrolled to the top-right corner of the world , indicator is at edge.

export const PannedToEdge: Story = {
  args: {
    viewportRect: EDGE_VIEWPORT,
    shown: true,
    hoveredLabel: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("minimap-world")).toBeInTheDocument();
    const vp = canvas.getByTestId("minimap-viewport");
    expect(vp).toBeInTheDocument();
    // Indicator is positioned toward the right/top edge of the world area.
    const vpLeft = Number.parseFloat((vp as HTMLElement).style.left ?? "0");
    expect(vpLeft).toBeGreaterThan(WORLD_VIEW_W * 0.5);
  },
};

// ─── TileFocused ─────────────────────────────────────────────────────────────
// Cursor is over the "Weather" tile , label renders to the right of the map.

export const TileFocused: Story = {
  args: {
    viewportRect: CENTERED_VIEWPORT,
    shown: true,
    hoveredLabel: "Weather",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("minimap-world")).toBeInTheDocument();
    expect(canvas.getByTestId("minimap-viewport")).toBeInTheDocument();
    // Label text rendered.
    const label = canvas.getByTestId("minimap-label");
    expect(label).toBeInTheDocument();
    expect(label).toHaveTextContent("Weather");
  },
};

// ─── Visible ─────────────────────────────────────────────────────────────────
// Minimap is fully visible (shown=true → opacity 1).

export const Visible: Story = {
  args: {
    shown: true,
    hoveredLabel: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = canvas.getByTestId("minimap-root");
    expect(root).toBeInTheDocument();
    expect(root).toHaveStyle({ opacity: "1" });
    expect(canvas.getByTestId("minimap-world")).toBeInTheDocument();
    expect(canvas.getByTestId("minimap-viewport")).toBeInTheDocument();
  },
};

// ─── FadedOut ─────────────────────────────────────────────────────────────────
// Minimap is transparent (shown=false → opacity 0) , auto-hidden after pan ends.

export const FadedOut: Story = {
  args: {
    shown: false,
    hoveredLabel: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = canvas.getByTestId("minimap-root");
    expect(root).toBeInTheDocument();
    // The root element renders but is visually transparent.
    expect(root).toHaveStyle({ opacity: "0" });
    // World area and viewport indicator still present in the DOM.
    expect(canvas.getByTestId("minimap-world")).toBeInTheDocument();
    expect(canvas.getByTestId("minimap-viewport")).toBeInTheDocument();
  },
};
