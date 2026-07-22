/**
 * Stories for WeightReadingsView — one collapsible row per recorded day
 * carrying that day's median and its change against the previous day, expanding
 * to the raw readings behind it.
 *
 * The multi-day fixture is invented (real history is only days old); it exists
 * so grouping, a long scroll, single-reading days, gaps between days and an
 * auto-flagged outlier can all be seen at once.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { modalDocsParameters } from "./__stories__/factory";
import type { WeightReadingDay, WeightReadingRow } from "./WeightReadingsView";
import { WeightReadingsView } from "./WeightReadingsView";

/** Today's four rows are the real ones recorded on 2026-07-22. */
const TODAY: WeightReadingDay = {
  key: "2026-07-22",
  label: "Today",
  medianLb: 160.6,
  dayDeltaLb: -0.5,
  readings: [
    { id: "wm_01", timeLabel: "11:43 AM", lb: 160.2, deltaLb: -0.2, excluded: false, auto: false },
    { id: "wm_02", timeLabel: "11:12 AM", lb: 160.4, deltaLb: -0.4, excluded: false, auto: false },
    { id: "wm_03", timeLabel: "10:55 AM", lb: 160.8, deltaLb: -0.1, excluded: false, auto: false },
    { id: "wm_04", timeLabel: "9:30 AM", lb: 160.9, deltaLb: null, excluded: false, auto: false },
  ],
};

// Labelled day paired with its calendar key. Jul 15 and Jul 10 are missing on
// purpose: the list must read correctly when weigh-ins skip days.
const DAY_LABELS: [label: string, key: string][] = [
  ["Yesterday", "2026-07-21"],
  ["Mon Jul 20", "2026-07-20"],
  ["Sun Jul 19", "2026-07-19"],
  ["Sat Jul 18", "2026-07-18"],
  ["Fri Jul 17", "2026-07-17"],
  ["Thu Jul 16", "2026-07-16"],
  ["Tue Jul 14", "2026-07-14"],
  ["Mon Jul 13", "2026-07-13"],
  ["Sun Jul 12", "2026-07-12"],
  ["Sat Jul 11", "2026-07-11"],
  ["Thu Jul 9", "2026-07-09"],
  ["Wed Jul 8", "2026-07-08"],
  ["Tue Jul 7", "2026-07-07"],
];

/** Deterministic drift so the fixture is stable across renders and snapshots. */
function inventedHistory(): WeightReadingDay[] {
  return DAY_LABELS.map(([label, key], i) => {
    // Older days trend heavier, with a wobble so some days go the wrong way.
    const median = 161.1 + i * 0.22 + (i % 3 === 1 ? 0.4 : 0);
    const prev = 161.1 + (i + 1) * 0.22 + ((i + 1) % 3 === 1 ? 0.4 : 0);
    const perDay = (i % 4) + 1;
    // Built oldest-first so each delta can be measured against the reading
    // before it, then reversed into the newest-first order the view expects.
    const oldestFirst = Array.from({ length: perDay }, (_, r) => ({
      id: `wm_h${i}_${r}`,
      timeLabel: ["7:12 AM", "8:40 AM", "1:20 PM", "8:05 PM"][r] ?? "7:12 AM",
      lb: Number((median + (r - (perDay - 1) / 2) * 0.3).toFixed(1)),
    }));
    const readings: WeightReadingRow[] = oldestFirst
      .map((r, n) => {
        const prev = oldestFirst[n - 1];
        return {
          ...r,
          // The oldest reading of the day has nothing before it.
          deltaLb: prev ? Number((r.lb - prev.lb).toFixed(1)) : null,
          excluded: false,
          auto: false,
        };
      })
      .reverse();
    return {
      key,
      label,
      medianLb: Number(median.toFixed(1)),
      dayDeltaLb: Number((median - prev).toFixed(1)),
      readings,
    };
  });
}

const HISTORY = inventedHistory();

// A guest stepped on the scale — the sanity band caught it.
const OUTLIER_DAY = HISTORY[2];
if (OUTLIER_DAY) {
  OUTLIER_DAY.readings = [
    {
      id: "wm_outlier",
      timeLabel: "8:15 AM",
      lb: 174.8,
      deltaLb: null,
      excluded: true,
      auto: true,
    },
    ...OUTLIER_DAY.readings,
  ];
}

const DAYS: WeightReadingDay[] = [TODAY, ...HISTORY];

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
  args: { onToggle: fn(), onDelete: fn() },
} satisfies Meta<typeof WeightReadingsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  args: { status: "populated", days: DAYS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Days are collapsed by default: the medians show, the readings do not.
    expect(canvas.getByText("160.6")).toBeInTheDocument();
    expect(canvas.queryByText("11:43 AM")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: /Today/ }));
    expect(canvas.getByText("11:43 AM")).toBeInTheDocument();
  },
};

/** Expanding a day reveals its readings and their per-row actions. */
export const DayExpanded: Story = {
  args: { status: "populated", days: DAYS },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Today/ }));

    // Deleting is gated behind a confirm, and only fires once confirmed.
    await userEvent.click(canvas.getByRole("button", { name: "Actions for the 11:43 AM reading" }));
    await userEvent.click(canvas.getByRole("menuitem", { name: "Delete" }));
    expect(args.onDelete).not.toHaveBeenCalled();
    await userEvent.click(await within(document.body).findByRole("button", { name: "Delete" }));
    expect(args.onDelete).toHaveBeenCalledWith("wm_01");
  },
};

/** An auto-flagged reading is the only one that offers to be counted again. */
export const AutoFlagged: Story = {
  args: { status: "populated", days: DAYS },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Sun Jul 19/ }));
    expect(canvas.getByText("AUTO-FLAGGED")).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Actions for the 8:15 AM reading" }));
    await userEvent.click(canvas.getByRole("menuitem", { name: "Count this reading" }));
    expect(args.onToggle).toHaveBeenCalledWith("wm_outlier", false);
  },
};

/** Day one: a single day, so there is nothing to compare it against. */
export const SingleDay: Story = {
  args: { status: "populated", days: [{ ...TODAY, dayDeltaLb: null }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Today")).toBeInTheDocument();
    expect(canvas.queryByText("−0.5")).not.toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: { status: "loading" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.queryByText("160.6")).not.toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { status: "populated", days: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText(/No weigh-ins yet/)).toBeInTheDocument();
  },
};
