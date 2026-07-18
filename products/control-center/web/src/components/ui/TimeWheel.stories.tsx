/**
 * Stories for TimeWheel , the touch-first two-column time picker. Play functions
 * double as component tests: tapping a row selects that value and fires onChange.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { type TimeValue, TimeWheel } from "./TimeWheel";

function Cell({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 24, background: "var(--tile)" }}>{children}</div>;
}

const meta = {
  title: "UI/TimeWheel",
  component: TimeWheel,
  tags: ["autodocs"],
  args: {
    value: { h: 7, m: 0 },
    onChange: fn(),
    minuteStep: 5,
  },
  decorators: [
    (Story) => (
      <Cell>
        <Story />
      </Cell>
    ),
  ],
} satisfies Meta<typeof TimeWheel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("listbox", { name: "Hours" })).toBeInTheDocument();
    await expect(canvas.getByRole("listbox", { name: "Minutes" })).toBeInTheDocument();
    // The controlled value 07:00 is the selected option in each column.
    await expect(canvas.getByRole("option", { name: "Hours 07" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(canvas.getByRole("option", { name: "Minutes 00" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
};

/** Every minute selectable , the granularity used to replace a free-text field. */
export const EveryMinute: Story = {
  args: { value: { h: 21, m: 37 }, minuteStep: 1 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("option", { name: "Minutes 37" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
};

// Live variant so tapping a row moves the selection , exercises the full loop.
function Controlled() {
  const [value, setValue] = useState<TimeValue>({ h: 7, m: 0 });
  return (
    <>
      <div data-testid="readout">
        {String(value.h).padStart(2, "0")}:{String(value.m).padStart(2, "0")}
      </div>
      <TimeWheel value={value} onChange={setValue} minuteStep={5} />
    </>
  );
}

export const TapToSelect: Story = {
  render: () => <Controlled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("readout")).toHaveTextContent("07:00");
    await userEvent.click(canvas.getByRole("option", { name: "Hours 09" }));
    await expect(canvas.getByTestId("readout")).toHaveTextContent("09:00");
    await userEvent.click(canvas.getByRole("option", { name: "Minutes 30" }));
    await expect(canvas.getByTestId("readout")).toHaveTextContent("09:30");
    await expect(canvas.getByRole("option", { name: "Minutes 30" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
};
