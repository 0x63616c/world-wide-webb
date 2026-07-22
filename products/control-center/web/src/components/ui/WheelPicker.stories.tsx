import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { WheelPicker, type WheelPickerValue } from "./WheelPicker";

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 24,
        padding: 24,
        background: "var(--bg, #0c0e11)",
        borderRadius: 12,
      }}
    >
      {children}
    </div>
  );
}

const HOURS: WheelPickerValue<string>[] = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: String(h),
}));

const MINUTES: WheelPickerValue<string>[] = Array.from({ length: 60 }, (_, m) => ({
  value: String(m),
  label: String(m).padStart(2, "0"),
}));

const meta = {
  title: "UI/WheelPicker",
  component: WheelPicker,
  tags: ["autodocs"],
  args: {
    values: HOURS,
    value: "8",
    onChange: fn(),
    label: "Hours",
  },
  decorators: [
    (Story) => (
      <Cell>
        <Story />
      </Cell>
    ),
  ],
} satisfies Meta<typeof WheelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Hours: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("listbox", { name: "Hours" })).toBeInTheDocument();
    const selected = canvas.getByRole("option", { selected: true });
    await expect(selected).toHaveTextContent("8");
  },
};

export const Minutes: Story = {
  args: {
    values: MINUTES,
    value: "30",
    label: "Minutes",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const selected = canvas.getByRole("option", { selected: true });
    await expect(selected).toHaveTextContent("30");
  },
};

// Tap-to-select: every row is a 44px button, so a direct tap commits without
// scrolling.
export const TapSelects: Story = {
  args: { value: "8" },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("option", { name: "12" }));
    await expect(args.onChange).toHaveBeenCalledWith("12");
  },
};
