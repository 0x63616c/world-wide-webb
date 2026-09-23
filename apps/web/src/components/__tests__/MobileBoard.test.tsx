import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A fake two-tile registry standing in for the real Apps, so the phone view can
// be exercised in jsdom without loading real tiles. Mirrors Board.test.tsx's
// fake, with one fake per curated phone id plus a third the phone view must
// NOT show.
vi.mock("@features/_generated/web.gen", () => {
  function fakeTile(id: string, label: string) {
    return {
      id,
      label,
      component: () => (
        <div>
          {`${id}-body`}
          <button type="button">{`${id}-control`}</button>
        </div>
      ),
      viewComponent: () => null,
      worldCol: 30,
      worldRow: 24,
      cols: 4,
      rows: 3,
      access: { requiresSessionUnlock: false, requiresFreshUnlock: false },
    };
  }
  const tiles = [
    fakeTile("tile_ctrl", "Controls"),
    fakeTile("tile_ac", "Climate · A/C"),
    // On the board but never on the phone.
    fakeTile("tile_tesla", "Evee"),
  ];
  const byId = new Map(tiles.map((t) => [t.id, t]));
  return {
    TILE_REGISTRY: tiles,
    HOME_TILE: tiles[0],
    accessFor: (id: string) => byId.get(id)?.access,
    registryEntryForTileId: (id: string) => byId.get(id),
    registryEntryForComponent: () => undefined,
    getTileDetailEntry: () => undefined,
  };
});

import { closeTileDetail, useTileDetail } from "../../lib/tile-detail-store";
import { MobileBoard, PHONE_TILE_IDS } from "../MobileBoard";

afterEach(() => {
  cleanup();
  // The tile-detail store is module-global; drain it so an open page from one
  // test can't leak into the next.
  closeTileDetail();
  vi.restoreAllMocks();
});

describe("MobileBoard", () => {
  it("shows the quick Controls and Climate · A/C tiles, in that order", () => {
    render(<MobileBoard />);
    const cards = screen.getAllByRole("button", { name: /^Open / });
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Open Controls",
      "Open Climate · A/C",
    ]);
    expect(screen.getByText("tile_ctrl-body")).not.toBeNull();
    expect(screen.getByText("tile_ac-body")).not.toBeNull();
  });

  it("lets Controls grow beyond its panel aspect while Climate keeps its aspect", () => {
    render(<MobileBoard />);
    expect(screen.getByRole("button", { name: "Open Controls" }).style.aspectRatio).toBe("");
    expect(screen.getByRole("button", { name: "Open Climate · A/C" }).style.aspectRatio).not.toBe(
      "",
    );
  });

  it("shows nothing else from the board", () => {
    render(<MobileBoard />);
    expect(screen.queryByText("tile_tesla-body")).toBeNull();
    expect(screen.queryByLabelText("Open Evee")).toBeNull();
  });

  // The two banners the phone view exists to silence. They self-guard as well
  // (see their own tests), but the phone view must not even mount the stack.
  it("renders no banner stack", () => {
    render(<MobileBoard />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/set your device name/i)).toBeNull();
    expect(screen.queryByText(/is not charging/i)).toBeNull();
  });

  // Settings is reachable: a phone is where you go to change a setting you
  // noticed on the panel.
  it("keeps the Settings gear", () => {
    render(<MobileBoard />);
    expect(screen.getByRole("button", { name: "Settings" })).not.toBeNull();
  });

  it("opens a tile's detail page when its face is tapped", () => {
    function DetailProbe() {
      const target = useTileDetail();
      return <div data-testid="detail-target">{target?.tileId ?? "none"}</div>;
    }
    render(
      <>
        <MobileBoard />
        <DetailProbe />
      </>,
    );
    expect(screen.getByTestId("detail-target").textContent).toBe("none");

    fireEvent.click(screen.getByRole("button", { name: "Open Controls" }));
    expect(screen.getByTestId("detail-target").textContent).toBe("tile_ctrl");
  });

  it("leaves taps on a tile's own controls to that control", () => {
    function DetailProbe() {
      const target = useTileDetail();
      return <div data-testid="detail-target">{target?.tileId ?? "none"}</div>;
    }
    render(
      <>
        <MobileBoard />
        <DetailProbe />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "tile_ctrl-control" }));
    expect(screen.getByTestId("detail-target").textContent).toBe("none");
  });
});

// The curated list is only correct as long as those ids still exist. This is the
// guardrail the module's comment promises: rename or drop either App's tile and
// this fails, instead of the phone view quietly losing a card.
describe("PHONE_TILE_IDS", () => {
  it("resolves every curated id against the REAL App registry", async () => {
    const real = await vi.importActual<typeof import("@features/_generated/web.gen")>(
      "@features/_generated/web.gen",
    );
    for (const id of PHONE_TILE_IDS) {
      const entry = real.registryEntryForTileId(id);
      expect(entry, `phone tile ${id} is not in the App registry`).toBeDefined();
      // A curated phone tile must not be PIN-gated: the phone view renders tile
      // faces directly, with no PIN gate of its own to stand in front of them.
      expect(entry?.access.requiresFreshUnlock).toBe(false);
      expect(entry?.access.requiresSessionUnlock).toBe(false);
    }
  });
});
