import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { BorderProgressRing } from "./BorderProgressRing";

// BorderProgressRing uses position:absolute + 100% w/h so it needs a
// `position:relative` host with explicit dimensions to render at a sane size.
function Cell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: 200,
        height: 120,
        borderRadius: 16,
        background: "var(--surface-1, #1a1a1a)",
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "UI/BorderProgressRing",
  component: BorderProgressRing,
  tags: ["autodocs"],
  args: {
    progress: 0.5,
    color: "var(--accent, #6fdbcb)",
    width: 200,
    height: 120,
    radius: 16,
  },
  decorators: [
    (Story) => (
      <Cell>
        <Story />
      </Cell>
    ),
  ],
} satisfies Meta<typeof BorderProgressRing>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { progress: 0 },
  play: async ({ canvasElement }) => {
    const svg = canvasElement.querySelector("svg");
    await expect(svg).not.toBeNull();
    // At 0 progress the ring path exists but the dashoffset equals the full length ,
    // strokeDashoffset should equal strokeDasharray (nothing visible).
    const ringPath = canvasElement.querySelector("[data-ring-path]");
    await expect(ringPath).not.toBeNull();
    const dasharray =
      ringPath?.getAttribute("strokeDasharray") ?? ringPath?.getAttribute("stroke-dasharray") ?? "";
    const dashoffset =
      ringPath?.getAttribute("strokeDashoffset") ??
      ringPath?.getAttribute("stroke-dashoffset") ??
      "";
    // Both values should be numeric and equal (fully hidden) , within floating-point tolerance.
    const arr = Number.parseFloat(dasharray);
    const off = Number.parseFloat(dashoffset);
    await expect(Number.isNaN(arr)).toBe(false);
    await expect(Math.abs(off - arr)).toBeLessThan(1);
  },
};

export const Quarter: Story = {
  args: { progress: 0.25 },
  play: async ({ canvasElement }) => {
    const svg = canvasElement.querySelector("svg");
    await expect(svg).not.toBeNull();
    const ringPath = canvasElement.querySelector("[data-ring-path]");
    await expect(ringPath).not.toBeNull();
  },
};

export const Half: Story = {
  args: { progress: 0.5 },
  play: async ({ canvasElement }) => {
    const svg = canvasElement.querySelector("svg");
    await expect(svg).not.toBeNull();
    const ringPath = canvasElement.querySelector("[data-ring-path]");
    await expect(ringPath).not.toBeNull();
    // dashoffset at half-fill should be approximately half the dasharray length.
    const dasharray =
      ringPath?.getAttribute("strokeDasharray") ?? ringPath?.getAttribute("stroke-dasharray") ?? "";
    const dashoffset =
      ringPath?.getAttribute("strokeDashoffset") ??
      ringPath?.getAttribute("stroke-dashoffset") ??
      "";
    const arr = Number.parseFloat(dasharray);
    const off = Number.parseFloat(dashoffset);
    await expect(Math.abs(off - arr / 2)).toBeLessThan(2);
  },
};

export const AlmostFull: Story = {
  args: { progress: 0.99 },
  play: async ({ canvasElement }) => {
    const svg = canvasElement.querySelector("svg");
    await expect(svg).not.toBeNull();
    const ringPath = canvasElement.querySelector("[data-ring-path]");
    await expect(ringPath).not.toBeNull();
  },
};

export const Full: Story = {
  args: { progress: 1 },
  play: async ({ canvasElement }) => {
    const svg = canvasElement.querySelector("svg");
    await expect(svg).not.toBeNull();
    const ringPath = canvasElement.querySelector("[data-ring-path]");
    await expect(ringPath).not.toBeNull();
    // At full progress dashoffset should be 0 , the whole perimeter is filled.
    const dashoffset =
      ringPath?.getAttribute("strokeDashoffset") ??
      ringPath?.getAttribute("stroke-dashoffset") ??
      "1";
    const off = Number.parseFloat(dashoffset);
    await expect(Math.abs(off)).toBeLessThan(1);
  },
};
