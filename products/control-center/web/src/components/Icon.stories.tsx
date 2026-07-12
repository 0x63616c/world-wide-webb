import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import type { IconName } from "./Icon";
import { GLYPHS, Icon } from "./Icon";

// All icon names derived automatically from the runtime glyph map.
const ICON_NAMES = Object.keys(GLYPHS) as IconName[];

const meta = {
  title: "Components/Icon",
  component: Icon,
  tags: ["autodocs"],
  args: {
    name: "lamp",
  },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Gallery ─────────────────────────────────────────────────────────────────
// Renders every IconName in a labeled grid , new icons appear automatically.

export const Gallery: Story = {
  render: () => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr)",
        gap: 20,
        padding: 20,
      }}
    >
      {ICON_NAMES.map((name) => (
        <div
          key={name}
          data-cell={name}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            color: "currentColor",
          }}
        >
          <Icon name={name} s={28} />
          <span style={{ fontSize: 11, opacity: 0.7 }}>{name}</span>
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Every icon name gets a labeled cell.
    const cells = canvasElement.querySelectorAll("[data-cell]");
    expect(cells).toHaveLength(ICON_NAMES.length);
    // Spot-check specific well-known icons are present.
    expect(canvas.getByText("lamp")).toBeInTheDocument();
    expect(canvas.getByText("fan")).toBeInTheDocument();
    expect(canvas.getByText("bulb")).toBeInTheDocument();
    // svg count matches icon count (one svg per icon).
    const svgs = canvasElement.querySelectorAll("svg");
    expect(svgs).toHaveLength(ICON_NAMES.length);
  },
};

// ─── Sizes ────────────────────────────────────────────────────────────────────

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 20, padding: 20 }}>
      {([14, 18, 22, 32, 48] as const).map((s) => (
        <Icon key={s} name="lamp" s={s} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const svgs = canvasElement.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(3);
  },
};

// ─── Colors ─────────────────────────────────────────────────────────────────

export const Colors: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 20, padding: 20 }}>
      {["#f59e0b", "#3b82f6", "#10b981", "#ef4444", "currentColor"].map((c) => (
        <Icon key={c} name="bulb" s={28} c={c} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const svgs = canvasElement.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(3);
  },
};

// ─── StrokeWidth ──────────────────────────────────────────────────────────────

export const StrokeWidth: Story = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 24, padding: 20 }}>
      {([1, 1.5, 1.7, 2, 2.5] as const).map((sw) => (
        <Icon key={sw} name="thermo" s={32} sw={sw} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const svgs = canvasElement.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(3);
  },
};

// ─── FanSpin ──────────────────────────────────────────────────────────────────
// The fan icon renders an svg; the spin animation class is applied externally
// by parent components (e.g. ControlTap). This story confirms the glyph renders.

export const FanSpin: Story = {
  render: () => (
    <div style={{ padding: 20 }}>
      <Icon name="fan" s={40} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const svg = canvasElement.querySelector("svg");
    expect(svg).toBeInTheDocument();
    // The lucide Fan glyph carries a class containing "lucide-fan".
    // svg.className is an SVGAnimatedString; use getAttribute for string access.
    expect(svg?.getAttribute("class")).toMatch(/lucide/);
  },
};
