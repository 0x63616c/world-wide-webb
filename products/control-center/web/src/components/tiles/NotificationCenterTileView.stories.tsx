/**
 * Stories for NotificationCenterTileView , covers loading, error, populated
 * (mixed severities) and the all-caught-up empty state. Play functions double as
 * component-test assertions.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { defineTileMeta } from "./__stories__/factory";
import type {
  NotificationCenterTileViewProps,
  NotificationRow,
} from "./NotificationCenterTileView";
import { NotificationCenterTileView } from "./NotificationCenterTileView";

const rows: NotificationRow[] = [
  {
    id: "notif_ci",
    severity: "critical",
    category: "ci",
    title: "Deploy failed on main",
    age: "3mins",
  },
  {
    id: "notif_home",
    severity: "warning",
    category: "home",
    title: "Front door unlocked for 20 mins",
    age: "21mins",
  },
  {
    id: "notif_media",
    severity: "info",
    category: "media",
    title: "Playlist import finished",
    age: "1hr",
  },
];

const meta = {
  ...defineTileMeta("NotificationCenterTileView", NotificationCenterTileView),
  args: {
    status: "populated",
    data: { unreadCount: 3, rows },
  } as NotificationCenterTileViewProps,
} satisfies Meta<typeof NotificationCenterTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: { status: "loading" } as NotificationCenterTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Notifications")).toBeInTheDocument();
    // No count pill while loading , the tile must not imply "0 unread".
    await expect(canvas.queryByText(/unread/)).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  args: { status: "error", error: "API unreachable" } as NotificationCenterTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Notifications")).toBeInTheDocument();
  },
};

export const Populated: Story = {
  args: {
    status: "populated",
    data: { unreadCount: 3, rows },
  } as NotificationCenterTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("3 new")).toBeInTheDocument();
    await expect(canvas.getByText("Deploy failed on main")).toBeInTheDocument();
    await expect(canvas.getByText("Front door unlocked for 20 mins")).toBeInTheDocument();
    await expect(canvas.getByText("3 unread")).toBeInTheDocument();
  },
};

export const AllCaughtUp: Story = {
  args: {
    status: "populated",
    data: { unreadCount: 0, rows: [] },
  } as NotificationCenterTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("0 new")).toBeInTheDocument();
    await expect(canvas.getByText("All caught up")).toBeInTheDocument();
    await expect(canvas.getByText("Nothing waiting")).toBeInTheDocument();
  },
};

/** A busy panel: the count pill caps at 99+ while the list stays capped at 3. */
export const HighVolume: Story = {
  args: {
    status: "populated",
    data: { unreadCount: 128, rows },
  } as NotificationCenterTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("99+ new")).toBeInTheDocument();
    await expect(canvas.getByText("128 unread")).toBeInTheDocument();
  },
};
