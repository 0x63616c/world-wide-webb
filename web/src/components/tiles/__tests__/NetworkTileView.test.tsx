/**
 * NetworkTileView , pure presentational component tests.
 * No trpc mocking needed: all inputs are props.
 */
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { NetworkTileViewProps } from "../NetworkTileView";
import { NetworkTileView } from "../NetworkTileView";

afterEach(cleanup);

const SAMPLE_TRAFFIC = Array.from({ length: 24 }, (_, i) => ({
  down: i % 3 === 0 ? 0.8 : 0.4,
  up: i % 4 === 0 ? 0.3 : 0.15,
}));

const populatedProps: NetworkTileViewProps = {
  status: "populated",
  isOffline: false,
  down: "14.2",
  up: "3.8",
  ssid: "HomeNet",
  ping: 12,
  traffic: SAMPLE_TRAFFIC,
};

describe("NetworkTileView , loading/skeleton state", () => {
  it("renders without crashing", () => {
    const { container } = render(<NetworkTileView status="loading" />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it("keeps the Network title visible while loading so the tile is identifiable", () => {
    render(<NetworkTileView status="loading" />);
    expect(screen.getByText("Network")).toBeInTheDocument();
  });

  it("does not render down/up GB labels while loading", () => {
    render(<NetworkTileView status="loading" />);
    expect(screen.queryByText(/↓/)).not.toBeInTheDocument();
    expect(screen.queryByText(/↑/)).not.toBeInTheDocument();
  });

  it("does not render Online/Offline text while loading", () => {
    render(<NetworkTileView status="loading" />);
    expect(screen.queryByText("Online")).not.toBeInTheDocument();
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
  });
});

describe("NetworkTileView , populated state", () => {
  it("renders download GB value", () => {
    render(<NetworkTileView {...populatedProps} />);
    expect(screen.getByText(/↓ 14\.2 GB/)).toBeInTheDocument();
  });

  it("renders upload GB value", () => {
    render(<NetworkTileView {...populatedProps} />);
    expect(screen.getByText(/↑ 3\.8 GB/)).toBeInTheDocument();
  });

  it("renders ssid in footer exactly once", () => {
    render(<NetworkTileView {...populatedProps} />);
    const ssidEls = screen.getAllByText("HomeNet");
    expect(ssidEls).toHaveLength(1);
  });

  it("renders ping in footer", () => {
    render(<NetworkTileView {...populatedProps} />);
    expect(screen.getByText("12ms")).toBeInTheDocument();
  });

  it("does not render the word Online , status is conveyed by StatusDot only", () => {
    render(<NetworkTileView {...populatedProps} />);
    expect(screen.queryByText("Online")).not.toBeInTheDocument();
  });

  it("does not render the word Offline when isOffline=true , StatusDot handles it", () => {
    render(<NetworkTileView {...populatedProps} isOffline={true} />);
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
  });

  it("renders 24 butterfly chart bar-pair wrappers when traffic is non-empty", () => {
    const { container } = render(<NetworkTileView {...populatedProps} />);
    const buckets = container.querySelectorAll("[style*='position: relative'][style*='flex: 1']");
    // Each of 24 buckets matches; outer chart wrapper also has flex:1 so >= 24
    expect(buckets.length).toBeGreaterThanOrEqual(24);
  });

  it("renders a Skeleton in place of bars when traffic is empty", () => {
    const { container } = render(<NetworkTileView {...populatedProps} traffic={[]} />);
    const buckets = container.querySelectorAll("[style*='position: relative'][style*='flex: 1']");
    expect(buckets.length).toBe(0);
  });
});
