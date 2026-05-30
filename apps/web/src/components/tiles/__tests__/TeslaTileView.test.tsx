/**
 * TeslaTileView — pure presentational component tests.
 * No trpc mocking needed: all inputs are props.
 */
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TeslaTileViewProps } from "../TeslaTileView";
import { TeslaTileView } from "../TeslaTileView";

afterEach(cleanup);

const populatedProps: TeslaTileViewProps = {
  status: "populated",
  locked: true,
  charging: false,
  rate: 0,
  pct: 80,
  range: 240,
  odo: "12,345 mi",
  climate: 72,
};

const chargingProps: TeslaTileViewProps = {
  status: "populated",
  locked: false,
  charging: true,
  rate: 25,
  pct: 55,
  range: 165,
  odo: "12,345 mi",
  climate: 68,
};

describe("TeslaTileView — loading/skeleton state", () => {
  it("renders a .tile container", () => {
    const { container } = render(<TeslaTileView status="loading" />);
    const tile = container.querySelector(".tile") as HTMLElement;
    expect(tile).toBeInTheDocument();
  });

  it("does not render the Tesla header", () => {
    render(<TeslaTileView status="loading" />);
    expect(screen.queryByText("Tesla")).not.toBeInTheDocument();
  });

  it("does not render charge percentage text", () => {
    render(<TeslaTileView status="loading" />);
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  });
});

describe("TeslaTileView — error state", () => {
  it("renders a .tile container", () => {
    const { container } = render(<TeslaTileView status="error" />);
    const tile = container.querySelector(".tile") as HTMLElement;
    expect(tile).toBeInTheDocument();
  });

  it("does not render the Tesla header", () => {
    render(<TeslaTileView status="error" />);
    expect(screen.queryByText("Tesla")).not.toBeInTheDocument();
  });
});

describe("TeslaTileView — populated state (locked, not charging)", () => {
  it("renders the Tesla tile header", () => {
    render(<TeslaTileView {...populatedProps} />);
    expect(screen.getByText("Tesla")).toBeInTheDocument();
  });

  it("renders a Locked pill when locked=true", () => {
    render(<TeslaTileView {...populatedProps} />);
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.queryByText("Unlocked")).not.toBeInTheDocument();
  });

  it("renders Idle pill when not charging", () => {
    render(<TeslaTileView {...populatedProps} />);
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.queryByText(/Charging/)).not.toBeInTheDocument();
  });

  it("renders the charge percentage", () => {
    render(<TeslaTileView {...populatedProps} />);
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("renders Range stat with mi suffix", () => {
    render(<TeslaTileView {...populatedProps} />);
    expect(screen.getByText("240 mi")).toBeInTheDocument();
  });

  it("renders Odometer stat", () => {
    render(<TeslaTileView {...populatedProps} />);
    expect(screen.getByText("12,345 mi")).toBeInTheDocument();
  });

  it("renders Cabin temperature with degree F suffix", () => {
    render(<TeslaTileView {...populatedProps} />);
    expect(screen.getByText("72°F")).toBeInTheDocument();
  });
});

describe("TeslaTileView — populated state (unlocked, charging)", () => {
  it("renders Unlocked pill when locked=false", () => {
    render(<TeslaTileView {...chargingProps} />);
    expect(screen.getByText("Unlocked")).toBeInTheDocument();
    expect(screen.queryByText("Locked")).not.toBeInTheDocument();
  });

  it("renders Charging pill with rate when charging=true", () => {
    render(<TeslaTileView {...chargingProps} />);
    expect(screen.getByText(/Charging/)).toBeInTheDocument();
    expect(screen.getByText(/25 mi\/hr/)).toBeInTheDocument();
  });

  it("does not render Idle when charging", () => {
    render(<TeslaTileView {...chargingProps} />);
    expect(screen.queryByText("Idle")).not.toBeInTheDocument();
  });

  it("renders the charge percentage for charging state", () => {
    render(<TeslaTileView {...chargingProps} />);
    expect(screen.getByText("55%")).toBeInTheDocument();
  });
});
