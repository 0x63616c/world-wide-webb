/**
 * Tests for TvNowPlayingTile and TvNowPlayingTileView (www-51hf.15).
 *
 * A19: artwork, app_name + source line, clamped title, prev/play-pause/next
 *      transport, scrub bar with mono position/duration, source-aware states.
 * A17: built from shared ui primitives, not re-inlined.
 * A18: resolves via tRPC, renders Skeleton while pending/error — no fake data.
 * A31: TvNowPlayingTile registered in TILE_REGISTRY (www-51hf.50).
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TvNowPlayingTile } from "../TvNowPlayingTile";
import { TvNowPlayingTileView } from "../TvNowPlayingTileView";

afterEach(cleanup);

// ── Mock portals and modal-open-store for modal rendering ────────────────────
vi.mock("react-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom")>();
  return {
    ...original,
    createPortal: (node: React.ReactNode) => node,
  };
});

vi.mock("@/lib/modal-open-store", () => ({
  registerOpenModal: vi.fn(() => () => {}),
}));

// ── Mock tRPC hook ────────────────────────────────────────────────────────────
vi.mock("@/lib/trpc", () => {
  const useQuery = vi.fn();
  const useMutation = vi.fn(() => ({ mutate: vi.fn() }));
  return {
    trpc: {
      media: {
        tvNowPlaying: { useQuery },
        tvPlay: { useMutation },
        tvPause: { useMutation },
        tvNext: { useMutation },
        tvPrevious: { useMutation },
        tvSeek: { useMutation },
        tvRemote: { useMutation },
      },
    },
    queryClient: {},
    trpcClient: {},
  };
});

async function getTvUseQuery() {
  const mod = await import("@/lib/trpc");
  return mod.trpc.media.tvNowPlaying.useQuery as ReturnType<typeof vi.fn>;
}

// ── TvNowPlayingTileView unit tests ───────────────────────────────────────────

describe("TvNowPlayingTileView — skeleton (loading / error)", () => {
  it("renders a .tile container in loading state", () => {
    const { container } = render(<TvNowPlayingTileView status="loading" />);
    expect(container.querySelector(".tile")).toBeInTheDocument();
  });

  it("renders a .tile container in error state", () => {
    const { container } = render(<TvNowPlayingTileView status="error" />);
    expect(container.querySelector(".tile")).toBeInTheDocument();
  });

  it("does NOT render real content while loading (no fake data)", () => {
    render(<TvNowPlayingTileView status="loading" />);
    expect(screen.queryByText(/Netflix/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d:\d\d/)).not.toBeInTheDocument();
  });

  it("renders at least one skeleton shimmer while loading (A18)", () => {
    const { container } = render(<TvNowPlayingTileView status="loading" />);
    expect(container.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(0);
  });
});

describe("TvNowPlayingTileView — streaming playing state (A19)", () => {
  const streamingPlaying = {
    status: "populated" as const,
    state: "playing",
    appName: "Netflix",
    mediaTitle: "Stranger Things",
    mediaArtist: "Netflix Originals",
    mediaPosition: 125,
    mediaDuration: 3600,
    source: "streaming" as const,
    artworkUrl: null,
  };

  it("renders the tile header title 'TV'", () => {
    render(<TvNowPlayingTileView {...streamingPlaying} />);
    expect(screen.getByText("TV")).toBeInTheDocument();
  });

  it("renders app_name source line (A19)", () => {
    render(<TvNowPlayingTileView {...streamingPlaying} />);
    // Netflix appears in both the pill (source label) and the artist source line
    expect(screen.getAllByText(/Netflix/).length).toBeGreaterThan(0);
  });

  it("renders media title (A19)", () => {
    render(<TvNowPlayingTileView {...streamingPlaying} />);
    expect(screen.getByText("Stranger Things")).toBeInTheDocument();
  });

  it("renders transport controls: prev, play-pause, next (A19)", () => {
    render(<TvNowPlayingTileView {...streamingPlaying} />);
    expect(screen.getByLabelText(/previous/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/play|pause/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/next/i)).toBeInTheDocument();
  });

  it("renders scrub bar (A19)", () => {
    const { container } = render(<TvNowPlayingTileView {...streamingPlaying} />);
    // Scrub bar is an <input type="range"> or a div with data-scrub
    const scrub =
      container.querySelector("[data-scrub]") ?? container.querySelector("input[type='range']");
    expect(scrub).toBeInTheDocument();
  });

  it("renders mono position/duration text (A19)", () => {
    render(<TvNowPlayingTileView {...streamingPlaying} />);
    // 125s = 2:05, 3600s = 1:00:00
    expect(screen.getByText("2:05")).toBeInTheDocument();
  });
});

describe("TvNowPlayingTileView — streaming paused state", () => {
  it("shows paused state correctly", () => {
    render(
      <TvNowPlayingTileView
        status="populated"
        state="paused"
        appName="Disney+"
        mediaTitle="The Mandalorian"
        mediaArtist={null}
        mediaPosition={60}
        mediaDuration={2700}
        source="streaming"
        artworkUrl={null}
      />,
    );
    // Disney+ appears in pill AND artist line (appName fallback when no mediaArtist)
    expect(screen.getAllByText("Disney+").length).toBeGreaterThan(0);
    expect(screen.getByText("The Mandalorian")).toBeInTheDocument();
    expect(screen.getByLabelText(/play|pause/i)).toBeInTheDocument();
  });
});

// ── Transport callback tests (A19, www-51hf.52) ────────────────────────────────

describe("TvNowPlayingTileView — transport callbacks (A19)", () => {
  const streamingProps = {
    status: "populated" as const,
    state: "playing",
    appName: "Netflix",
    mediaTitle: "Stranger Things",
    mediaArtist: "Netflix Originals",
    mediaPosition: 125,
    mediaDuration: 3600,
    source: "streaming" as const,
    artworkUrl: null,
  };

  it("calls onPrev when previous button is clicked", () => {
    const onPrev = vi.fn();
    render(<TvNowPlayingTileView {...streamingProps} onPrev={onPrev} />);
    fireEvent.click(screen.getByLabelText(/previous/i));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("calls onPlayPause when play-pause button is clicked (playing -> paused)", () => {
    const onPlayPause = vi.fn();
    render(<TvNowPlayingTileView {...streamingProps} state="playing" onPlayPause={onPlayPause} />);
    fireEvent.click(screen.getByLabelText("Pause"));
    expect(onPlayPause).toHaveBeenCalledTimes(1);
  });

  it("calls onPlayPause when play-pause button is clicked (paused -> playing)", () => {
    const onPlayPause = vi.fn();
    render(<TvNowPlayingTileView {...streamingProps} state="paused" onPlayPause={onPlayPause} />);
    fireEvent.click(screen.getByLabelText("Play"));
    expect(onPlayPause).toHaveBeenCalledTimes(1);
  });

  it("calls onNext when next button is clicked", () => {
    const onNext = vi.fn();
    render(<TvNowPlayingTileView {...streamingProps} onNext={onNext} />);
    fireEvent.click(screen.getByLabelText(/next/i));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("calls onSeek when scrub bar is clicked (A19)", () => {
    const onSeek = vi.fn();
    const { container } = render(<TvNowPlayingTileView {...streamingProps} onSeek={onSeek} />);
    const scrub = container.querySelector("[data-scrub]") as HTMLElement;
    expect(scrub).toBeInTheDocument();

    // Mock bounding rect so the click fraction resolves to a real value.
    vi.spyOn(scrub, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 200,
      width: 200,
      top: 0,
      bottom: 6,
      height: 6,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect);

    // Click at 100px on a 200px-wide, 3600s-long scrub bar → ~1800s
    fireEvent.click(scrub, { clientX: 100 });
    expect(onSeek).toHaveBeenCalledTimes(1);
    const pos = onSeek.mock.calls[0][0] as number;
    expect(pos).toBeGreaterThan(1700);
    expect(pos).toBeLessThan(1900);
  });
});

describe("TvNowPlayingTileView — line-in source", () => {
  it("shows line-in label when source is line-in", () => {
    render(
      <TvNowPlayingTileView
        status="populated"
        state="playing"
        appName={null}
        mediaTitle={null}
        mediaArtist={null}
        mediaPosition={null}
        mediaDuration={null}
        source="line-in"
        artworkUrl={null}
      />,
    );
    expect(screen.getByText(/line.in/i)).toBeInTheDocument();
  });
});

describe("TvNowPlayingTileView — TV source", () => {
  it("shows TV source label when source is TV", () => {
    render(
      <TvNowPlayingTileView
        status="populated"
        state="playing"
        appName="TV"
        mediaTitle="Live Sports"
        mediaArtist={null}
        mediaPosition={null}
        mediaDuration={null}
        source="TV"
        artworkUrl={null}
      />,
    );
    // The pill shows "Live TV" for TV source; header also shows "TV" — check pill specifically
    expect(screen.getByText("Live TV")).toBeInTheDocument();
  });
});

describe("TvNowPlayingTileView — idle source", () => {
  it("shows idle / standby state when source is idle", () => {
    render(
      <TvNowPlayingTileView
        status="populated"
        state="idle"
        appName={null}
        mediaTitle={null}
        mediaArtist={null}
        mediaPosition={null}
        mediaDuration={null}
        source="idle"
        artworkUrl={null}
      />,
    );
    // idle state renders something — at least a .tile with header
    expect(screen.getByText("TV")).toBeInTheDocument();
  });
});

// ── Tile registry tests (A31, www-51hf.50) ────────────────────────────────────

// maplibre-gl / pmtiles needed by TeslaTileView imported transitively
vi.mock("maplibre-gl", () => ({ default: {} }));
vi.mock("pmtiles", () => ({ Protocol: vi.fn().mockImplementation(() => ({ tile: vi.fn() })) }));
vi.mock("@protomaps/basemaps", () => ({
  layers: vi.fn().mockReturnValue([]),
  namedFlavor: vi.fn().mockReturnValue({}),
}));

describe("TILE_REGISTRY — TvNowPlayingTile registration (A31)", () => {
  it("TvNowPlayingTile is registered in TILE_REGISTRY", async () => {
    const { TILE_REGISTRY } = await import("@/lib/tile-registry");
    const entry = TILE_REGISTRY.find((t) => t.component === TvNowPlayingTile);
    expect(entry, "TvNowPlayingTile must be in TILE_REGISTRY").toBeDefined();
  });

  it("registry entry has required world placement fields", async () => {
    const { TILE_REGISTRY } = await import("@/lib/tile-registry");
    const entry = TILE_REGISTRY.find((t) => t.component === TvNowPlayingTile);
    expect(entry?.worldCol, "worldCol must be a number").toBeTypeOf("number");
    expect(entry?.worldRow, "worldRow must be a number").toBeTypeOf("number");
    expect(entry?.cols).toBe(4);
    expect(entry?.rows).toBe(3);
  });

  it("registry entry sets ownsTap=true (has detail modal)", async () => {
    const { TILE_REGISTRY } = await import("@/lib/tile-registry");
    const entry = TILE_REGISTRY.find((t) => t.component === TvNowPlayingTile);
    expect(entry?.ownsTap).toBe(true);
  });
});

// ── Modal integration tests (A20, A21, www-51hf.53) ───────────────────────────
// TransportScrubModal and TvRemoteModal must be wired into TvNowPlayingTile.
// The tile owns its tap surface (ownsTap:true) — opening modals is its
// responsibility. TvNowPlayingTileView exposes onOpenTransport/onOpenRemote
// props that the tile binds to modal open handlers.

describe("TvNowPlayingTileView — modal open callbacks (A20/A21)", () => {
  const streamingProps = {
    status: "populated" as const,
    state: "playing",
    appName: "Netflix",
    mediaTitle: "Stranger Things",
    mediaArtist: "Netflix Originals",
    mediaPosition: 125,
    mediaDuration: 3600,
    source: "streaming" as const,
    artworkUrl: null,
  };

  it("calls onOpenTransport when the transport-open control is activated (A20)", () => {
    const onOpenTransport = vi.fn();
    render(<TvNowPlayingTileView {...streamingProps} onOpenTransport={onOpenTransport} />);
    // A control with data-open-transport or aria-label matching "transport|detail|expand"
    const btn =
      document.querySelector("[data-open-transport]") ??
      screen.queryByLabelText(/transport|detail|expand/i);
    expect(btn, "onOpenTransport trigger must exist in TvNowPlayingTileView").not.toBeNull();
    fireEvent.click(btn as Element);
    expect(onOpenTransport).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenRemote when the remote-open control is activated (A21)", () => {
    const onOpenRemote = vi.fn();
    render(<TvNowPlayingTileView {...streamingProps} onOpenRemote={onOpenRemote} />);
    const btn = document.querySelector("[data-open-remote]") ?? screen.queryByLabelText(/remote/i);
    expect(btn, "onOpenRemote trigger must exist in TvNowPlayingTileView").not.toBeNull();
    fireEvent.click(btn as Element);
    expect(onOpenRemote).toHaveBeenCalledTimes(1);
  });
});

// ── TvNowPlayingTile container tests ─────────────────────────────────────────

describe("TvNowPlayingTile — container (A18)", () => {
  it("renders skeleton while loading (no fake data)", async () => {
    const useQuery = await getTvUseQuery();
    useQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = render(<TvNowPlayingTile />);
    expect(container.querySelector(".tile")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(0);
  });

  it("renders skeleton on error (no fake data)", async () => {
    const useQuery = await getTvUseQuery();
    useQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    const { container } = render(<TvNowPlayingTile />);
    expect(container.querySelector(".tile")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(0);
  });

  it("renders media data when query succeeds (A19)", async () => {
    const useQuery = await getTvUseQuery();
    useQuery.mockReturnValue({
      data: {
        state: "playing",
        appName: "YouTube",
        mediaTitle: "My Video",
        mediaArtist: "Creator",
        mediaPosition: 30,
        mediaDuration: 300,
        source: "streaming",
      },
      isLoading: false,
      isError: false,
    });
    render(<TvNowPlayingTile />);
    expect(screen.getByText("YouTube")).toBeInTheDocument();
    expect(screen.getByText("My Video")).toBeInTheDocument();
  });
});
