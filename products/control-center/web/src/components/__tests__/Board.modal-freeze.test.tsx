import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "../ui/Modal";

// A self-tapping tile (ownsTap) that manages its OWN modal in its React subtree ,
// exactly like ControlsTile + ExpandedControlsModalView. The modal portals to
// <body>, but in the React tree it is a descendant of the board's tile wrapper,
// so React replays its events up into the board. The modal holds a button so we
// can click "inside the modal" and assert the board does not move behind it.
function SelfModalTile() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      tile-body
      <button type="button" onClick={() => setOpen(true)}>
        open-self-modal
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Self Modal">
        <button type="button">modal-action</button>
      </Modal>
    </div>
  );
}

vi.mock("../../lib/tile-registry", () => {
  const self = {
    id: "tile_self",
    label: "Self Tile",
    component: SelfModalTile,
    viewComponent: () => null,
    worldCol: 26,
    worldRow: 27,
    cols: 4,
    rows: 2,
    home: true,
    // Owns its tap: a tap drives its own UI (and recenters), never the board's
    // generic modal , same as the real Controls tile.
    ownsTap: true,
  };
  return { TILE_REGISTRY: [self], HOME_TILE: self };
});
// Board now reads its layout via useBoardLayout (tRPC), which needs a real
// TRPCProvider the plain jsdom render here doesn't set up. Stub it to settle
// immediately on the fake registry above, mirroring the real resolveLayout([])
// (no saved placements) path , same shape a fresh/empty deployment sees.
vi.mock("../../lib/useBoardLayout", async () => {
  const { resolveLayout } = await import("../../lib/board-layout");
  const { TILE_REGISTRY } = await import("../../lib/tile-registry");
  return {
    useBoardLayout: () => ({
      status: "ready" as const,
      layout: resolveLayout([], TILE_REGISTRY),
      revision: null,
      refetch: () => {},
    }),
  };
});
vi.mock("../ConnectionLostBanner", () => ({ ConnectionLostBanner: () => null }));
vi.mock("../tiles/modals/registry", () => ({ getTileModalEntry: () => undefined }));
// The detail registry imports real tile wiring (and transitively maplibre-gl),
// which jsdom cannot load , stub it so Board stays on the legacy modal path.
vi.mock("../tiles/detail/registry", () => ({ getTileDetailEntry: () => undefined }));

import { Board } from "../Board";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Board , pan freeze while a tile's own modal is open", () => {
  it("a click inside an open modal does NOT scroll the board behind it", () => {
    render(<Board />);
    const stage = document.getElementById("stage");
    if (!stage) throw new Error("stage missing");
    // jsdom has no scrollTo; install one so glideToTile takes the smooth-scroll
    // path (browser behavior) and spy to detect any programmatic glide.
    stage.scrollTo = () => {};
    const scrollSpy = vi.spyOn(stage, "scrollTo");

    // Open the tile's own modal. (Opening is allowed to recenter , we only care
    // about what happens AFTER it is open.)
    fireEvent.click(screen.getByRole("button", { name: "open-self-modal" }));
    expect(screen.getByRole("button", { name: "modal-action" })).toBeTruthy();

    scrollSpy.mockClear();

    // Click a control INSIDE the open modal. The board must stay frozen , no
    // glide/scroll behind the backdrop.
    fireEvent.click(screen.getByRole("button", { name: "modal-action" }));

    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
