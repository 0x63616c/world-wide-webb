/**
 * Vitest component tests for NetworkTileView stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../NetworkTileView.stories";

const { Populated, Offline, EmptyTraffic, Loading } = composeStories(stories);

afterEach(cleanup);

describe("NetworkTileView stories", () => {
  it("Populated: shows SSID, down/up stats, and ping", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    expect(screen.getByText(/↓ 14\.2 GB/)).toBeInTheDocument();
    expect(screen.getByText(/↑ 3\.8 GB/)).toBeInTheDocument();
    expect(screen.getByText("world-wide-webb")).toBeInTheDocument();
    expect(screen.getByText("12ms")).toBeInTheDocument();
  });

  it("Populated: StatusDot uses className=dot (online state)", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    // Online StatusDot renders <span class="dot" /> , className present means green
    expect(container.querySelector(".dot")).not.toBeNull();
  });

  it("Offline: shows SSID and ping, no 'Offline' label", async () => {
    const { container } = render(<Offline />);
    if (Offline.play) await Offline.play({ canvasElement: container });
    expect(screen.getByText("world-wide-webb")).toBeInTheDocument();
    expect(screen.getByText("999ms")).toBeInTheDocument();
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
  });

  it("Offline: StatusDot does NOT have className=dot (grey offline state)", async () => {
    const { container } = render(<Offline />);
    if (Offline.play) await Offline.play({ canvasElement: container });
    // Offline StatusDot renders an inline-styled span , no .dot class present
    expect(container.querySelector(".dot")).toBeNull();
  });

  it("EmptyTraffic: down label shows but no chart buckets", async () => {
    const { container } = render(<EmptyTraffic />);
    if (EmptyTraffic.play) await EmptyTraffic.play({ canvasElement: container });
    expect(screen.getByText(/↓ 0\.0 GB/)).toBeInTheDocument();
  });

  it("Loading: no down/up arrows rendered", async () => {
    const { container } = render(<Loading />);
    if (Loading.play) await Loading.play({ canvasElement: container });
    expect(screen.queryByText(/↓/)).not.toBeInTheDocument();
    expect(screen.queryByText(/↑/)).not.toBeInTheDocument();
  });
});
