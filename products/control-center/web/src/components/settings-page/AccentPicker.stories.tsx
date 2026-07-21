import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { type Accent, applyAccent } from "../../lib/accent";
import { AccentPicker } from "./AccentPicker";

function Cell({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "inline-flex", padding: 16 }}>{children}</div>;
}

const meta = {
  title: "Settings/AccentPicker",
  component: AccentPicker,
  tags: ["autodocs"],
  args: { value: "blue", onChange: fn() },
  decorators: [
    (Story) => (
      <Cell>
        <Story />
      </Cell>
    ),
  ],
} satisfies Meta<typeof AccentPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Blue: Story = {
  args: { value: "blue" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("radio", { name: "Blue" })).toBeChecked();
    await expect(within(canvasElement).getByRole("radio", { name: "Green" })).not.toBeChecked();
  },
};

export const Green: Story = { args: { value: "green" } };
export const Orange: Story = { args: { value: "orange" } };
export const White: Story = { args: { value: "white" } };

export const Picks: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("radio", { name: "Orange" }));
    await expect(args.onChange).toHaveBeenCalledWith("orange");
  },
};

/**
 * The picker driving REAL tokens: selecting a swatch applies the accent to
 * :root, so the sample chips below it (which only reference `--acc*`) recolour.
 * This is the story that proves the whole chain, not just the control.
 */
function Live() {
  const [accent, setAccent] = useState<Accent>("blue");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AccentPicker
        value={accent}
        onChange={(next) => {
          setAccent(next);
          applyAccent(document.documentElement, next);
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="pill on">Accent pill</span>
        <span className="dot" />
        <span className="cap acc">Caption</span>
        <span
          style={{
            width: 90,
            height: 26,
            borderRadius: 8,
            border: "1px solid var(--acc-line)",
            background: "var(--acc-dim)",
            boxShadow: "var(--acc-glow)",
          }}
        />
      </div>
    </div>
  );
}

export const LiveTokens: Story = {
  render: () => <Live />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("radio", { name: "Green" }));
    await expect(document.documentElement.dataset.accent).toBe("green");
    await expect(document.documentElement.style.getPropertyValue("--acc")).toBe("#0ac57f");
  },
};
