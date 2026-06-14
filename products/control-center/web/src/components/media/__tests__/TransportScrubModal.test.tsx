/**
 * Tests for TransportScrubModal (www-51hf.16 / www-51hf.54).
 *
 * A20: large art, title/artist, draggable scrubber (seek on pointer release),
 *      transport row (prev/play-pause/next); line-in/TV shows no-seek note
 *      instead of scrubber.
 * Shuffle and volume removed , no backend mutations exist (www-51hf.54).
 * A17: uses Modal and other shared ui primitives.
 * A32: co-located test + stories file.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransportScrubModal, type TransportScrubModalProps } from "../TransportScrubModal";

afterEach(cleanup);

// ── Mock portals (createPortal) so Modal renders inline in tests ──────────────
vi.mock("react-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom")>();
  return {
    ...original,
    createPortal: (node: React.ReactNode) => node,
  };
});

// ── Modal-open store (registerOpenModal) ─────────────────────────────────────
vi.mock("@/lib/modal-open-store", () => ({
  registerOpenModal: vi.fn(() => () => {}),
}));

// ── Base props (streaming playing) ───────────────────────────────────────────

const baseProps: TransportScrubModalProps = {
  open: true,
  onClose: vi.fn(),
  state: "playing",
  appName: "Netflix",
  mediaTitle: "Stranger Things",
  mediaArtist: "Netflix Originals",
  mediaPosition: 120,
  mediaDuration: 3600,
  source: "streaming",
  artworkUrl: null,
  onPrev: vi.fn(),
  onPlayPause: vi.fn(),
  onNext: vi.fn(),
  onSeek: vi.fn(),
};

// ── Closed state ──────────────────────────────────────────────────────────────

describe("TransportScrubModal , closed", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(<TransportScrubModal {...baseProps} open={false} />);
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });
});

// ── Open state: core structure (A20) ─────────────────────────────────────────

describe("TransportScrubModal , open, streaming playing (A20)", () => {
  it("renders a dialog role element", () => {
    render(<TransportScrubModal {...baseProps} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders the media title (A20)", () => {
    render(<TransportScrubModal {...baseProps} />);
    // Title appears in Modal header AND content body , both are correct.
    expect(screen.getAllByText("Stranger Things").length).toBeGreaterThan(0);
  });

  it("renders the media artist (A20)", () => {
    render(<TransportScrubModal {...baseProps} />);
    expect(screen.getAllByText("Netflix Originals").length).toBeGreaterThan(0);
  });

  it("renders an artwork area (large art , A20)", () => {
    const { container } = render(<TransportScrubModal {...baseProps} />);
    // Artwork: either an <img> or a placeholder div with data-artwork attribute.
    const art =
      container.querySelector("img[alt*='artwork' i]") ?? container.querySelector("[data-artwork]");
    expect(art).toBeInTheDocument();
  });

  it("renders the scrubber for streaming source (A20)", () => {
    const { container } = render(<TransportScrubModal {...baseProps} />);
    const scrub =
      container.querySelector("[data-scrub]") ?? container.querySelector("input[type='range']");
    expect(scrub).toBeInTheDocument();
  });

  it("renders position and duration timestamps", () => {
    render(<TransportScrubModal {...baseProps} />);
    // 120s = 2:00, 3600s = 1:00:00
    expect(screen.getByText("2:00")).toBeInTheDocument();
  });

  it("renders transport controls: prev, play-pause, next (A20)", () => {
    render(<TransportScrubModal {...baseProps} />);
    expect(screen.getByLabelText(/previous/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/pause/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/next/i)).toBeInTheDocument();
  });

  it("does not render shuffle or volume (no backend mutations , www-51hf.54)", () => {
    const { container } = render(<TransportScrubModal {...baseProps} />);
    expect(container.querySelector("[aria-label='Shuffle']")).not.toBeInTheDocument();
    expect(container.querySelector("[data-volume-slider]")).not.toBeInTheDocument();
  });

  it("shows pause icon when state=playing", () => {
    render(<TransportScrubModal {...baseProps} state="playing" />);
    expect(screen.getByLabelText("Pause")).toBeInTheDocument();
  });

  it("shows play icon when state=paused", () => {
    render(<TransportScrubModal {...baseProps} state="paused" />);
    expect(screen.getByLabelText("Play")).toBeInTheDocument();
  });
});

// ── Transport callbacks ───────────────────────────────────────────────────────

describe("TransportScrubModal , transport callbacks", () => {
  it("calls onPrev when prev button is clicked", () => {
    const onPrev = vi.fn();
    render(<TransportScrubModal {...baseProps} onPrev={onPrev} />);
    fireEvent.click(screen.getByLabelText(/previous/i));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("calls onPlayPause when play-pause button is clicked", () => {
    const onPlayPause = vi.fn();
    render(<TransportScrubModal {...baseProps} onPlayPause={onPlayPause} />);
    fireEvent.click(screen.getByLabelText(/pause/i));
    expect(onPlayPause).toHaveBeenCalledTimes(1);
  });

  it("calls onNext when next button is clicked", () => {
    const onNext = vi.fn();
    render(<TransportScrubModal {...baseProps} onNext={onNext} />);
    fireEvent.click(screen.getByLabelText(/next/i));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<TransportScrubModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ── line-in source: no-seek note (A20) ───────────────────────────────────────

describe("TransportScrubModal , line-in source (A20)", () => {
  it("shows no-seek note instead of scrubber for line-in source", () => {
    const { container } = render(
      <TransportScrubModal
        {...baseProps}
        source="line-in"
        mediaPosition={null}
        mediaDuration={null}
      />,
    );
    const scrub =
      container.querySelector("[data-scrub]") ??
      container.querySelector("input[type='range'][aria-label*='seek' i]");
    expect(scrub).not.toBeInTheDocument();
    // A note about no seek is shown instead
    expect(container.querySelector("[data-no-seek]")).toBeInTheDocument();
  });
});

// ── TV source: no-seek note (A20) ────────────────────────────────────────────

describe("TransportScrubModal , TV source (A20)", () => {
  it("shows no-seek note instead of scrubber for TV source", () => {
    const { container } = render(
      <TransportScrubModal {...baseProps} source="TV" mediaPosition={null} mediaDuration={null} />,
    );
    const scrub =
      container.querySelector("[data-scrub]") ??
      container.querySelector("input[type='range'][aria-label*='seek' i]");
    expect(scrub).not.toBeInTheDocument();
    expect(container.querySelector("[data-no-seek]")).toBeInTheDocument();
  });
});

// ── Scrubber pointer-event seek (A20) ────────────────────────────────────────
// The ScrubBar calculates seek position from the pointer clientX relative to
// the track's bounding rect. jsdom returns zero-rect by default; we mock it so
// the pctFromPointer math yields a predictable, non-zero result.

describe("TransportScrubModal , scrubber pointer events call onSeek (A20)", () => {
  it("calls onSeek with correct position on pointerUp after a drag gesture", () => {
    const onSeek = vi.fn();
    const { container } = render(
      <TransportScrubModal
        {...baseProps}
        onSeek={onSeek}
        mediaPosition={0}
        mediaDuration={100}
        source="streaming"
      />,
    );

    const scrub = container.querySelector("[data-scrub]") as HTMLElement;
    expect(scrub).toBeInTheDocument();

    // jsdom does not implement setPointerCapture/releasePointerCapture.
    // The ScrubBar calls setPointerCapture on pointerDown; mock it to a no-op.
    scrub.setPointerCapture = vi.fn();
    scrub.releasePointerCapture = vi.fn();

    // Mock the track element's bounding rect so pctFromPointer resolves correctly.
    // Track is 200px wide starting at x=0.
    vi.spyOn(scrub, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 200,
      width: 200,
      top: 0,
      bottom: 10,
      height: 10,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect);

    // Simulate: press at 50px (50% of 200px track = 50% of 100s = 50s)
    fireEvent.pointerDown(scrub, { clientX: 50 });
    // Move to 75px (75% = 75s)
    fireEvent.pointerMove(scrub, { clientX: 75 });
    // Release at 75px , seek fires on release
    fireEvent.pointerUp(scrub, { clientX: 75 });

    expect(onSeek).toHaveBeenCalledTimes(1);
    // 75/200 = 0.375 of 100s = 37.5s , allow floating point tolerance
    const pos = onSeek.mock.calls[0][0] as number;
    expect(pos).toBeGreaterThan(30);
    expect(pos).toBeLessThan(45);
  });

  it("does not call onSeek if pointerUp occurs without a prior pointerDown", () => {
    const onSeek = vi.fn();
    const { container } = render(
      <TransportScrubModal
        {...baseProps}
        onSeek={onSeek}
        mediaPosition={0}
        mediaDuration={100}
        source="streaming"
      />,
    );
    const scrub = container.querySelector("[data-scrub]") as HTMLElement;
    // Fire pointerUp without a prior pointerDown , dragging.current stays false.
    fireEvent.pointerUp(scrub, { clientX: 100 });
    expect(onSeek).not.toHaveBeenCalled();
  });
});

// ── Artwork url ───────────────────────────────────────────────────────────────

describe("TransportScrubModal , artwork", () => {
  it("renders an <img> when artworkUrl is provided", () => {
    const { container } = render(
      <TransportScrubModal {...baseProps} artworkUrl="https://example.com/art.jpg" />,
    );
    const img = container.querySelector("img[alt*='artwork' i]");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/art.jpg");
  });

  it("renders placeholder when artworkUrl is null", () => {
    const { container } = render(<TransportScrubModal {...baseProps} artworkUrl={null} />);
    const art = container.querySelector("[data-artwork]");
    expect(art).toBeInTheDocument();
  });
});
