import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Stat } from "./Stat";

const meta = {
  title: "UI/Stat",
  component: Stat,
  tags: ["autodocs"],
  args: {
    label: "Temperature",
    value: "72°",
  },
  decorators: [
    (Story) => (
      <div style={{ padding: 16, background: "var(--tile-1, #111)", borderRadius: 12 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Stat>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default: plain label + value, no color modifier.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Temperature")).toBeInTheDocument();
    await expect(canvas.getByText("72°")).toBeInTheDocument();
    const valueEl = canvasElement.querySelector("[data-stat-value]");
    await expect(valueEl).not.toBeNull();
  },
};

// Accent: value rendered in accent color (var(--acc)).
export const Accent: Story = {
  args: { label: "Status", value: "Active", accent: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Status")).toBeInTheDocument();
    await expect(canvas.getByText("Active")).toBeInTheDocument();
    const valueEl = canvasElement.querySelector("[data-stat-value]");
    await expect(valueEl).not.toBeNull();
  },
};

// Muted: value rendered in muted gray (inactive/idle state).
export const Muted: Story = {
  args: { label: "Humidity", value: ",", muted: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Humidity")).toBeInTheDocument();
    await expect(canvas.getByText(",")).toBeInTheDocument();
    const valueEl = canvasElement.querySelector("[data-stat-value]");
    await expect(valueEl).not.toBeNull();
  },
};

// WithSub: value + a smaller sub-label beneath it.
export const WithSub: Story = {
  args: { label: "Wind", value: "8 mph", sub: "NW gusts 12" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Wind")).toBeInTheDocument();
    await expect(canvas.getByText("8 mph")).toBeInTheDocument();
    await expect(canvas.getByText("NW gusts 12")).toBeInTheDocument();
    const valueEl = canvasElement.querySelector("[data-stat-value]");
    await expect(valueEl).not.toBeNull();
  },
};
