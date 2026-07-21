/**
 * Stories for WeightReadingsView — the Readings variant of the weight detail
 * page: raw measurements newest-first with include/exclude toggles, an
 * auto-flagged sanity-band row, and a same-day pair (time-only second row).
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { modalDocsParameters } from "./__stories__/factory";
import type { WeightReadingRow } from "./WeightReadingsView";
import { WeightReadingsView } from "./WeightReadingsView";

const READINGS: WeightReadingRow[] = [
  {
    id: "wm_01",
    whenLabel: "Today · 7:12 AM",
    showDate: true,
    lb: 180.1,
    deltaLb: 0.4,
    excluded: false,
    auto: false,
  },
  {
    id: "wm_02",
    whenLabel: "Yesterday · 7:31 AM",
    showDate: true,
    lb: 179.7,
    deltaLb: -0.9,
    excluded: false,
    auto: false,
  },
  {
    id: "wm_03",
    whenLabel: "Jul 19 · 9:02 PM",
    showDate: true,
    lb: 213.9,
    deltaLb: null,
    excluded: true,
    auto: true,
  },
  {
    id: "wm_04",
    whenLabel: "7:05 AM",
    showDate: false,
    lb: 180.6,
    deltaLb: 0.7,
    excluded: false,
    auto: false,
  },
  {
    id: "wm_05",
    whenLabel: "Jul 18 · 7:22 AM",
    showDate: true,
    lb: 179.9,
    deltaLb: -0.4,
    excluded: false,
    auto: false,
  },
  {
    id: "wm_06",
    whenLabel: "Jul 16 · 7:44 AM",
    showDate: true,
    lb: 181.0,
    deltaLb: 0.4,
    excluded: false,
    auto: false,
  },
  {
    id: "wm_07",
    whenLabel: "7:41 AM",
    showDate: false,
    lb: 181.1,
    deltaLb: null,
    excluded: true,
    auto: false,
  },
];

const meta = {
  title: "Pages/WeightReadings",
  component: WeightReadingsView,
  tags: ["autodocs"],
  parameters: { ...modalDocsParameters(), boardWrapper: false, layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div
        style={{ height: "100vh", background: "var(--bg)", boxSizing: "border-box", padding: 24 }}
      >
        <Story />
      </div>
    ),
  ],
  args: { onToggle: fn() },
} satisfies Meta<typeof WeightReadingsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  args: { status: "populated", readings: READINGS },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("AUTO-FLAGGED")).toBeInTheDocument();
    expect(canvas.getByText("213.9")).toBeInTheDocument();
    // Same-day repeat renders time-only.
    expect(canvas.getByText("7:41 AM")).toBeInTheDocument();
    // Excluded rows offer Include; included rows offer Exclude.
    expect(canvas.getAllByRole("button", { name: "Include" })).toHaveLength(2);
    const excludeButtons = canvas.getAllByRole("button", { name: "Exclude" });
    expect(excludeButtons.length).toBeGreaterThan(0);
    const firstExclude = excludeButtons[0];
    if (firstExclude) await userEvent.click(firstExclude);
    expect(args.onToggle).toHaveBeenCalledWith("wm_01", true);
  },
};

export const Loading: Story = {
  args: { status: "loading" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.queryByText("AUTO-FLAGGED")).not.toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { status: "populated", readings: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText(/No weigh-ins yet/)).toBeInTheDocument();
  },
};
