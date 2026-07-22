import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { DatePicker } from "./DatePicker";

// Fixed reference so the grid + presets render deterministically: Sun Jul 12 2026.
const REF = new Date(2026, 6, 12);

function Cell({ children }: { children: React.ReactNode }) {
  return <div style={{ width: 480, padding: 16 }}>{children}</div>;
}

const meta = {
  title: "UI/DatePicker",
  component: DatePicker,
  tags: ["autodocs"],
  args: {
    label: "Event date",
    value: REF,
    referenceDate: REF,
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <Cell>
        <Story />
      </Cell>
    ),
  ],
} satisfies Meta<typeof DatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const selected = canvas.getByRole("button", { name: new Date(2026, 6, 12).toDateString() });
    await expect(selected).toHaveAttribute("aria-pressed", "true");
  },
};

export const Empty: Story = {
  args: { value: null },
};

// Live variant so clicks + presets actually move the selection.
function Controlled() {
  const [value, setValue] = useState<Date | null>(REF);
  return <DatePicker label="Event date" value={value} onChange={setValue} referenceDate={REF} />;
}

export const Interactive: Story = {
  render: () => <Controlled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Preset jumps selection to Jul 13 (tomorrow).
    await userEvent.click(canvas.getByRole("button", { name: "Tomorrow" }));
    const tomorrow = canvas.getByRole("button", { name: new Date(2026, 6, 13).toDateString() });
    await expect(tomorrow).toHaveAttribute("aria-pressed", "true");
    // Direct day click also selects.
    await userEvent.click(
      canvas.getByRole("button", { name: new Date(2026, 6, 20).toDateString() }),
    );
    await expect(
      canvas.getByRole("button", { name: new Date(2026, 6, 20).toDateString() }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};
