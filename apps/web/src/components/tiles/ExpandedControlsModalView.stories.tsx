/**
 * Stories for ExpandedControlsModalView — the expanded controls modal.
 * View-driven (all data + callbacks via props), mirroring ControlsTileView.stories.
 * Play functions double as component-test assertions via addon-vitest.
 *
 * Grouped under "Modals/" (not "Tiles/") since this is an overlay surface, so it
 * falls through the BoardDecorator's tile branch to the plain dark wrapper.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { ControlsViewData } from "./ControlsTileView";
import type { ExpandedControlsModalViewProps } from "./ExpandedControlsModalView";
import { ExpandedControlsModalView } from "./ExpandedControlsModalView";

// ─── fixtures ─────────────────────────────────────────────────────────────────

const allOn: ControlsViewData = {
  lamps: { on: true, sub: "On", pending: false, brightness: 72, activeScene: null },
  lights: { on: true, pending: false },
  fan: { on: true, sub: "Medium", pending: false },
};

const lampsOff: ControlsViewData = {
  lamps: { on: false, pending: false },
  lights: { on: true, pending: false },
  fan: { on: false, pending: false },
};

const blueActive: ControlsViewData = {
  ...allOn,
  lamps: { ...allOn.lamps, activeScene: "blue" },
};

const partyActive: ControlsViewData = {
  ...allOn,
  lamps: { ...allOn.lamps, activeScene: "party" },
};

// ─── meta ─────────────────────────────────────────────────────────────────────

const meta = {
  title: "Modals/ExpandedControls",
  component: ExpandedControlsModalView,
  tags: ["autodocs"],
  args: {
    open: true,
    onClose: fn(),
    data: allOn,
    onToggle: fn(),
    onScene: fn(),
    onBrightness: fn(),
    onParty: fn(),
  },
} satisfies Meta<typeof ExpandedControlsModalView>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Open — all on (interactive) ──────────────────────────────────────────────

// Stateful wrapper so backdrop/Escape/Close actually dismiss in Storybook (the
// default-args story hardcodes open=true + a mock onClose, so dismissal isn't
// visible). A "Reopen" button makes the story replayable after closing.
function InteractiveOpen(args: ExpandedControlsModalViewProps) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <ExpandedControlsModalView
        {...args}
        open={open}
        onClose={() => {
          setOpen(false);
          args.onClose();
        }}
      />
    </>
  );
}

export const Open: Story = {
  name: "Open — all on",
  render: (args) => <InteractiveOpen {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    // Grid toggles are reused, no "More" button inside the modal
    await expect(canvas.getByLabelText("Lamps")).toBeInTheDocument();
    expect(canvas.queryByLabelText("More")).toBeNull();
    // All four scene tiles + Party present, laid out as a 2-col ControlTap grid.
    const sceneGrid = canvas.getByRole("button", { name: "White" }).parentElement as HTMLElement;
    expect(sceneGrid.style.display).toBe("grid");
    expect(sceneGrid.style.gridTemplateColumns).toBe("1fr 1fr");
    for (const name of ["White", "Mood", "Red", "Blue", "Party"]) {
      const tile = canvas.getByRole("button", { name });
      expect(tile).toBeInTheDocument();
      // Each tile carries a ControlTap color swatch so the scene reads at a glance.
      expect(tile.querySelector("[data-swatch]")).not.toBeNull();
    }
    // No scene is active in this fixture → no tile highlighted.
    expect(canvas.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "false");
    // Brightness enabled when lamps on, seeded from data.lamps.brightness (72%).
    const slider = canvas.getByLabelText("Brightness") as HTMLInputElement;
    expect(slider).not.toBeDisabled();
    expect(slider.value).toBe("72");
    expect(canvas.getByText("72%")).toBeInTheDocument();
  },
};

// ─── Lamps off — slider disabled ──────────────────────────────────────────────

export const LampsOff: Story = {
  name: "Lamps off — slider disabled",
  args: { data: lampsOff },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    // HA rejects brightness on an off light, so the slider is a dead control
    await expect(canvas.getByLabelText("Brightness")).toBeDisabled();
    // Party needs a lamp lit — disabled when all lamps are off.
    expect(canvas.getByRole("button", { name: "Party" })).toBeDisabled();
  },
};

// ─── Scene interaction ────────────────────────────────────────────────────────

export const SceneInteraction: Story = {
  name: "Interaction — scene buttons fire onScene",
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "White" }));
    expect(args.onScene).toHaveBeenCalledWith("white");
    await userEvent.click(canvas.getByRole("button", { name: "Mood" }));
    expect(args.onScene).toHaveBeenCalledWith("mood");
    await userEvent.click(canvas.getByRole("button", { name: "Red" }));
    expect(args.onScene).toHaveBeenCalledWith("red");
    await userEvent.click(canvas.getByRole("button", { name: "Blue" }));
    expect(args.onScene).toHaveBeenCalledWith("blue");
  },
};

// ─── Active scene highlight ─────────────────────────────────────────────────

export const BlueActive: Story = {
  name: "Active scene — Blue highlighted",
  args: { data: blueActive },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    // The Blue scene tile is highlighted (on); the others are not.
    await expect(canvas.getByRole("button", { name: "Blue" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const name of ["White", "Mood", "Red", "Party"]) {
      expect(canvas.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  },
};

// ─── Party active ─────────────────────────────────────────────────────────────

export const PartyActive: Story = {
  name: "Party mode active",
  args: { data: partyActive },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const party = canvas.getByRole("button", { name: "Party" });
    // Party tile highlighted; no scene tile is.
    await expect(party).toHaveAttribute("aria-pressed", "true");
    expect(party).not.toBeDisabled();
    for (const name of ["White", "Mood", "Red", "Blue"]) {
      expect(canvas.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
    // Tapping Party fires onParty (toggles party off — wired in CC-7d5b.3.7).
    await userEvent.click(party);
    expect(args.onParty).toHaveBeenCalled();
  },
};

// ─── Brightness interaction ───────────────────────────────────────────────────

export const BrightnessInteraction: Story = {
  name: "Interaction — slider fires onBrightness",
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const slider = canvas.getByLabelText("Brightness") as HTMLInputElement;
    // React tracks the input's value internally; setting .value directly is
    // ignored on the next change event. Use the native setter so React's
    // onChange fires with the new value (standard controlled-input test idiom).
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(slider, "65");
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    // onBrightness is debounced 400ms (trailing edge) — wait for it to fire.
    await waitFor(() => expect(args.onBrightness).toHaveBeenCalledWith(65));
  },
};

// ─── Loading — closed (no content) ────────────────────────────────────────────

export const Loading: Story = {
  name: "Loading — modal closed",
  args: { open: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    // While the underlying query loads the tile keeps the modal closed —
    // nothing renders, no scene buttons leak onto the board.
    expect(canvas.queryByRole("button", { name: "White" })).toBeNull();
    expect(canvas.queryByLabelText("Brightness")).toBeNull();
  },
};

// ─── Error — closed (no content) ──────────────────────────────────────────────

export const ErrorClosed: Story = {
  name: "Error — modal closed",
  args: { open: false, data: lampsOff },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    // On error the tile shows a skeleton and the modal stays closed.
    expect(canvas.queryByRole("button", { name: "Lamps" })).toBeNull();
  },
};
