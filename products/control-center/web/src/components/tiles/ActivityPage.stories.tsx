/**
 * Stories for ActivityPage , the full-page overlay behind the Activity tile.
 * It portals to document.body, so plays query `within(...body)`. Photos are
 * inline-SVG data URIs , no network, deterministic frames.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { log } from "../../lib/log/logger";
import { modalDocsParameters } from "./__stories__/factory";
import type { WakePhotoDay } from "./ActivityPage";
import { ActivityPage } from "./ActivityPage";

function svgPhoto(hue: number): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 75'><rect width='100' height='75' fill='hsl(${hue} 12% 18%)'/><circle cx='50' cy='30' r='10' fill='hsl(${hue} 12% 8%)'/><path d='M30 75 Q35 45 50 44 Q65 45 70 75 Z' fill='hsl(${hue} 12% 8%)'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const PHOTO_URLS = new Map<string, string>();

function day(dayStr: string, base: number, count: number): WakePhotoDay {
  const photos = Array.from({ length: count }, (_, i) => {
    const capturedAt = base + i * 47 * 60_000;
    const path = `${dayStr.replaceAll("-", "/")}/${capturedAt}-0.jpg`;
    PHOTO_URLS.set(path, svgPhoto((i * 47) % 360));
    return { path, capturedAt };
  });
  photos.sort((a, b) => b.capturedAt - a.capturedAt);
  return { day: dayStr, photos };
}

const DAYS: WakePhotoDay[] = [
  day("2026-07-17", Date.UTC(2026, 6, 17, 6, 58), 12),
  day("2026-07-16", Date.UTC(2026, 6, 16, 7, 12), 18),
  day("2026-07-15", Date.UTC(2026, 6, 15, 8, 3), 9),
];

const photoUrl = (path: string) => PHOTO_URLS.get(path) ?? svgPhoto(0);

// A visit derived from the interaction log, pointing at the same deterministic
// SVG frames the photo grid uses.
const SESSION_START = Date.UTC(2026, 6, 17, 19, 4, 2);
const SESSIONS = [
  {
    id: "isn_9f3ac1d2e4b5",
    startedAt: SESSION_START,
    endedAt: SESSION_START + 134_000,
    durationMs: 134_000,
    eventCount: 4,
    endReason: "idle-dim",
    deviceName: "wall-panel",
    photoPaths: [...(DAYS[0]?.photos.slice(0, 2).map((p) => p.path) ?? [])],
    digest: "Climate · Desk lamp · Settings",
  },
];

const meta = {
  title: "Pages/ActivityPage",
  component: ActivityPage,
  tags: ["autodocs"],
  parameters: modalDocsParameters(),
  args: {
    sessions: SESSIONS,
    selectedSession: null,
    onSelectSession: fn(),
  },
} satisfies Meta<typeof ActivityPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Grid: Story = {
  args: {
    open: true,
    onClose: fn(),
    days: DAYS,
    totalCount: 39,
    totalBytes: 6_400_000,
    photoUrl,
  },
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    const body = within(doc.body);
    await expect(body.getByText(/39 photos/)).toBeInTheDocument();
    await expect(body.getByText(/2026-07-17 · 12 wakes/)).toBeInTheDocument();

    // Task 3: the mode header is pinned OUTSIDE the single scroller (a sibling,
    // not a child), so scrolling the grid to the bottom must not scroll the
    // Segmented control away , it stays in the DOM and visible.
    const scroller = body.getByTestId("activity-scroll");
    scroller.scrollTop = scroller.scrollHeight;
    await expect(body.getByRole("radio", { name: "Grid" })).toBeInTheDocument();
  },
};

export const Timelapse: Story = {
  args: {
    ...Grid.args,
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole("radio", { name: "Timelapse" }));
    await waitFor(() => expect(body.getByLabelText("Scrub timelapse")).toBeInTheDocument());
    await expect(body.getByLabelText("Pause timelapse")).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: {
    open: true,
    onClose: fn(),
    days: [],
    totalCount: 0,
    totalBytes: 0,
    photoUrl,
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByText(/No activity photos yet/)).toBeInTheDocument();
  },
};

/**
 * The empty state becomes self-diagnosing: when the panel has logged a failed
 * wake capture, the reason is surfaced under the "no photos" copy so the wall
 * explains itself. Emits a REAL `wake`-source log line (not fake product data),
 * exactly what the capture chain logs when the camera is denied.
 */
export const EmptyWithDiagnostic: Story = {
  args: {
    open: true,
    onClose: fn(),
    days: [],
    totalCount: 0,
    totalBytes: 0,
    photoUrl,
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    log.child("wake").warn("camera open failed", { name: "NotAllowedError", message: "denied" });
    await waitFor(() =>
      expect(body.getByTestId("wake-diagnostic")).toHaveTextContent(
        "camera open failed (NotAllowedError)",
      ),
    );
  },
};

export const Sessions: Story = {
  args: {
    open: true,
    onClose: fn(),
    days: DAYS,
    totalCount: 39,
    totalBytes: 6_400_000,
    photoUrl,
  },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole("radio", { name: "Sessions" }));
    await waitFor(() => expect(body.getAllByTestId("session-row")).toHaveLength(1));
    await userEvent.click(body.getAllByTestId("session-row")[0]);
    await expect(args.onSelectSession).toHaveBeenCalledWith("isn_9f3ac1d2e4b5");
  },
};
