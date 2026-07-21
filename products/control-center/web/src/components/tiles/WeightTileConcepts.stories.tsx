import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { tilePixelSize } from "@/lib/grid-constants";
import { ICON_CANDIDATES, WeightConceptDetail, WeightConceptSparkline } from "./WeightTileConcepts";

/**
 * Chosen Weight tile concept (hero + sparkline, 3x2, 30-day window) rendered at
 * its real board pixel size, plus an icon bake-off row , same tile once per
 * lucide glyph candidate. Fixture data; winner becomes a real Tile/TileView pair.
 */
const meta = {
  title: "Experiments/Weight Tile",
  tags: ["autodocs"],
  parameters: { boardWrapper: false },
} satisfies Meta;

export default meta;
type Story = StoryObj;

const SIZE = tilePixelSize(3, 2);

/** The chosen 3x2 hero + sparkline look, default (Scale) glyph. */
export const HeroSparkline: Story = {
  name: "Hero + sparkline 3x2",
  render: () => (
    <div style={{ width: SIZE.width, height: SIZE.height }}>
      <WeightConceptSparkline />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("180.1")).toBeInTheDocument();
    await expect(canvas.getByText(/30d/)).toBeInTheDocument();
  },
};

/** All header-glyph candidates side by side , pick one, it joins the Icon map. */
export const IconBakeOff: Story = {
  name: "Icon bake-off",
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
      {ICON_CANDIDATES.map(({ name, glyph }) => (
        <figure key={name} style={{ margin: 0 }}>
          <div style={{ width: SIZE.width, height: SIZE.height }}>
            <WeightConceptSparkline glyph={glyph} />
          </div>
          <figcaption
            className="mono"
            style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 8, textAlign: "center" }}
          >
            {name}
          </figcaption>
        </figure>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("TrendingDown")).toBeInTheDocument();
  },
};

/** Detail modal that opens on tile tap , chart, body comp, excluded readings. */
export const Detail: Story = {
  name: "Detail modal",
  render: () => <WeightConceptDetail />,
  parameters: { docs: { story: { inline: false, height: "760px" } } },
  play: async ({ canvasElement }) => {
    // Modal portals to <body>, look there instead of the canvas root.
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText("Average")).toBeInTheDocument();
  },
};
