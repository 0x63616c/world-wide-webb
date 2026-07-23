/**
 * Stories for ActivityPage , the bare page body behind the Activity tile
 * (hosted by TileDetailHost in the app). Stories mount it inside a page-sized
 * container matching the host's content region , the body fills that region
 * (height:100%) so its pinned mode header + single scroller behave as on the
 * panel. Photos are inline-SVG data URIs , no network, deterministic frames.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { modalDocsParameters } from "@/components/tiles/__stories__/factory";
import { log } from "@/lib/log/logger";
import type { WakePhotoDay } from "./ActivityPage";
import { ActivityPage } from "./ActivityPage";

function svgPhoto(hue: number): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 75'><rect width='100' height='75' fill='hsl(${hue} 12% 18%)'/><circle cx='50' cy='30' r='10' fill='hsl(${hue} 12% 8%)'/><path d='M30 75 Q35 45 50 44 Q65 45 70 75 Z' fill='hsl(${hue} 12% 8%)'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const PHOTO_URLS = new Map<string, string>();

const SESSION_ID = "isn_9f3ac1d2e4b5";

/**
 * `interactionSessionId` null models backfilled history , frames that predate
 * the session table and so have no visit to open. The grid renders those
 * dimmed and inert, which the BackfilledUnopenable story asserts.
 */
function day(
  dayStr: string,
  base: number,
  count: number,
  interactionSessionId: string | null,
): WakePhotoDay {
  const photos = Array.from({ length: count }, (_, i) => {
    const capturedAt = base + i * 47 * 60_000;
    const path = `${dayStr.replaceAll("-", "/")}/${capturedAt}-0.jpg`;
    PHOTO_URLS.set(path, svgPhoto((i * 47) % 360));
    return { path, capturedAt, interactionSessionId };
  });
  photos.sort((a, b) => b.capturedAt - a.capturedAt);
  return { day: dayStr, photos };
}

const DAYS: WakePhotoDay[] = [
  day("2026-07-17", Date.UTC(2026, 6, 17, 6, 58), 12, SESSION_ID),
  day("2026-07-16", Date.UTC(2026, 6, 16, 7, 12), 18, SESSION_ID),
  // Oldest day predates the session table , unopenable.
  day("2026-07-15", Date.UTC(2026, 6, 15, 8, 3), 9, null),
];

const photoUrl = (path: string) => PHOTO_URLS.get(path) ?? svgPhoto(0);

