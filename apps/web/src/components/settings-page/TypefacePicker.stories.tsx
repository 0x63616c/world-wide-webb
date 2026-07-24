import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { applyTypeface, type Typeface } from "../../lib/typeface";
import { Stat } from "../ui/Stat";
import { TileHeader } from "../ui/TileHeader";
import { TypefacePicker } from "./TypefacePicker";

function Cell({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 16, width: 560, fontFamily: "var(--ui)" }}>{children}</div>;
}

const meta = {
  title: "Settings/TypefacePicker",
  component: TypefacePicker,
  tags: ["autodocs"],
  args: { value: "grotesk", onChange: fn() },
  decorators: [
    (Story) => (
      <Cell>
        <Story />
      </Cell>
    ),
  ],
} satisfies Meta<typeof TypefacePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Grotesk: Story = {
  args: { value: "grotesk" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("radio", { name: "Space Grotesk with Space Mono" }),
    ).toBeChecked();
    await expect(canvas.getByRole("radio", { name: "Geist with Geist Mono" })).not.toBeChecked();
  },
};

export const Sf: Story = { args: { value: "sf" } };
export const Geist: Story = { args: { value: "geist" } };

export const Picks: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("radio", { name: "Geist with Geist Mono" }),
    );
    await expect(args.onChange).toHaveBeenCalledWith("geist");
  },
};

/**
 * The picker driving REAL tokens , the story that proves the chain rather than
 * the control. Picking a pair sets `data-typeface` on :root, and the sample tile
 * below re-renders through it: TileHeader reads `--w-title` / `--track-title`
 * and Stat reads `--w-hero` + `--mono`, so the header weight and the numeral
 * face both move with the choice without either component knowing a family name.
 */
function Live() {
  const [typeface, setTypeface] = useState<Typeface>("grotesk");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <TypefacePicker
        value={typeface}
        onChange={(next) => {
          setTypeface(next);
          applyTypeface(document.documentElement, next);
        }}
      />
      <div
        style={{
          background: "var(--tile)",
          border: "1px solid var(--hair)",
          borderRadius: "var(--r)",
          padding: 18,
        }}
      >
        <TileHeader icon="car" title="Tesla" />
        <div style={{ display: "flex", gap: 28 }}>
          <Stat label="RANGE" value="237 mi" />
          <Stat label="ODOMETER" value="38,957" />
          <Stat label="CABIN" value="78°F" />
        </div>
      </div>
    </div>
  );
}

export const LiveTokens: Story = {
  render: () => <Live />,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("radio", { name: "SF Pro with SF Mono" }),
    );
    await expect(document.documentElement.dataset.typeface).toBe("sf");
    // The profile is CSS, not inline style, so assert what the cascade RESOLVED
    // , that is the part that would break if a profile block went missing.
    const title = within(canvasElement).getByText("Tesla");
    await expect(getComputedStyle(title).fontWeight).toBe("700");
  },
};
