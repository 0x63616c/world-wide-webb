/**
 * Stories for the three party-speed widgets (www-7d5b.3.7 spike). Each story is
 * interactive (local useState) so Calum can feel the segmented / slider / cycle
 * affordances side by side and pick a winner. Props-only — no trpc.
 *
 * The "AllThree" story stacks all three sharing one value so they stay in sync
 * as you drive any of them — the head-to-head comparison view.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import type { PartySelection } from "./PartySpeedControls";
import {
  PartyControl,
  PartySpeed,
  PartySpeedCycle,
  PartySpeedSegmented,
  PartySpeedSlider,
} from "./PartySpeedControls";

// Modal-width panel so the widgets sit at their real footprint on the 1366×1024
// board's controls modal (not full-bleed in the Storybook canvas).
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 360,
        padding: 24,
        borderRadius: 18,
        background: "var(--tile)",
        border: "1px solid var(--hair)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="cap">{children}</span>;
}

const meta = {
  title: "Modals/PartySpeedControls",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// The shipping control: full-width Off / Slow / Med / Fast in one row. "off" stops
// party, a speed starts/re-speeds it. Tap any segment to drive it interactively.
export const Party: Story = {
  render: () => {
    const [value, setValue] = useState<PartySelection>("off");
    return (
      <Panel>
        <Label>Party</Label>
        <PartyControl value={value} onSelect={setValue} />
      </Panel>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("tab", { name: "Off" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(canvas.getByRole("tab", { name: "Fast" }));
    await expect(canvas.getByRole("tab", { name: "Fast" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
};

// Disabled (lamps off): dimmed + non-interactive.
export const PartyDisabled: Story = {
  render: () => (
    <Panel>
      <Label>Party (lamps off)</Label>
      <PartyControl value="off" onSelect={() => {}} disabled />
    </Panel>
  ),
};

export const Segmented: Story = {
  render: () => {
    const [speed, setSpeed] = useState<PartySpeed>(PartySpeed.Medium);
    return (
      <Panel>
        <Label>Segmented</Label>
        <PartySpeedSegmented value={speed} onChange={setSpeed} />
      </Panel>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("tab", { name: "Fast" }));
    await expect(canvas.getByRole("tab", { name: "Fast" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
};

export const Slider: Story = {
  render: () => {
    const [speed, setSpeed] = useState<PartySpeed>(PartySpeed.Slow);
    return (
      <Panel>
        <Label>Slider</Label>
        <PartySpeedSlider value={speed} onChange={setSpeed} />
      </Panel>
    );
  },
};

export const Cycle: Story = {
  render: () => {
    const [speed, setSpeed] = useState<PartySpeed>(PartySpeed.Slow);
    return (
      <Panel>
        <Label>Tap to cycle</Label>
        <PartySpeedCycle value={speed} onChange={setSpeed} />
      </Panel>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const btn = canvas.getByRole("button", { name: "Party speed: Slow" });
    await expect(within(btn).getByText("Slow")).toBeInTheDocument();
    await userEvent.click(btn);
    // Accessible name + visible label both track the new speed after the cycle.
    await expect(canvas.getByRole("button", { name: "Party speed: Med" })).toBeInTheDocument();
  },
};

// Head-to-head: all three share one value so driving any one updates the others.
export const AllThree: Story = {
  render: () => {
    const [speed, setSpeed] = useState<PartySpeed>(PartySpeed.Medium);
    return (
      <Panel>
        <Label>Segmented</Label>
        <PartySpeedSegmented value={speed} onChange={setSpeed} />
        <Label>Slider</Label>
        <PartySpeedSlider value={speed} onChange={setSpeed} />
        <Label>Tap to cycle</Label>
        <PartySpeedCycle value={speed} onChange={setSpeed} />
      </Panel>
    );
  },
};

// Disabled (party off / no lamps): all three dimmed + non-interactive.
export const Disabled: Story = {
  render: () => (
    <Panel>
      <Label>Segmented</Label>
      <PartySpeedSegmented value={PartySpeed.Medium} onChange={() => {}} disabled />
      <Label>Slider</Label>
      <PartySpeedSlider value={PartySpeed.Medium} onChange={() => {}} disabled />
      <Label>Tap to cycle</Label>
      <PartySpeedCycle value={PartySpeed.Medium} onChange={() => {}} disabled />
    </Panel>
  ),
};
