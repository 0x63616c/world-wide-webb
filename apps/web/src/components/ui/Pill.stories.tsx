import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Pill, PillTone } from "./Pill";

function Cell({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "inline-flex", padding: 16 }}>{children}</div>;
}

const meta = {
  title: "UI/Pill",
  component: Pill,
  tags: ["autodocs"],
  args: {
    children: "Label",
    tone: PillTone.Default,
  },
  decorators: [
    (Story) => (
      <Cell>
        <Story />
      </Cell>
    ),
  ],
} satisfies Meta<typeof Pill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { tone: PillTone.Default, children: "Default" },
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByText("Default");
    await expect(pill).toBeInTheDocument();
    await expect(pill.classList.contains("pill")).toBe(true);
    // Default tone: class should be exactly "pill" with no extra tone modifier.
    await expect(pill.className.trim()).toBe("pill");
  },
};

export const On: Story = {
  args: { tone: PillTone.On, children: "On" },
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByText("On");
    await expect(pill).toBeInTheDocument();
    await expect(pill.classList.contains("pill")).toBe(true);
    await expect(pill.classList.contains("on")).toBe(true);
  },
};

export const Amber: Story = {
  args: { tone: PillTone.Amber, children: "Amber" },
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByText("Amber");
    await expect(pill).toBeInTheDocument();
    await expect(pill.classList.contains("pill")).toBe(true);
    await expect(pill.classList.contains("amber")).toBe(true);
  },
};
