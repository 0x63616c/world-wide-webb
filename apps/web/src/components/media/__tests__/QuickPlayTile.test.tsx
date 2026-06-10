/**
 * Tests for QuickPlayTileView (www-51hf.23).
 *
 * A28: Horizontal artwork rail from Sonos Favorites + Spotify; playing item
 *      gets an accent badge; tapping a cover plays it; Skeleton-on-pending.
 * A17: uses shared ui primitives.
 * A32: co-located test + stories.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuickPlayTileViewProps } from "../QuickPlayTileView";
import { QuickPlayTileView } from "../QuickPlayTileView";

afterEach(cleanup);

const baseItems = [
  { id: "fav-1", title: "Chill Mix", albumArtUri: null, source: "sonos" as const },
  { id: "fav-2", title: "Morning Vibes", albumArtUri: null, source: "sonos" as const },
  { id: "spo-1", title: "Top Songs", albumArtUri: null, source: "spotify" as const },
];

const baseProps: QuickPlayTileViewProps = {
  status: "populated",
  items: baseItems,
  playingItemId: "fav-1",
  onPlayItem: vi.fn(),
  onOpenFavorites: vi.fn(),
  onOpenSpotify: vi.fn(),
};

describe("QuickPlayTileView — loading/error", () => {
  it("renders Skeleton when status=loading", () => {
    const { container } = render(
      <QuickPlayTileView
        status="loading"
        items={[]}
        playingItemId={null}
        onPlayItem={vi.fn()}
        onOpenFavorites={vi.fn()}
        onOpenSpotify={vi.fn()}
      />,
    );
    expect(
      container.querySelector("[data-skeleton]") ?? container.querySelector("[aria-busy]"),
    ).toBeInTheDocument();
  });
});

describe("QuickPlayTileView — populated (A28)", () => {
  it("renders a header", () => {
    render(<QuickPlayTileView {...baseProps} />);
    expect(screen.getByText(/quick.play/i)).toBeInTheDocument();
  });

  it("renders item titles in the rail", () => {
    render(<QuickPlayTileView {...baseProps} />);
    expect(screen.getByText("Chill Mix")).toBeInTheDocument();
    expect(screen.getByText("Morning Vibes")).toBeInTheDocument();
    expect(screen.getByText("Top Songs")).toBeInTheDocument();
  });

  it("calls onPlayItem when a cover is clicked", () => {
    const onPlayItem = vi.fn();
    render(<QuickPlayTileView {...baseProps} onPlayItem={onPlayItem} />);
    fireEvent.click(screen.getByText("Morning Vibes"));
    expect(onPlayItem).toHaveBeenCalledWith(baseItems[1]);
  });

  it("grows 1:1 artwork to fill the rail height instead of a fixed edge (www-sjzd)", () => {
    const items = [
      {
        id: "fav-9",
        title: "Art Mix",
        albumArtUri: "https://example.test/a.jpg",
        source: "sonos" as const,
      },
    ];
    render(<QuickPlayTileView {...baseProps} items={items} />);
    const artwork = screen.getByAltText("Art Mix").parentElement;
    const style = artwork?.getAttribute("style") ?? "";
    // Square is enforced by aspect-ratio; height comes from flexing into the
    // rail, not a hardcoded px edge.
    expect(style).toMatch(/aspect-ratio: 1 \/ 1/);
    expect(style).not.toMatch(/(^|;)\s*width: \d+px/);
  });

  it("marks the playing item with an accent badge", () => {
    const { container } = render(<QuickPlayTileView {...baseProps} />);
    expect(container.querySelector("[data-playing]")).toBeInTheDocument();
  });

  it("renders a Favorites button", () => {
    render(<QuickPlayTileView {...baseProps} />);
    expect(screen.getByLabelText(/favorites/i)).toBeInTheDocument();
  });

  it("renders a Spotify button", () => {
    render(<QuickPlayTileView {...baseProps} />);
    expect(screen.getByLabelText(/spotify/i)).toBeInTheDocument();
  });

  it("calls onOpenFavorites when Favorites button is clicked", () => {
    const onOpenFavorites = vi.fn();
    render(<QuickPlayTileView {...baseProps} onOpenFavorites={onOpenFavorites} />);
    fireEvent.click(screen.getByLabelText(/favorites/i));
    expect(onOpenFavorites).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenSpotify when Spotify button is clicked", () => {
    const onOpenSpotify = vi.fn();
    render(<QuickPlayTileView {...baseProps} onOpenSpotify={onOpenSpotify} />);
    fireEvent.click(screen.getByLabelText(/spotify/i));
    expect(onOpenSpotify).toHaveBeenCalledTimes(1);
  });
});