// A visit derived from the interaction log, pointing at the same deterministic
// SVG frames the photo grid uses.
const SESSION_START = Date.UTC(2026, 6, 17, 19, 4, 2);
const SESSIONS = [
  {
    id: SESSION_ID,
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
  title: "Pages/Activity",
  component: ActivityPage,
  tags: ["autodocs"],
  parameters: { ...modalDocsParameters(), boardWrapper: false, layout: "fullscreen" },
  // Page-sized container standing in for the TileDetailHost full-bleed region ,
  // fixed height because the body fills it (height:100%) to pin its header. No
  // padding: the page is full-bleed and owns its own chrome, so the grid must
  // reach the container's edges here exactly as it does on the panel.
  decorators: [
    (Story) => (
      <div style={{ height: "100vh", background: "var(--bg)", boxSizing: "border-box" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    sessions: SESSIONS,
    selectedSession: null,
    onSelectSession: fn(),
    onBack: fn(),
  },
} satisfies Meta<typeof ActivityPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Grid: Story = {
  args: {
    days: DAYS,
    totalCount: 39,
    totalBytes: 6_400_000,
    photoUrl,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/39 photos/)).toBeInTheDocument();
    // Days are bucketed by LOCAL day and labelled like the booth's, so the
    // heading is a short date (these fixtures are older than yesterday) with a
    // bare count beside it , never the raw UTC "2026-07-17" the listing carries.
    // Matched loosely: the exact order of day/month is the runner's locale.
    await expect(canvas.getByRole("heading", { name: /Jul.*17|17.*Jul/ })).toBeInTheDocument();
    await expect(canvas.queryByText(/2026-07-17/)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/wakes/)).not.toBeInTheDocument();

    // The mode header is pinned OUTSIDE the single scroller (a sibling, not a
    // child), so scrolling the grid to the bottom must not scroll the
    // Segmented control away , it stays in the DOM and visible.
    const scroller = canvas.getByTestId("activity-scroll");
    scroller.scrollTop = scroller.scrollHeight;
    await expect(canvas.getByRole("radio", { name: "Grid" })).toBeInTheDocument();
  },
};

// Local midnight for an instant , mirrors group-by-day.ts's own startOfDay so
// this fixture and the component agree on where "today" starts.
function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Clamped to [local midnight + 1min, now]: a plain `Date.now() - Nms` offset
// crosses into "yesterday" whenever the suite runs within N ms of local
// midnight (CI runs in UTC, so this bit within the first ~2h of every UTC
// day), flaking a story whose whole point is asserting "Today". Clamping
// keeps it inside today's bucket at any run time without faking the clock.
function todayInstant(msAgo: number): number {
  return Math.max(Date.now() - msAgo, startOfLocalDay(Date.now()) + 60_000);
}

/**
 * Regression: headings come from each frame's own capture instant, never the
 * listing's `day` string. The API buckets on the UTC calendar date, so an
 * evening capture west of Greenwich arrived filed under the NEXT day while its
 * timestamp still read like the previous evening. Here the server bucket is
 * deliberately absurd ("1999-01-01") over photos captured today , the grid must
 * ignore it and say "Today".
 */
export const IgnoresServerUtcBucket: Story = {
  args: {
    days: [
      {
        day: "1999-01-01",
        photos: [
          { path: "a.jpg", capturedAt: todayInstant(3_600_000), interactionSessionId: SESSION_ID },
          { path: "b.jpg", capturedAt: todayInstant(7_200_000), interactionSessionId: SESSION_ID },
        ],
      },
    ],
    totalCount: 2,
    totalBytes: 400_000,
    photoUrl,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: /Today/ })).toBeInTheDocument();
    await expect(canvas.queryByText(/1999/)).not.toBeInTheDocument();
  },
};

/**
 * The point of the gallery: a wake photo is a way into the visit it came from,
 * so tapping one selects its session and switches to the Sessions mode rather
 * than opening a lightbox.
 */
export const PhotoOpensSession: Story = {
  args: { ...Grid.args },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const [cell] = canvas.getAllByRole("button", { name: /Open session from/ });
    await userEvent.click(cell);
    await expect(args.onSelectSession).toHaveBeenCalledWith(SESSION_ID);
    await waitFor(() => expect(canvas.getByRole("radio", { name: "Sessions" })).toBeChecked());
  },
};

/**
 * Backfilled frames have no session to open. They render dimmed and disabled
 * rather than absorbing a tap that silently does nothing.
 */
export const BackfilledUnopenable: Story = {
  // Its own spy , the meta-level fn() instance is shared across composed
  // stories, so a sibling's click would otherwise count against this one.
  args: { ...Grid.args, onSelectSession: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const inert = canvas.getAllByRole("button", { name: /^Wake at/ });
    await expect(inert.length).toBeGreaterThan(0);
    await expect(inert[0]).toBeDisabled();
    await userEvent.click(inert[0]);
    await expect(args.onSelectSession).not.toHaveBeenCalled();
  },
};

export const Empty: Story = {
  args: {
    days: [],
    totalCount: 0,
    totalBytes: 0,
    photoUrl,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/No activity photos yet/)).toBeInTheDocument();
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
    days: [],
    totalCount: 0,
    totalBytes: 0,
    photoUrl,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    log.child("wake").warn("camera open failed", { name: "NotAllowedError", message: "denied" });
    await waitFor(() =>
      expect(canvas.getByTestId("wake-diagnostic")).toHaveTextContent(
        "camera open failed (NotAllowedError)",
      ),
    );
  },
};

export const Sessions: Story = {
  args: {
    days: DAYS,
    totalCount: 39,
    totalBytes: 6_400_000,
    photoUrl,
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("radio", { name: "Sessions" }));
    await waitFor(() => expect(canvas.getAllByTestId("session-row")).toHaveLength(1));
    await userEvent.click(canvas.getAllByTestId("session-row")[0]);
    await expect(args.onSelectSession).toHaveBeenCalledWith("isn_9f3ac1d2e4b5");
  },
};
