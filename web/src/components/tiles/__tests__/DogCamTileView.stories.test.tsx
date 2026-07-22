/**
 * Vitest component tests for DogCamTileView stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../DogCamTileView.stories";

const { Covered, Offline, Loading, ErrorEmpty, Live, WithSnapshot, ToggleLiveInteraction } =
  composeStories(stories);

afterEach(cleanup);

describe("DogCamTileView stories , Covered", () => {
  it("shows header, label, tap-prompt, and no LIVE badge", async () => {
    const { container } = render(<Covered />);
    if (Covered.play) await Covered.play({ canvasElement: container });
    // Header title and cover label both read "Living Room Cam"
    expect(screen.getAllByText("Living Room Cam").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/tap to view feed/i)).toBeInTheDocument();
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
    // Stream img is not mounted while covered , no open MJPEG connection
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("DogCamTileView stories , Offline", () => {
  it("shows 'Camera offline' and hides tap prompt", async () => {
    const { container } = render(<Offline />);
    if (Offline.play) await Offline.play({ canvasElement: container });
    expect(screen.getByText(/camera offline/i)).toBeInTheDocument();
    expect(screen.queryByText(/tap to view feed/i)).not.toBeInTheDocument();
  });
});

describe("DogCamTileView stories , Loading", () => {
  it("shows header and button but no status text", async () => {
    const { container } = render(<Loading />);
    if (Loading.play) await Loading.play({ canvasElement: container });
    expect(screen.getByText("Living Room Cam")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
    expect(screen.queryByText(/tap to view feed/i)).not.toBeInTheDocument();
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  });
});

describe("DogCamTileView stories , ErrorEmpty", () => {
  it("shows header and button but no status text", async () => {
    const { container } = render(<ErrorEmpty />);
    if (ErrorEmpty.play) await ErrorEmpty.play({ canvasElement: container });
    expect(screen.getByText("Living Room Cam")).toBeInTheDocument();
    expect(screen.queryByText(/tap to view feed/i)).not.toBeInTheDocument();
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  });
});

describe("DogCamTileView stories , Live", () => {
  it("shows LIVE badge and REC timer", async () => {
    const { container } = render(<Live />);
    if (Live.play) await Live.play({ canvasElement: container });
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByText(/^REC 00:01:15$/)).toBeInTheDocument();
    expect(screen.queryByText(/tap to view feed/i)).not.toBeInTheDocument();
    // Live mounts the MJPEG stream img pointed at the api proxy
    expect(screen.getByRole("img")).toHaveAttribute("src", "/media/camera-stream");
  });
});

describe("DogCamTileView stories , WithSnapshot", () => {
  it("renders img with correct src", async () => {
    const { container } = render(<WithSnapshot />);
    if (WithSnapshot.play) await WithSnapshot.play({ canvasElement: container });
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://picsum.photos/seed/dogcam/640/360");
  });
});

describe("DogCamTileView stories , ToggleLiveInteraction", () => {
  it("clicking the feed button fires onToggleLive once", async () => {
    const { container } = render(<ToggleLiveInteraction />);
    if (ToggleLiveInteraction.play) await ToggleLiveInteraction.play({ canvasElement: container });
  });
});
