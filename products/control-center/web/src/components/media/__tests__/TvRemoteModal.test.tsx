/**
 * Tests for TvRemoteModal (www-51hf.17).
 *
 * A21: now-playing strip, playback keys, D-pad (up/down/left/right + center OK,
 *      menu/back, home, power) wired to tvRemote mutation, with no-mute note.
 *      Bare detail page body now , no <Modal> chrome.
 * A32: co-located test + stories.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TvRemoteModal, type TvRemoteModalProps } from "../TvRemoteModal";

afterEach(cleanup);

// ── Base props ────────────────────────────────────────────────────────────────

const noop = vi.fn();

const baseProps: TvRemoteModalProps = {
  // now-playing strip
  state: "playing",
  appName: "Netflix",
  mediaTitle: "Stranger Things",
  mediaArtist: "Netflix Originals",
  artworkUrl: null,
  // transport + D-pad callbacks
  onUp: noop,
  onDown: noop,
  onLeft: noop,
  onRight: noop,
  onOk: noop,
  onMenu: noop,
  onHome: noop,
  onPower: noop,
  onPlayPause: noop,
  onPrev: noop,
  onNext: noop,
};

// ── Now-playing strip (A21) ──────────────────────────────────────────────────

describe("TvRemoteModal , now-playing strip (A21)", () => {
  it("renders the media title in the now-playing strip", () => {
    render(<TvRemoteModal {...baseProps} />);
    expect(screen.getAllByText("Stranger Things").length).toBeGreaterThan(0);
  });

  it("renders the media artist in the now-playing strip", () => {
    render(<TvRemoteModal {...baseProps} />);
    expect(screen.getAllByText("Netflix Originals").length).toBeGreaterThan(0);
  });

  it("renders an artwork area (img or placeholder)", () => {
    const { container } = render(<TvRemoteModal {...baseProps} />);
    const art =
      container.querySelector("img[alt*='artwork' i]") ?? container.querySelector("[data-artwork]");
    expect(art).toBeInTheDocument();
  });

  it("renders an <img> when artworkUrl is provided", () => {
    const { container } = render(
      <TvRemoteModal {...baseProps} artworkUrl="https://example.com/art.jpg" />,
    );
    const img = container.querySelector("img[alt*='artwork' i]");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/art.jpg");
  });

  it("shows app name when mediaTitle is null", () => {
    render(<TvRemoteModal {...baseProps} mediaTitle={null} />);
    expect(screen.getAllByText("Netflix").length).toBeGreaterThan(0);
  });
});

// ── D-pad (A21) ───────────────────────────────────────────────────────────────

describe("TvRemoteModal , D-pad buttons (A21)", () => {
  it("renders Up button", () => {
    render(<TvRemoteModal {...baseProps} />);
    expect(screen.getByLabelText(/up/i)).toBeInTheDocument();
  });

  it("renders Down button", () => {
    render(<TvRemoteModal {...baseProps} />);
    expect(screen.getByLabelText(/down/i)).toBeInTheDocument();
  });

  it("renders Left button", () => {
    render(<TvRemoteModal {...baseProps} />);
    expect(screen.getByLabelText(/left/i)).toBeInTheDocument();
  });

  it("renders Right button", () => {
    render(<TvRemoteModal {...baseProps} />);
    expect(screen.getByLabelText(/right/i)).toBeInTheDocument();
  });

  it("renders OK/center button", () => {
    render(<TvRemoteModal {...baseProps} />);
    expect(screen.getByLabelText(/ok|select|center/i)).toBeInTheDocument();
  });

  it("renders Menu/Back button", () => {
    render(<TvRemoteModal {...baseProps} />);
    expect(screen.getByLabelText(/menu|back/i)).toBeInTheDocument();
  });

  it("renders Home button", () => {
    render(<TvRemoteModal {...baseProps} />);
    expect(screen.getByLabelText(/home/i)).toBeInTheDocument();
  });

  it("renders Power button", () => {
    render(<TvRemoteModal {...baseProps} />);
    expect(screen.getByLabelText(/power/i)).toBeInTheDocument();
  });
});

// ── D-pad callbacks (A21) ─────────────────────────────────────────────────────

describe("TvRemoteModal , D-pad callbacks wired (A21)", () => {
  it("calls onUp when Up is clicked", () => {
    const onUp = vi.fn();
    render(<TvRemoteModal {...baseProps} onUp={onUp} />);
    fireEvent.click(screen.getByLabelText(/up/i));
    expect(onUp).toHaveBeenCalledTimes(1);
  });

  it("calls onDown when Down is clicked", () => {
    const onDown = vi.fn();
    render(<TvRemoteModal {...baseProps} onDown={onDown} />);
    fireEvent.click(screen.getByLabelText(/down/i));
    expect(onDown).toHaveBeenCalledTimes(1);
  });

  it("calls onLeft when Left is clicked", () => {
    const onLeft = vi.fn();
    render(<TvRemoteModal {...baseProps} onLeft={onLeft} />);
    fireEvent.click(screen.getByLabelText(/left/i));
    expect(onLeft).toHaveBeenCalledTimes(1);
  });

  it("calls onRight when Right is clicked", () => {
    const onRight = vi.fn();
    render(<TvRemoteModal {...baseProps} onRight={onRight} />);
    fireEvent.click(screen.getByLabelText(/right/i));
    expect(onRight).toHaveBeenCalledTimes(1);
  });

  it("calls onOk when OK/center is clicked", () => {
    const onOk = vi.fn();
    render(<TvRemoteModal {...baseProps} onOk={onOk} />);
    fireEvent.click(screen.getByLabelText(/ok|select|center/i));
    expect(onOk).toHaveBeenCalledTimes(1);
  });

  it("calls onMenu when Menu/Back is clicked", () => {
    const onMenu = vi.fn();
    render(<TvRemoteModal {...baseProps} onMenu={onMenu} />);
    fireEvent.click(screen.getByLabelText(/menu|back/i));
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it("calls onHome when Home is clicked", () => {
    const onHome = vi.fn();
    render(<TvRemoteModal {...baseProps} onHome={onHome} />);
    fireEvent.click(screen.getByLabelText(/home/i));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it("calls onPower when Power is clicked", () => {
    const onPower = vi.fn();
    render(<TvRemoteModal {...baseProps} onPower={onPower} />);
    fireEvent.click(screen.getByLabelText(/power/i));
    expect(onPower).toHaveBeenCalledTimes(1);
  });
});

// ── Playback transport buttons (A21) ─────────────────────────────────────────

describe("TvRemoteModal , playback buttons (A21)", () => {
  it("renders Previous button", () => {
    render(<TvRemoteModal {...baseProps} />);
    expect(screen.getByLabelText(/previous/i)).toBeInTheDocument();
  });

  it("renders Play/Pause button showing Pause when playing", () => {
    render(<TvRemoteModal {...baseProps} state="playing" />);
    expect(screen.getByLabelText("Pause")).toBeInTheDocument();
  });

  it("renders Play/Pause button showing Play when paused", () => {
    render(<TvRemoteModal {...baseProps} state="paused" />);
    expect(screen.getByLabelText("Play")).toBeInTheDocument();
  });

  it("renders Next button", () => {
    render(<TvRemoteModal {...baseProps} />);
    expect(screen.getByLabelText(/next/i)).toBeInTheDocument();
  });

  it("calls onPlayPause when play-pause is clicked", () => {
    const onPlayPause = vi.fn();
    render(<TvRemoteModal {...baseProps} onPlayPause={onPlayPause} />);
    fireEvent.click(screen.getByLabelText(/pause/i));
    expect(onPlayPause).toHaveBeenCalledTimes(1);
  });

  it("calls onPrev when previous is clicked", () => {
    const onPrev = vi.fn();
    render(<TvRemoteModal {...baseProps} onPrev={onPrev} />);
    fireEvent.click(screen.getByLabelText(/previous/i));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("calls onNext when next is clicked", () => {
    const onNext = vi.fn();
    render(<TvRemoteModal {...baseProps} onNext={onNext} />);
    fireEvent.click(screen.getByLabelText(/next/i));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

// ── No-mute note (A21) ────────────────────────────────────────────────────────

describe("TvRemoteModal , no-mute note (A21)", () => {
  it("renders an explicit no-mute note", () => {
    const { container } = render(<TvRemoteModal {...baseProps} />);
    const note = container.querySelector("[data-no-mute]");
    expect(note).toBeInTheDocument();
  });
});
