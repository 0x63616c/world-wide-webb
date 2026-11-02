import "@testing-library/jest-dom";
import { getTileDetailEntry } from "@features/_generated/web.gen";
import { BoothGallery } from "@features/booth/web/BoothGallery";
import { PhotoBoothPager } from "@features/booth/web/PhotoBoothPager";
import { ActivityPage } from "@features/wakes/web/ActivityPage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetSessionForTests, panelSession } from "../../lib/panel-session";
import { resetSettings } from "../../lib/settings";
import { closeTileDetail, openTileDetail } from "../../lib/tile-detail-store";
import { trpc } from "../../lib/trpc";
import { CleanScreenOverlay } from "../CleanScreenOverlay";
import { LevelOverlay } from "../LevelOverlay";
import { PinChangeModal } from "../pin/PinChangeModal";
import { PinGateModal } from "../pin/PinGateModal";
import { PAGES } from "../settings-page/pages";
import { SettingsPage } from "../settings-page/SettingsPage";
import { TileDetailHost } from "../tiles/detail/TileDetailHost";
import { BackPill } from "../ui/BackPill";
import { ConfirmDialog } from "../ui/ConfirmDialog";

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  closeTileDetail();
  __resetSessionForTests();
  resetSettings();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderTile(tileId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(queryClient);
  // Leave queries pending to exercise real offline/loading screens without network access.
  const client = trpc.createClient({
    links: [
      httpBatchLink({
        url: "http://localhost/trpc",
        fetch: () => new Promise<Response>(() => {}),
      }),
    ],
  });
  openTileDetail(tileId);
  return render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <TileDetailHost />
      </QueryClientProvider>
    </trpc.Provider>,
  );
}
function clickBack(name = "Back to board") {
  const pill = screen.getByRole("button", { name });
  expect(pill).toBeVisible();
  expect(pill).toHaveStyle({ position: "fixed", minHeight: "56px" });
  fireEvent.click(pill);
}

describe("every dashboard escape route", () => {
  it.each([
    "tile_ctrl",
    "tile_sound",
    "tile_clock",
    "tile_wakes",
    "tile_booth",
  ])("%s returns from the real registry host to the board (including loading)", (tileId) => {
    vi.useFakeTimers();
    panelSession.unlock();
    renderTile(tileId);
    if (tileId === "tile_booth") {
      for (const digit of "000000") fireEvent.click(screen.getByRole("button", { name: digit }));
      act(() => vi.advanceTimersByTime(250));
    }
    if (tileId === "tile_clock") {
      fireEvent.click(screen.getByRole("button", { name: "Add alarm" }));
      expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    }
    clickBack();
    expect(screen.queryByRole("button", { name: "Back to board" })).not.toBeInTheDocument();
    expect(getTileDetailEntry(tileId)?.kind).toBe("page");
  });

  it.each(PAGES)("Settings $label returns to the board", async ({ key }) => {
    const close = vi.fn();
    render(
      <SettingsPage
        open
        initialPage={key}
        onClose={close}
        onOpenLevel={vi.fn()}
        onOpenClean={vi.fn()}
      />,
    );
    await act(async () => {});
    clickBack();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("phone Settings steps back to its page list, then the board", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const close = vi.fn();
    render(
      <SettingsPage
        open
        initialPage="display"
        onClose={close}
        onOpenLevel={vi.fn()}
        onOpenClean={vi.fn()}
      />,
    );
    clickBack("Back to Settings");
    expect(close).not.toHaveBeenCalled();
    clickBack();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(["grid", "sessions"])("Activity %s has a working way home", (mode) => {
    const back = vi.fn();
    render(
      <ActivityPage
        days={[]}
        sessions={[]}
        totalBytes={0}
        totalCount={0}
        photoUrl={(p) => p}
        onBack={back}
      />,
    );
    if (mode === "sessions") fireEvent.click(screen.getByRole("radio", { name: "Sessions" }));
    clickBack();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("photo booth camera → gallery → camera → board", () => {
    const close = vi.fn();
    render(<PhotoBoothPager groups={[]} photoUrl={(p) => p} onRemove={vi.fn()} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Open gallery" }));
    clickBack("Back to camera");
    expect(close).not.toHaveBeenCalled();
    clickBack();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("lightbox has a visible exit and Escape closes only the lightbox", () => {
    const back = vi.fn();
    render(
      <BoothGallery
        groups={[
          {
            groupId: "test",
            mode: "photo",
            capturedAt: 1,
            filter: null,
            frames: [
              {
                id: "frame_test",
                path: "photo.jpg",
                capturedAt: 1,
                frameIdx: 0,
                mimeType: "image/jpeg",
                filter: null,
              },
            ],
          },
        ]}
        photoUrl={(p) => p}
        onRemove={vi.fn()}
        onBack={back}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Open Photo from/ }));
    expect(screen.getByRole("button", { name: "Back to photos" })).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(back).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Back to photos" })).toBeNull();
    clickBack("Back to camera");
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("filters close without closing the camera beneath", () => {
    const close = vi.fn();
    render(<PhotoBoothPager groups={[]} photoUrl={(p) => p} onRemove={vi.fn()} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: /^Filters,/ }));
    expect(screen.getByRole("dialog", { name: "Filter" })).toBeVisible();
    clickBack("Close");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to board" })).toBeVisible();
    expect(close).not.toHaveBeenCalled();
  });

  it.each(["gate", "change"])("PIN %s dialog has a reachable cancel", (kind) => {
    const close = vi.fn();
    render(
      kind === "gate" ? (
        <PinGateModal open title="Activity" onClose={close} onSuccess={vi.fn()} />
      ) : (
        <PinChangeModal open onClose={close} onChanged={vi.fn()} />
      ),
    );
    expect(screen.getByRole("dialog")).toContainElement(
      screen.getByRole("button", { name: "Back" }),
    );
    clickBack("Back");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("confirmation dialogs have a reachable close", () => {
    const close = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Reset settings?"
        message="Confirm reset"
        onClose={close}
        onConfirm={vi.fn()}
      />,
    );
    clickBack("Close");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("level view returns to Settings exactly once", () => {
    const close = vi.fn();
    render(<LevelOverlay open onClose={close} />);
    clickBack("Back to Settings");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("cleaning lockout keeps its intentional hold exit and consumes Escape above Settings", () => {
    const back = vi.fn();
    const complete = vi.fn();
    const page = render(<BackPill onBack={back} />);
    render(<CleanScreenOverlay open onComplete={complete} onCancel={vi.fn()} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(back).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Hold.*exit/i })).toBeVisible();
    expect(complete).not.toHaveBeenCalled();
    page.unmount();
  });
});
