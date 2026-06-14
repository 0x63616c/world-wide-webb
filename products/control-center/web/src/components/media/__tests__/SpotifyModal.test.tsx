/**
 * Tests for SpotifyModal (www-51hf.25).
 *
 * A30: Real Spotify content , search + target chip + horizontal rows
 *      (Recently played / Made for you) from the browse query; no stub content.
 * A17: uses shared ui primitives (Modal).
 * A32: co-located test + stories.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpotifyModalProps } from "../SpotifyModal";
import { SpotifyModal } from "../SpotifyModal";

afterEach(cleanup);

vi.mock("react-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom")>();
  return { ...original, createPortal: (node: React.ReactNode) => node };
});

vi.mock("@/lib/modal-open-store", () => ({
  registerOpenModal: vi.fn(() => () => {}),
}));

const recentlyPlayed = [
  { id: "t-a", title: "Song A", artist: "Artist A", albumArtUrl: null, uri: "spotify:track:a" },
  { id: "t-b", title: "Song B", artist: "Artist B", albumArtUrl: null, uri: "spotify:track:b" },
];

const playlists = [
  { id: "p-1", title: "Daily Mix 1", description: null, imageUrl: null, uri: "spotify:playlist:1" },
  {
    id: "p-2",
    title: "Discover Weekly",
    description: null,
    imageUrl: null,
    uri: "spotify:playlist:2",
  },
];

const baseProps: SpotifyModalProps = {
  open: true,
  onClose: vi.fn(),
  recentlyPlayed,
  playlists,
  zones: ["Living Room", "Desk"],
  onPlay: vi.fn(),
};

describe("SpotifyModal , closed", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(<SpotifyModal {...baseProps} open={false} />);
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });
});

describe("SpotifyModal , open (A30)", () => {
  it("renders a dialog", () => {
    render(<SpotifyModal {...baseProps} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders Recently played section header", () => {
    render(<SpotifyModal {...baseProps} />);
    expect(screen.getByText(/recently played/i)).toBeInTheDocument();
  });

  it("renders recently played tracks", () => {
    render(<SpotifyModal {...baseProps} />);
    expect(screen.getByText("Song A")).toBeInTheDocument();
    expect(screen.getByText("Song B")).toBeInTheDocument();
  });

  it("renders Made for you / playlists section", () => {
    render(<SpotifyModal {...baseProps} />);
    expect(screen.getByText(/made for you|playlists/i)).toBeInTheDocument();
  });

  it("renders playlist names", () => {
    render(<SpotifyModal {...baseProps} />);
    expect(screen.getByText("Daily Mix 1")).toBeInTheDocument();
    expect(screen.getByText("Discover Weekly")).toBeInTheDocument();
  });

  it("renders target zone chips", () => {
    render(<SpotifyModal {...baseProps} />);
    expect(screen.getByText("Living Room")).toBeInTheDocument();
    expect(screen.getByText("Desk")).toBeInTheDocument();
  });

  it("calls onPlay when a track is clicked", () => {
    const onPlay = vi.fn();
    render(<SpotifyModal {...baseProps} onPlay={onPlay} />);
    fireEvent.click(screen.getByText("Song A"));
    expect(onPlay).toHaveBeenCalled();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<SpotifyModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
