/**
 * Vitest component tests for SessionListView + SessionDetailView stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as detailStories from "../tiles/SessionDetailView.stories";
import * as listStories from "../tiles/SessionListView.stories";

const { Default, Live, NoPhotos, Empty } = composeStories(listStories);
const { Default: DetailDefault } = composeStories(detailStories);

afterEach(cleanup);

describe("SessionListView stories", () => {
  it("Default renders one row per session", async () => {
    const { container } = render(<Default />);
    if (Default.play) await Default.play({ canvasElement: container });
    expect(screen.getAllByTestId("session-row")).toHaveLength(3);
  });

  it("Live renders 'live' rather than a duration", async () => {
    const { container } = render(<Live />);
    if (Live.play) await Live.play({ canvasElement: container });
    expect(screen.getByText(/live/)).toBeInTheDocument();
  });

  it("NoPhotos renders the honest empty frame", async () => {
    const { container } = render(<NoPhotos />);
    if (NoPhotos.play) await NoPhotos.play({ canvasElement: container });
    expect(screen.getByText("no photo")).toBeInTheDocument();
  });

  it("Empty renders the empty state and no rows", async () => {
    const { container } = render(<Empty />);
    if (Empty.play) await Empty.play({ canvasElement: container });
    expect(screen.getByText(/No sessions yet/)).toBeInTheDocument();
    expect(screen.queryAllByTestId("session-row")).toHaveLength(0);
  });
});

describe("SessionDetailView stories", () => {
  it("Default renders the ordered transcript", async () => {
    const { container } = render(<DetailDefault />);
    if (DetailDefault.play) await DetailDefault.play({ canvasElement: container });
    const rows = screen.getAllByTestId("session-event");
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveTextContent("session/start");
    expect(rows[5]).toHaveTextContent("session/end");
  });
});
