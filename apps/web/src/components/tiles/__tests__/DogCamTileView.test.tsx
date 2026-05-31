/**
 * DogCamTileView — pure presentational component tests.
 * No trpc mocking needed: all inputs are props.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DogCamTileViewProps } from "../DogCamTileView";
import { DogCamTileView } from "../DogCamTileView";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const baseProps: DogCamTileViewProps = {
  status: "populated",
  label: "Living Room",
  online: true,
  snapshotUrl: null,
  live: false,
  recSecs: 0,
  onToggleLive: vi.fn(),
};

describe("DogCamTileView — loading state", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <DogCamTileView status="loading" live={false} recSecs={0} onToggleLive={vi.fn()} />,
    );
    expect(container.firstChild).toBeInTheDocument();
  });

  it("renders the Dog Cam header", () => {
    render(<DogCamTileView status="loading" live={false} recSecs={0} onToggleLive={vi.fn()} />);
    expect(screen.getByText("Dog Cam")).toBeInTheDocument();
  });

  it("renders the feed button", () => {
    render(<DogCamTileView status="loading" live={false} recSecs={0} onToggleLive={vi.fn()} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("does not render a label text when loading", () => {
    render(<DogCamTileView status="loading" live={false} recSecs={0} onToggleLive={vi.fn()} />);
    expect(screen.queryByText("Living Room")).not.toBeInTheDocument();
  });

  it("does not render 'Tap to view feed' when loading", () => {
    render(<DogCamTileView status="loading" live={false} recSecs={0} onToggleLive={vi.fn()} />);
    expect(screen.queryByText(/tap to view feed/i)).not.toBeInTheDocument();
  });
});

describe("DogCamTileView — covered (populated, live=false)", () => {
  it("renders the Dog Cam header", () => {
    render(<DogCamTileView {...baseProps} />);
    expect(screen.getByText("Dog Cam")).toBeInTheDocument();
  });

  it("renders the label from props", () => {
    render(<DogCamTileView {...baseProps} />);
    expect(screen.getByText("Living Room")).toBeInTheDocument();
  });

  it("renders 'Tap to view feed' when online", () => {
    render(<DogCamTileView {...baseProps} />);
    expect(screen.getByText(/tap to view feed/i)).toBeInTheDocument();
  });

  it("renders 'Camera offline' when online=false", () => {
    render(<DogCamTileView {...baseProps} online={false} />);
    expect(screen.getByText(/camera offline/i)).toBeInTheDocument();
    expect(screen.queryByText(/tap to view feed/i)).not.toBeInTheDocument();
  });

  it("does not render LIVE or REC when live=false", () => {
    render(<DogCamTileView {...baseProps} />);
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
    expect(screen.queryByText(/^REC/)).not.toBeInTheDocument();
  });

  it("calls onToggleLive when the feed button is clicked", () => {
    const onToggleLive = vi.fn();
    render(<DogCamTileView {...baseProps} onToggleLive={onToggleLive} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggleLive).toHaveBeenCalledTimes(1);
  });

  it("feed button aria-label says 'View camera feed' when not live", () => {
    render(<DogCamTileView {...baseProps} />);
    expect(screen.getByRole("button", { name: /view camera feed/i })).toBeInTheDocument();
  });
});

describe("DogCamTileView — snapshot image", () => {
  it("renders img when snapshotUrl is provided", () => {
    render(<DogCamTileView {...baseProps} snapshotUrl="http://ha.local/cam.jpg" />);
    const img = screen.getByRole("img");
    expect((img as HTMLImageElement).src).toContain("cam.jpg");
  });

  it("does not render img when snapshotUrl is null", () => {
    render(<DogCamTileView {...baseProps} snapshotUrl={null} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("DogCamTileView — live state (live=true)", () => {
  it("shows LIVE label", () => {
    render(<DogCamTileView {...baseProps} live={true} recSecs={0} />);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it("shows REC timer formatted as HH:MM:SS", () => {
    render(<DogCamTileView {...baseProps} live={true} recSecs={0} />);
    expect(screen.getByText(/^REC 00:00:00$/)).toBeInTheDocument();
  });

  it("shows REC timer with correct elapsed seconds", () => {
    render(<DogCamTileView {...baseProps} live={true} recSecs={75} />);
    // 75 seconds = 00:01:15
    expect(screen.getByText(/^REC 00:01:15$/)).toBeInTheDocument();
  });

  it("shows label in live caption", () => {
    render(<DogCamTileView {...baseProps} live={true} recSecs={0} label="Dog Room" />);
    const labels = screen.getAllByText("Dog Room");
    expect(labels.length).toBeGreaterThan(0);
  });

  it("does not show frosted cover when live", () => {
    render(<DogCamTileView {...baseProps} live={true} recSecs={0} />);
    expect(screen.queryByText(/tap to view feed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/camera offline/i)).not.toBeInTheDocument();
  });

  it("calls onToggleLive when feed button clicked in live state", () => {
    const onToggleLive = vi.fn();
    render(<DogCamTileView {...baseProps} live={true} recSecs={0} onToggleLive={onToggleLive} />);
    fireEvent.click(screen.getByRole("button", { name: /hide camera feed/i }));
    expect(onToggleLive).toHaveBeenCalledTimes(1);
  });

  it("feed button aria-label says 'Hide camera feed' when live", () => {
    render(<DogCamTileView {...baseProps} live={true} recSecs={0} />);
    expect(screen.getByRole("button", { name: /hide camera feed/i })).toBeInTheDocument();
  });
});

describe("DogCamTileView — tile structure", () => {
  it("tile wrapper has padding 22", () => {
    const { container } = render(<DogCamTileView {...baseProps} />);
    const tile = container.firstChild as HTMLElement;
    expect(tile.style.padding).toBe("22px");
  });
});

describe("DogCamTileView — error state", () => {
  it("renders the Dog Cam header", () => {
    render(<DogCamTileView status="error" live={false} recSecs={0} onToggleLive={vi.fn()} />);
    expect(screen.getByText("Dog Cam")).toBeInTheDocument();
  });

  it("renders the feed button", () => {
    render(<DogCamTileView status="error" live={false} recSecs={0} onToggleLive={vi.fn()} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("does not render label text when in error state", () => {
    render(<DogCamTileView status="error" live={false} recSecs={0} onToggleLive={vi.fn()} />);
    expect(screen.queryByText("Living Room")).not.toBeInTheDocument();
  });

  it("does not render 'Tap to view feed' when in error state", () => {
    render(<DogCamTileView status="error" live={false} recSecs={0} onToggleLive={vi.fn()} />);
    expect(screen.queryByText(/tap to view feed/i)).not.toBeInTheDocument();
  });

  it("does not render LIVE or REC when in error state", () => {
    render(<DogCamTileView status="error" live={false} recSecs={0} onToggleLive={vi.fn()} />);
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
    expect(screen.queryByText(/^REC/)).not.toBeInTheDocument();
  });
});
