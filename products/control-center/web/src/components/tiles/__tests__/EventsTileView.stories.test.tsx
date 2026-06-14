/**
 * Vitest component tests for EventsTileView stories.
 * Uses composeStories so play functions run in jsdom , consistent with all other tile story tests.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../EventsTileView.stories";

const { Loading, Empty, ErrorEmpty, Default, MultipleEvents, UrgentEvents } =
  composeStories(stories);

afterEach(cleanup);

describe("EventsTileView stories , Loading", () => {
  it("renders header and no event content while loading", async () => {
    const { container } = render(<Loading />);
    if (Loading.play) await Loading.play({ canvasElement: container });
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    expect(screen.queryByText("Gorgon City")).toBeNull();
  });
});

describe("EventsTileView stories , Empty", () => {
  it("renders header with no events", async () => {
    const { container } = render(<Empty />);
    if (Empty.play) await Empty.play({ canvasElement: container });
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
  });
});

describe("EventsTileView stories , ErrorEmpty", () => {
  it("renders header and hides event content on error", async () => {
    const { container } = render(<ErrorEmpty />);
    if (ErrorEmpty.play) await ErrorEmpty.play({ canvasElement: container });
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    expect(screen.queryByText("Gorgon City")).toBeNull();
  });
});

describe("EventsTileView stories , Default", () => {
  it("renders all three event names", async () => {
    const { container } = render(<Default />);
    if (Default.play) await Default.play({ canvasElement: container });
    expect(screen.getByText("Gorgon City")).toBeInTheDocument();
    expect(screen.getByText("Chris Lake")).toBeInTheDocument();
    expect(screen.getByText("John Summit")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
  });
});

describe("EventsTileView stories , MultipleEvents", () => {
  it("shows first 3 events and hides the 4th", async () => {
    const { container } = render(<MultipleEvents />);
    if (MultipleEvents.play) await MultipleEvents.play({ canvasElement: container });
    expect(screen.getByText("Gorgon City")).toBeInTheDocument();
    expect(screen.getByText("Chris Lake")).toBeInTheDocument();
    expect(screen.getByText("John Summit")).toBeInTheDocument();
    expect(screen.queryByText("Four Tet")).toBeNull();
  });
});

describe("EventsTileView stories , UrgentEvents", () => {
  it("renders all urgent event names", async () => {
    const { container } = render(<UrgentEvents />);
    if (UrgentEvents.play) await UrgentEvents.play({ canvasElement: container });
    expect(screen.getByText("Disclosure")).toBeInTheDocument();
    expect(screen.getByText("Bicep")).toBeInTheDocument();
    expect(screen.getByText("Bonobo")).toBeInTheDocument();
  });
});
