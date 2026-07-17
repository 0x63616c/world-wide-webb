/**
 * LayoutEditorView stories , the real board arrangement, rendered with the
 * REAL tile view components (populated story args, same `fromStory` merge
 * pattern proven in the LayoutPreview playground), no fake/placeholder data.
 *
 * Play tests exercise the ONE thing this view owns that isn't visible from a
 * static render: pointer-drag → lattice-snap → `onMove`. Drag math is derived
 * from the actually-rendered tile rect (not a hard-coded scale), so it stays
 * correct however `fitCamera` centers/scales the frame.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { expect, fireEvent, fn, within } from "storybook/test";
import { resolveLayout } from "../../lib/board-layout";
import { tilePixelSize, worldCellRect } from "../../lib/grid-constants";
import { LayoutEditorView, type LayoutEditorTile } from "./LayoutEditorView";

import * as ClimateS from "../tiles/ClimateTileView.stories";
import * as ClockS from "../tiles/ClockGreetingView.stories";
import * as ControlsS from "../tiles/ControlsTileView.stories";
import * as DogCamS from "../tiles/DogCamTileView.stories";
import * as DogModeS from "../tiles/DogModeTileView.stories";
import * as EventsS from "../tiles/EventsTileView.stories";
import * as FeLogsS from "../tiles/FrontendLogsTileView.stories";
import * as NetworkS from "../tiles/NetworkTileView.stories";
import * as HourlyS from "../tiles/Next12HoursView.stories";
import * as SchedS from "../tiles/SchedulesTileView.stories";
import * as TeslaS from "../tiles/TeslaTileView.stories";
import * as WeatherS from "../tiles/WeatherNowView.stories";
import * as QuickPlayS from "../media/QuickPlayTileView.stories";
import * as SoundS from "../media/SoundSystemTileView.stories";
import * as TvAppsS from "../media/TvAppsTileView.stories";
import * as TvS from "../media/TvNowPlayingTileView.stories";

// biome-ignore lint/suspicious/noExplicitAny: story args are heterogeneous
type StoryEntry = { component: React.ComponentType<any>; args: Record<string, unknown> };
// biome-ignore lint/suspicious/noExplicitAny: generic story-module access
function fromStory(mod: any, storyName: string): StoryEntry {
  return {
    component: mod.default.component,
    args: { ...(mod.default.args ?? {}), ...(mod[storyName].args ?? {}) },
  };
}

// Registry id → real view component + populated story args. Mirrors the
// validated mapping in the (uncommitted) LayoutPreview playground.
const VIEWS: Record<string, StoryEntry> = {
  tile_clock: fromStory(ClockS, "Populated"),
  tile_weath: fromStory(WeatherS, "Populated"),
  tile_wifi: fromStory(NetworkS, "Populated"),
  tile_tesla: fromStory(TeslaS, "Populated"),
  tile_hourly: fromStory(HourlyS, "Populated"),
  tile_ctrl: fromStory(ControlsS, "Mixed"),
  tile_sched: fromStory(SchedS, "Populated"),
  tile_dogcam: fromStory(DogCamS, "Covered"),
  tile_ac: fromStory(ClimateS, "CoolingMode"),
  tile_dogmode: fromStory(DogModeS, "Disarmed"),
  tile_event: fromStory(EventsS, "Default"),
  tile_tv: fromStory(TvS, "StreamingPlaying"),
  tile_sound: fromStory(SoundS, "Populated"),
  tile_tvapps: fromStory(TvAppsS, "YouTubeOpen"),
  tile_quickplay: fromStory(QuickPlayS, "Populated"),
  tile_felogs: fromStory(FeLogsS, "Steady"),
};

function renderTile(entry: LayoutEditorTile): ReactNode {
  const view = VIEWS[entry.id];
  if (!view) return null;
  const View = view.component;
  return <View {...view.args} />;
}

// The registry-default arrangement (V4B), same source Board itself falls back
// to via useBoardLayout before any saved placement exists.
const DEFAULT_TILES: LayoutEditorTile[] = resolveLayout([]).tiles;

function moveTile(tiles: LayoutEditorTile[], id: string, worldCol: number, worldRow: number): LayoutEditorTile[] {
  return tiles.map((t) => (t.id === id ? { ...t, worldCol, worldRow } : t));
}

// Confirmed (see task-7-report.md) to make bentoFor throw: nudging tile_ac one
// cell right opens a 1-cell slit the bento generator can't tile.
const INVALID_TILES = moveTile(DEFAULT_TILES, "tile_ac", 31, 24);

const meta = {
  title: "LayoutEditor/LayoutEditorView",
  component: LayoutEditorView,
  parameters: { boardWrapper: false, layout: "fullscreen" },
  args: {
    tiles: DEFAULT_TILES,
    renderTile,
    onMove: fn(),
    onReset: fn(),
    onCancel: fn(),
    onSave: fn(),
    saving: false,
    valid: true,
    invalidReason: null,
    dirty: false,
  },
} satisfies Meta<typeof LayoutEditorView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("layout-editor-stage")).toBeTruthy();
    await expect(canvas.getByTestId("layout-editor-rest-frame")).toBeTruthy();
    const saveButton = canvas.getByTestId("layout-editor-save") as HTMLButtonElement;
    await expect(saveButton.disabled).toBe(true); // !dirty

    // Drag tile_hourly one lattice pitch UP , a legal drop into open space
    // (row 23 is empty above the row-24 cluster edge), so onMove must fire
    // with the snapped world coords.
    const wrapper = canvas.getByTestId("layout-tile-tile_hourly");
    const hourly = DEFAULT_TILES.find((t) => t.id === "tile_hourly");
    if (!hourly) throw new Error("fixture missing tile_hourly");
    const rect = wrapper.getBoundingClientRect();
    const scale = rect.width / tilePixelSize(hourly.cols, hourly.rows).width;
    const pitchPx = (worldCellRect(0, 1, 1, 1).y - worldCellRect(0, 0, 1, 1).y) * scale;
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;

    fireEvent.pointerDown(wrapper, { pointerId: 1, button: 0, clientX: startX, clientY: startY });
    fireEvent.pointerMove(wrapper, { pointerId: 1, clientX: startX, clientY: startY - pitchPx });
    fireEvent.pointerUp(wrapper, { pointerId: 1, clientX: startX, clientY: startY - pitchPx });

    await expect(args.onMove).toHaveBeenCalledTimes(1);
    await expect(args.onMove).toHaveBeenCalledWith("tile_hourly", hourly.worldCol, hourly.worldRow - 1);
  },
};

export const Dirty: Story = {
  name: "Dirty (one tile staged elsewhere)",
  args: {
    tiles: moveTile(DEFAULT_TILES, "tile_hourly", 40, 40),
    dirty: true,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const saveButton = canvas.getByTestId("layout-editor-save") as HTMLButtonElement;
    await expect(saveButton.disabled).toBe(false); // valid && dirty && !saving

    // An overlapping drop must spring back: dragging tile_wifi onto tile_dogcam
    // (adjacent in the default arrangement) must NOT fire onMove.
    const wrapper = canvas.getByTestId("layout-tile-tile_wifi");
    const wifi = DEFAULT_TILES.find((t) => t.id === "tile_wifi");
    const dogcam = DEFAULT_TILES.find((t) => t.id === "tile_dogcam");
    if (!wifi || !dogcam) throw new Error("fixture missing tile_wifi/tile_dogcam");
    const rect = wrapper.getBoundingClientRect();
    const scale = rect.width / tilePixelSize(wifi.cols, wifi.rows).width;
    const pitchPx = (worldCellRect(1, 0, 1, 1).x - worldCellRect(0, 0, 1, 1).x) * scale;
    const deltaCols = dogcam.worldCol - wifi.worldCol;
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;

    fireEvent.pointerDown(wrapper, { pointerId: 2, button: 0, clientX: startX, clientY: startY });
    fireEvent.pointerMove(wrapper, {
      pointerId: 2,
      clientX: startX + deltaCols * pitchPx,
      clientY: startY,
    });
    fireEvent.pointerUp(wrapper, { pointerId: 2, clientX: startX + deltaCols * pitchPx, clientY: startY });

    await expect(args.onMove).not.toHaveBeenCalled();
  },
};

export const Invalid: Story = {
  name: "Invalid (1-cell slit)",
  args: {
    tiles: INVALID_TILES,
    dirty: true,
    valid: false,
    invalidReason: "board can't fill around this arrangement",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("layout-editor-invalid-reason")).toHaveTextContent(
      "board can't fill around this arrangement",
    );
    const saveButton = canvas.getByTestId("layout-editor-save") as HTMLButtonElement;
    await expect(saveButton.disabled).toBe(true); // !valid
  },
};

export const Saving: Story = {
  args: { dirty: true, saving: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const saveButton = canvas.getByTestId("layout-editor-save") as HTMLButtonElement;
    await expect(saveButton.disabled).toBe(true); // saving
    await expect(saveButton).toHaveTextContent("Saving…");
    const cancelButton = canvas.getByTestId("layout-editor-cancel") as HTMLButtonElement;
    await expect(cancelButton.disabled).toBe(true);
  },
};
